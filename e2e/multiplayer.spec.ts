/* eslint-disable testing-library/prefer-screen-queries -- Playwright owns browser queries. */
import { expect, type NewIsolatedContext, type Page } from "./fixtures";
import { test } from "./advance-world";
import { crossplayFixture } from "./crossplay-fixture";
import { verifyMenuKeyboard } from "./menu-keyboard";
import { reviewScreenshot } from "./review-screenshot";
import { openFleet, openPane, selectTerritoryMapTile } from "./layout";
import type { InstalledMod, ModLibrary, ModRequest } from "../src/mods/Types";
import type { RoomView } from "../src/multiplayer/Types";
import type { GameType } from "../src/Types";
import { wToSliderTick } from "../src/helpers/BuildSizing";
import { multiplayerTerritoryTiles } from "../src/helpers/MultiplayerTerritory";
import { claimToPeerBorder, territorialMap } from "./territorial-multiplayer";

const companies = ["SolarSam", "WindyWren", "HydroHal", "VoltVera"];
const lobby = (page: Page) =>
  page.getByRole("dialog", { name: "Play with friends", exact: true });
const entry = (page: Page) =>
  page.getByRole("button", { name: "Play with friends", exact: true });
const clock = (page: Page) =>
  page.locator(".multiplayerSpeedToggles:visible").last();
const grid = (page: Page) => page.locator("#mapPane");

type MultiplayerWindow = Window & {
  observedRoomView?: RoomView;
  viewSequence?: number;
  crossplayInvoke?: (
    operation: string,
    body: unknown,
    userAction: boolean,
  ) => ReturnType<
    NonNullable<NonNullable<Window["electrifyDesktop"]>["crossplayRequest"]>
  >;
  mockModsRequest?: (request: ModRequest) => Promise<ModLibrary>;
  scoreSubmissions?: number;
  achievementSubmissions?: number;
  videoWorkload?: { frames: () => Promise<number>; stop: () => void };
  nativeWorkerSequence?: number;
  nativeForecasts?: {
    id: string;
    scenarioId: number;
    hasCustomScenario: boolean;
    seed: number;
    loads: GameType["loadAdditions"];
    responses: { key: string; optionId: string }[];
  }[];
  nativeForecastReplies?: string[];
};

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

class V2Campaign {
  readonly fixture = crossplayFixture();
  readonly players: Page[] = [];
  readonly errors: string[] = [];
  readonly modRequests: ModRequest[][] = [];

  constructor(
    private readonly newIsolatedContext: NewIsolatedContext,
    private readonly installedMods: InstalledMod[][] = [],
    private readonly names: readonly string[] = companies,
  ) {}

  async addPlayer(width = 1280, open = true, legacyScenario?: number) {
    const index = this.players.length;
    if (index === 0) await this.fixture.prepareCheckpoints();
    const name = this.names[index];
    const context = await this.newIsolatedContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      colorScheme: index % 2 ? "dark" : "light",
      hasTouch: width < 600,
      isMobile: width < 600,
      permissions: ["clipboard-read", "clipboard-write"],
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    this.players.push(page);
    page.on("pageerror", (error) => this.errors.push(error.message));
    await this.fixture.install(page, "steam", { name, installBridge: false });

    let mods = structuredClone(this.installedMods[index] ?? []);
    const requests: ModRequest[] = [];
    this.modRequests.push(requests);
    await page.exposeBinding(
      "mockModsRequest",
      (_source, input: ModRequest) => {
        requests.push(structuredClone(input));
        if (input.kind === "remove")
          mods = mods.filter(({ key }) => key !== input.key);
        return { entries: structuredClone(mods) };
      },
    );
    await page.addInitScript(
      ({ name, index, legacyScenario }) => {
        localStorage.setItem("audioEnabled", "false");
        localStorage.setItem("theme", "system");
        localStorage.setItem("musicVolume", "0.5");
        localStorage.setItem("soundEffectsVolume", "0.5");
        const target = window as MultiplayerWindow;
        const display = {
          fullscreen: false,
          width: 1280,
          height: 900,
          resolutions: [],
        };
        const noop = () => () => {};
        window.electrifyDesktop = {
          apiVersion: 1,
          steamEdition: true,
          getState: async () => ({
            display,
            steam: {
              available: true,
              online: true,
              cloudEnabled: false,
              steamId: `7656119800000000${index + 1}`,
              displayName: name,
            },
          }),
          setDisplay: async () => display,
          onStateChanged: noop,
          onGameFocusChanged: noop,
          onBeforeQuit: noop,
          readyToQuit: () => {},
          quit: async () => {},
          readSaveLibrary: async () => ({
            local: null,
            cloud: null,
            cloudState: "disabled",
          }),
          writeSaveLibrary: async () => ({ cloudState: "disabled" }),
          getLeaderboard: async () => [],
          submitScore: async () => {
            target.scoreSubmissions = (target.scoreSubmissions ?? 0) + 1;
          },
          readAchievements: async () => ({
            version: 1,
            earned: [],
            tutorials: [],
            wins: [],
          }),
          submitAchievements: async () => {
            target.achievementSubmissions =
              (target.achievementSubmissions ?? 0) + 1;
          },
          mods: (request) => target.mockModsRequest!(request),
          openFriends: async () => {},
          setActivity: async () => {},
          addTimelineEvent: async () => {},
          crossplayRequest: (operation, body, _requestId, userAction) =>
            target.crossplayInvoke!(operation, body, userAction ?? false),
        };
        const ActualWorker = window.Worker;
        window.Worker = class extends ActualWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.addEventListener("message", ({ data }) => {
              if (data?.kind !== "views") return;
              const view = (Object.values(data.views) as RoomView[])[0];
              if (view?.game) {
                target.observedRoomView = view;
                target.viewSequence = (target.viewSequence ?? 0) + 1;
              }
            });
          }
          postMessage(
            message: unknown,
            options?: Transferable[] | StructuredSerializeOptions,
          ) {
            // Recreate the checkpoint an older release published before new campaigns became
            // custom-only. The actual simulation, save, recovery and browser views still run.
            if (
              legacyScenario &&
              message &&
              typeof message === "object" &&
              "kind" in message &&
              message.kind === "create" &&
              "online" in message &&
              message.online === true
            )
              message = {
                ...message,
                spec: { scenarioId: legacyScenario, difficulty: "Employee" },
              };
            if (Array.isArray(options)) super.postMessage(message, options);
            else super.postMessage(message, options);
          }
        };
      },
      { name, index, legacyScenario },
    );
    await page.goto("/");
    if (open) await entry(page).click();
    return page;
  }

  async create(host: Page) {
    await lobby(host).getByRole("button", { name: "Host a game" }).click();
    await expect(
      host.getByRole("heading", { name: "Custom setup" }),
    ).toBeVisible();
    const code = await host.locator(".coopInviteDigits").innerText();
    expect(code).toMatch(/^[a-z0-9]{6}$/);
    return code;
  }

  async requestJoin(guest: Page, invite: string) {
    await lobby(guest)
      .getByRole("textbox", { name: "Invite code" })
      .fill(invite);
    await lobby(guest)
      .getByRole("button", { name: "Join", exact: true })
      .click();
  }

  async waitForGuest(host: Page, guest: Page) {
    const name = this.names[this.players.indexOf(guest)];
    await expect(
      guest.getByRole("heading", { name: "Custom setup" }),
    ).toBeVisible();
    await expect(
      host
        .getByRole("list", { name: "Players", exact: true })
        .getByText(name, { exact: true }),
    ).toBeVisible();
  }

  async start(host = this.players[0]) {
    for (const guest of this.players.filter((page) => page !== host)) {
      const button = guest.getByRole("button", {
        name: "I'm ready",
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.click();
      await expect(
        guest.getByRole("button", { name: "Ready", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await host
      .getByRole("button", { name: "Start for everyone", exact: true })
      .click();
    for (const page of this.players) await expect(grid(page)).toBeVisible();
  }

  async resume(host: Page, name?: string) {
    for (const page of [
      host,
      ...this.players.filter((candidate) => candidate !== host),
    ]) {
      const library = await openCampaignSaves(page);
      const load = name
        ? library
            .getByRole("article", { name, exact: true })
            .getByRole("button", { name: "Load", exact: true })
        : library.getByRole("button", { name: "Load", exact: true });
      await load.click();
    }
    const resume = lobby(host).getByRole("button", {
      name: "Resume campaign",
      exact: true,
    });
    await expect(resume).toBeEnabled();
    await resume.click();
    try {
      for (const page of this.players) await expect(grid(page)).toBeVisible();
    } catch (error) {
      await test.info().attach("resume-diagnostics", {
        contentType: "application/json",
        body: JSON.stringify(
          {
            dialogs: await Promise.all(
              this.players.map((page) => lobby(page).allTextContents()),
            ),
            operations: this.fixture.operations
              .filter(
                ({ operation, status }) =>
                  operation !== "room/state" || status >= 400,
              )
              .slice(-40)
              .map(({ page, ...result }) => ({
                ...result,
                player: page ? this.players.indexOf(page) : undefined,
              })),
            errors: this.errors,
          },
          null,
          2,
        ),
      });
      throw error;
    }
  }
}

async function startCustom(
  newIsolatedContext: NewIsolatedContext,
  count: number,
  compact: boolean,
  touchGuest = false,
  compactWidth = 390,
) {
  const campaign = new V2Campaign(newIsolatedContext);
  const host = await campaign.addPlayer(compact ? compactWidth : 1280);
  const invite = await campaign.create(host);
  for (let index = 1; index < count; index++) {
    const guest = await campaign.addPlayer(
      compact || touchGuest || index === 3 ? compactWidth : 1280,
    );
    await campaign.requestJoin(guest, invite);
    await campaign.waitForGuest(host, guest);
  }
  await campaign.start(host);
  return campaign;
}

const projection = (page: Page) =>
  page.evaluate(() => (window as MultiplayerWindow).observedRoomView);
const captureState = (page: Page) =>
  page.evaluate(() => {
    const view = (window as MultiplayerWindow).observedRoomView;
    return {
      epoch: view?.epoch,
      matchId: view?.matchId,
      seat: view?.game?.multiplayer?.seat,
      scenarioId: view?.game?.scenarioId,
      seed: view?.game?.seed,
      facilities: view?.game?.facilities.length,
      month: view?.game?.date.monthsElapsed,
    };
  });

async function saveAndQuit(page: Page) {
  await page.getByRole("button", { name: /^menu/i }).click();
  await page.getByRole("menuitem", { name: "Leave", exact: true }).click();
  await expect(entry(page)).toBeVisible();
}

/** Saves are reached from the custom setup of a lobby that this player hosts. */
async function openCampaignSaves(page: Page) {
  await entry(page).click();
  await lobby(page).getByRole("button", { name: "Host a game" }).click();
  await page
    .getByRole("button", { name: "Load multiplayer save", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Multiplayer saves", exact: true });
}

async function selectSpeed(page: Page, label: string) {
  await clock(page).getByRole("button", { name: label, exact: true }).click();
}

test("desktop menu keyboard journey includes Play with friends in both directions", async ({
  newIsolatedContext,
}) => {
  const campaign = new V2Campaign(newIsolatedContext);
  const page = await campaign.addPlayer(1280, false);
  await verifyMenuKeyboard(page);
});

test("V2 joins immediately by invite and lets the host remove a guest", async ({
  newIsolatedContext,
}) => {
  const campaign = new V2Campaign(newIsolatedContext);
  const host = await campaign.addPlayer(),
    guest = await campaign.addPlayer(390);
  const invite = await campaign.create(host);
  await expect(host.getByTestId("mission-row-999")).toHaveCount(0);
  await expect(
    host.getByRole("button", { name: "Invite a friend to start" }),
  ).toBeDisabled();
  await campaign.requestJoin(guest, "000000" === invite ? "111111" : "000000");
  await expect(lobby(guest).getByRole("alert")).toBeVisible();
  await campaign.requestJoin(guest, invite);
  await campaign.waitForGuest(host, guest);
  const kick = host.getByRole("button", {
    name: "Kick WindyWren",
    exact: true,
  });
  await kick.hover();
  await expect(kick).toContainText("Kick?");
  await kick.click();
  await expect(kick).toHaveCount(0);
  await expect(entry(guest)).toBeVisible();
  await entry(guest).click();
  await campaign.requestJoin(guest, invite);
  await expect(lobby(guest).getByRole("alert")).toHaveText(
    /invitation is no longer available/i,
  );
  expect(campaign.errors).toEqual([]);
});

test("focus skips a guest who is still exiting after a quick second kick", async ({
  newIsolatedContext,
}) => {
  const campaign = new V2Campaign(newIsolatedContext);
  const host = await campaign.addPlayer();
  await host.emulateMedia({ reducedMotion: "no-preference" });
  const invite = await campaign.create(host);
  for (const name of ["WindyWren", "HydroHal"]) {
    const guest = await campaign.addPlayer();
    await campaign.requestJoin(guest, invite);
    await campaign.waitForGuest(host, guest);
    await expect(
      host.getByRole("button", { name: `Kick ${name}`, exact: true }),
    ).toBeVisible();
  }
  const first = host.getByRole("button", {
    name: "Kick WindyWren",
    exact: true,
  });
  const second = host.getByRole("button", {
    name: "Kick HydroHal",
    exact: true,
  });
  const copyCode = host.getByRole("button", { name: "Copy code", exact: true });
  const handoff = await first.evaluateHandle((button) => {
    const row = button.closest("li")!;
    const roster = row.parentElement!;
    const next = [...roster.querySelectorAll("button")].find(
      (candidate) => candidate !== button,
    )!;
    const state = { reachedNext: false, firstStillExiting: false };
    const observer = new MutationObserver(() => {
      if (!row.inert) return;
      state.reachedNext = document.activeElement === next;
      state.firstStillExiting = row.isConnected;
      // Activate the focused control inside the real exit window, even under
      // a busy renderer. HTMLElement.click uses the keyboard click path.
      next.click();
      observer.disconnect();
    });
    observer.observe(row, { attributeFilter: ["inert"] });
    return state;
  });
  await first.press("Enter");
  await expect(second).toHaveCount(0);
  await expect(copyCode).toBeFocused();
  expect(await handoff.jsonValue()).toEqual({
    reachedNext: true,
    firstStillExiting: true,
  });
  await handoff.dispose();
  expect(campaign.errors).toEqual([]);
});

for (const count of [2, 3, 4]) {
  test(
    `V2 ${count} players share a territorial map and build on their own land`,
    { tag: ["@mobile", "@territorial"] },
    async ({ newIsolatedContext }, info) => {
      const campaign = await startCustom(
        newIsolatedContext,
        count,
        !!info.project.use.isMobile,
        false,
        info.project.use.viewport?.width,
      );
      const [host, ...guests] = campaign.players;
      const buyer = guests.at(-1)!;
      const owned = new Set<string>();
      for (const page of campaign.players) {
        await expect(territorialMap(page)).toBeVisible();
        const game = (await projection(page))!.game!;
        expect(game.multiplayer?.territorial?.seatCount).toBe(count);
        const territory = game.multiplayer!.territorial!;
        expect(territory.startingTileIds).toContain(territory.homeTileId);
        for (const tile of territory.startingTileIds) {
          expect(owned.has(tile)).toBe(false);
          owned.add(tile);
        }
        expect(game.facilities.length).toBeGreaterThan(0);
        for (const facility of game.facilities)
          expect(territory.startingTileIds).toContain(facility.tileId);
        expect(
          game.multiplayer?.peers?.map(({ connected }) => !!connected),
        ).toEqual(Array(count - 1).fill(false));
        expect(
          game.transmission?.lines.filter(({ corridorId }) =>
            corridorId.startsWith("peer:"),
          ),
        ).toEqual([]);
        await selectSpeed(page, "slow speed");
      }
      await selectSpeed(host, "ultra speed");
      for (const page of campaign.players)
        await expect(clock(page)).toHaveAttribute("data-active-speed", "SLOW");
      await expect(clock(host)).toHaveAccessibleDescription(
        /SolarSam \(you\) selected 24×/,
      );
      if (!info.project.use.isMobile && buyer.viewportSize()!.width >= 1024) {
        const fleet = await openFleet(buyer);
        const rail = territorialMap(buyer).getByRole("complementary", {
          name: "Build facilities",
        });
        const trigger = rail.getByRole("button", {
          name: "Build",
          exact: true,
        });
        await expect(trigger).toHaveId("buildNav");
        await trigger.click();
        const build = buyer.getByRole("region", { name: "Build", exact: true });
        await expect(build).toHaveAttribute("data-resizable", "true");
        await expect(fleet).toBeVisible();
        await build
          .getByRole("button", { name: "Close Build", exact: true })
          .click();
        await expect(build).toHaveCount(0);
        await expect(fleet).toBeVisible();
        await expect(trigger).toBeFocused();
        await buyer
          .getByRole("button", { name: "Close Fleet", exact: true })
          .click();
      } else if (count === 2) {
        const dockBuild = buyer
          .getByRole("navigation", { name: "Game actions" })
          .getByRole("button", { name: "Build", exact: true });
        const project = buyer.getByRole("dialog", {
          name: "Build",
          exact: true,
        });
        const storage = project.getByRole("tab", {
          name: "Storage",
          exact: true,
        });
        const battery = project
          .getByRole("tabpanel", {
            name: "Storage",
            exact: true,
          })
          .getByRole("button", {
            name: "Review purchase of Lithium Battery",
            exact: true,
          });
        const generators = project.getByRole("tab", {
          name: "Generators",
          exact: true,
        });
        const close = project.getByRole("button", {
          name: "Close project",
          exact: true,
        });
        await dockBuild.click();
        await storage.click();
        await close.click();
        await expect(project).toHaveCount(0);
        await dockBuild.click();
        await expect(storage).toHaveAttribute("aria-selected", "true");
        await expect(battery).toBeVisible();
        await generators.click();
        await close.click();
        await expect(project).toHaveCount(0);
        await buyer.keyboard.press("Shift+s");
        await expect(storage).toHaveAttribute("aria-selected", "true");
        await expect(battery).toBeVisible();
        await generators.click();
        await close.click();
      }
      const buyerGame = (await projection(buyer))!.game!;
      const before = buyerGame.facilities.length;
      const site = multiplayerTerritoryTiles(buyerGame).find(
        (tile) =>
          buyerGame.multiplayer!.territorial!.startingTileIds.includes(
            tile.id,
          ) &&
          !tile.city &&
          !buyerGame.facilities.some(({ tileId }) => tileId === tile.id),
      )!;
      await selectTerritoryMapTile(buyer, site, territorialMap(buyer));
      await buyer
        .getByRole("button", { name: "Build here", exact: true })
        .click();
      await buyer
        .getByRole("button", { name: "Review purchase of Wind", exact: true })
        .click();
      await buyer
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect
        .poll(async () => (await captureState(buyer)).facilities)
        .toBe(before + 1);
      expect(
        (await projection(buyer))!.game!.facilities.find(
          ({ tileId }) => tileId === site.id,
        )?.name,
      ).toBe("Wind");
      for (const page of campaign.players)
        await expect(clock(page)).toHaveAttribute("data-active-speed", "SLOW");
      await selectSpeed(host, "pause");
      await selectSpeed(buyer, "normal speed");
      for (const page of campaign.players)
        await expect(clock(page)).toHaveAttribute(
          "data-active-speed",
          "PAUSED",
        );
      await selectSpeed(host, "ultra speed");
      await expect(clock(buyer)).toHaveAttribute(
        "data-active-speed",
        count === 2 ? "NORMAL" : "SLOW",
      );
      await saveAndQuit(buyer);
      await saveAndQuit(host);
      await expect
        .poll(
          async () =>
            (await campaign.fixture.checkpoint())?.grids.at(-1)?.facilities
              .length,
        )
        .toBe(before + 1);
      expect(campaign.errors).toEqual([]);
    },
  );
}

test(
  "V2 companies claim a border and both approve its construction",
  { tag: ["@mobile", "@territorial"] },
  async ({ newIsolatedContext }, info) => {
    const compact = !!info.project.use.isMobile;
    const width = info.project.use.viewport?.width;
    const campaign = await startCustom(
      newIsolatedContext,
      2,
      compact,
      false,
      width,
    );
    const [host, guest] = campaign.players;
    const hostId = (await projection(host))!.game!.multiplayer!.seat;
    const guestId = (await projection(guest))!.game!.multiplayer!.seat;
    const hostGame = () => projection(host).then((view) => view!.game!);
    await expect(
      territorialMap(host).locator("canvas.territory3DCanvas"),
    ).toHaveAttribute("data-renderer", "ready");
    await host.mouse.move(1, 1);
    if (!compact && process.env.REVIEW_SCREENSHOT_DIR) {
      const viewport = territorialMap(host).locator(".territoryMapViewport");
      const openingScale = Number(
        await viewport.getAttribute("data-camera-scale"),
      );
      const bounds = (await viewport.boundingBox())!;
      await host.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await host.mouse.wheel(0, 340);
      await expect
        .poll(async () =>
          Number(await viewport.getAttribute("data-camera-scale")),
        )
        .toBeLessThan(openingScale);
      await host.mouse.move(1, 1);
      await reviewScreenshot(host, {
        path: info.outputPath("territorial-desktop.png"),
        animations: "disabled",
      });
    }
    await claimToPeerBorder(
      host,
      guestId,
      hostGame,
      compact && width === 390
        ? () =>
            reviewScreenshot(host, {
              path: info.outputPath("territorial-phone.png"),
              animations: "disabled",
            })
        : undefined,
    );
    await expect
      .poll(async () => (await hostGame()).multiplayer!.peers![0].border)
      .toBeTruthy();
    await expect
      .poll(
        async () =>
          (await projection(guest))!.game!.multiplayer!.peers![0].border,
      )
      .toBeTruthy();

    for (const page of [host, guest])
      await page
        .getByRole("button", { name: "Agreements", exact: true })
        .click();
    await host
      .getByRole("button", {
        name: "Review connection with WindyWren",
        exact: true,
      })
      .click();
    await host
      .getByRole("button", { name: "Propose connection", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await projection(guest))!.game!.multiplayer!.peers![0]
            .connectionRequestedBy,
      )
      .toBeTruthy();
    expect((await hostGame()).transmission!.lines).toEqual([]);
    await guest
      .getByRole("button", {
        name: "Review connection from SolarSam",
        exact: true,
      })
      .click();
    await guest
      .getByRole("button", { name: "Accept connection", exact: true })
      .click();
    for (const page of [host, guest]) {
      await expect
        .poll(
          async () =>
            (await projection(page))!.game!.transmission!.lines[0]
              ?.yearsToBuildLeft,
        )
        .toBeGreaterThan(0);
      const peer = (await projection(page))!.game!.multiplayer!.peers![0];
      expect(peer.endpoints).toBeDefined();
      expect(peer.connected).toBeFalsy();
    }
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const saved = await campaign.fixture.checkpoint();
    expect(saved?.spec.territorialVersion).toBe(2);
    expect(
      saved?.grids.find((grid) => grid.multiplayer?.seat === hostId)
        ?.multiplayer?.territorial?.claims.length,
    ).toBeGreaterThan(0);
    expect(saved?.edges[0]).toMatchObject({ ratingW: 0, flowW: 0 });
    expect(campaign.errors).toEqual([]);
  },
);

test(
  "V2 restores the confirmed save with the original host and keeps both company seats",
  { tag: "@mobile" },
  async ({ newIsolatedContext }, info) => {
    const campaign = await startCustom(
      newIsolatedContext,
      2,
      !!info.project.use.isMobile,
    );
    const [host, guest] = campaign.players;
    const original = await Promise.all(campaign.players.map(captureState));
    expect(original[0].seat).toBeTruthy();
    expect(original[1].seat).toBeTruthy();
    expect(original[0].seat).not.toBe(original[1].seat);
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const confirmed = await campaign.fixture.checkpoint();
    expect(confirmed?.matchId).toBe(original[0].matchId);
    await campaign.resume(host);
    expect(campaign.fixture.hostSeat(host)).toBe(campaign.fixture.seatId(host));
    for (const [index, page] of campaign.players.entries()) {
      const now = await captureState(page);
      expect(now.matchId).toBe(original[index].matchId);
      expect(now.seat).toBe(original[index].seat);
      expect(now.epoch).not.toBe(original[index].epoch);
      await expect(clock(page)).toHaveAttribute("data-active-speed", "PAUSED");
    }
    expect(campaign.errors).toEqual([]);
  },
);

test("V2 saves are named for their players and Delete removes one at once", async ({
  newIsolatedContext,
}) => {
  const campaign = await startCustom(newIsolatedContext, 2, false);
  const [host, guest] = campaign.players;
  await saveAndQuit(guest);
  await saveAndQuit(host);
  const confirmed = await campaign.fixture.checkpoint();
  await guest.setViewportSize({ width: 360, height: 640 });
  const library = await openCampaignSaves(guest);
  // Every multiplayer save is the same scenario, so a save is named for who played it.
  // (The dialog's own title is also a level-2 heading, so match the save's name.)
  await expect(
    library.getByRole("heading", { level: 2, name: /\S+, \S+/ }),
  ).toHaveCount(1);
  await expect(library.getByText("Custom Game")).toHaveCount(0);
  const actions = library.getByRole("button", { name: /^Actions for / });
  await actions.click();
  await expect(guest.getByRole("menuitem")).toHaveText(["Delete"]);
  await guest.getByRole("menuitem", { name: "Delete", exact: true }).click();
  // No confirmation or explanation: the save is gone from this account's list.
  await expect(library.getByText("No multiplayer saves yet")).toBeVisible();
  await expect(guest.getByRole("dialog", { name: /Delete/ })).toHaveCount(0);
  const hostLibrary = await openCampaignSaves(host);
  await expect(hostLibrary.getByRole("button", { name: "Load" })).toBeVisible();
  expect(await campaign.fixture.checkpoint()).toEqual(confirmed);
  expect(campaign.errors).toEqual([]);
});

test(
  "V2 rejects stale guest authority and reconnects to the original host",
  { tag: "@mobile" },
  async ({ newIsolatedContext }, info) => {
    const campaign = await startCustom(
      newIsolatedContext,
      2,
      !!info.project.use.isMobile,
    );
    const [host, guest] = campaign.players;
    for (const page of campaign.players) await selectSpeed(page, "slow speed");
    await expect(clock(host)).toHaveAttribute("data-active-speed", "SLOW");
    const original = await captureState(guest);
    const gameControl = clock(guest).getByRole("button", {
      name: "slow speed",
    });
    await gameControl.focus();
    const operationCount = campaign.fixture.operations.length;
    campaign.fixture.loseAuthority(guest);
    const warning = guest.getByRole("dialog", {
      name: "Multiplayer connection",
      exact: true,
    });
    await expect(warning).toHaveAccessibleDescription(
      /(?:waiting for the host|connection .* was interrupted).*Reconnect to get back into this match/i,
    );
    const reconnect = warning.getByRole("button", {
      name: "Reconnect",
      exact: true,
    });
    await expect(reconnect).toBeFocused();
    await expect(
      warning.getByRole("button", { name: "Return to main menu", exact: true }),
    ).toBeVisible();
    await guest.keyboard.press("Escape");
    await expect(warning).toBeVisible();
    await campaign.fixture.disconnect(guest);
    await reconnect.click();
    await expect
      .poll(() =>
        campaign.fixture.operations
          .slice(operationCount)
          .some(
            ({ page, operation, status }) =>
              page === guest &&
              operation === "room/reconnect" &&
              status === 503,
          ),
      )
      .toBe(true);
    await expect(warning).toBeVisible();
    await expect(reconnect).toBeEnabled();
    const viewSequence = () =>
      guest.evaluate(() => (window as MultiplayerWindow).viewSequence ?? 0);
    const beforeReconnect = await viewSequence();
    campaign.fixture.reconnect(guest);
    campaign.fixture.restoreAuthority(guest);
    await reconnect.click();
    await expect
      .poll(() =>
        campaign.fixture.operations
          .slice(operationCount)
          .some(
            ({ page, operation, status }) =>
              page === guest && operation === "transfer/get" && status === 200,
          ),
      )
      .toBe(true);
    await expect(warning).toBeHidden();
    await expect(gameControl).toBeFocused();
    await expect.poll(viewSequence).toBeGreaterThan(beforeReconnect);
    expect(await captureState(guest)).toMatchObject({
      epoch: original.epoch,
      matchId: original.matchId,
      seat: original.seat,
    });
    for (const page of campaign.players)
      await selectSpeed(page, "normal speed");
    for (const page of campaign.players)
      await expect(clock(page)).toHaveAttribute("data-active-speed", "NORMAL");
    expect(campaign.errors).toEqual([]);
  },
);

test(
  "V2 routes an expired multiplayer session through the confirmed save",
  { tag: "@mobile" },
  async ({ newIsolatedContext }, info) => {
    const compact = !!info.project.use.isMobile;
    const campaign = await startCustom(newIsolatedContext, 2, compact);
    const [host, guest] = campaign.players;
    if (compact) await guest.setViewportSize({ width: 360, height: 640 });
    const original = await Promise.all(campaign.players.map(captureState));
    const confirmed = await campaign.fixture.checkpoint();
    expect(confirmed?.matchId).toBe(original[1].matchId);
    for (const page of campaign.players) await selectSpeed(page, "slow speed");
    await expect
      .poll(async () => (await projection(guest))?.revision ?? 0)
      .toBeGreaterThan(confirmed!.revision);
    campaign.fixture.loseAuthority(guest);
    const interrupted = guest.getByRole("dialog", {
      name: "Multiplayer connection",
      exact: true,
    });
    await expect(interrupted).toBeVisible();
    await reviewScreenshot(interrupted, {
      path: info.outputPath("multiplayer-reconnect.png"),
      animations: "disabled",
    });

    campaign.fixture.expireHost();
    campaign.fixture.restoreAuthority(guest);
    await interrupted
      .getByRole("button", { name: "Reconnect", exact: true })
      .click();

    const ended = guest.getByRole("dialog", {
      name: "This match isn't open",
      exact: true,
    });
    expect(campaign.fixture.hostSeat(guest)).not.toBe(
      campaign.fixture.seatId(guest),
    );
    await expect(ended).toHaveAccessibleDescription(
      /Wait for the host to continue it/,
    );
    await expect(guest.getByRole("dialog")).toHaveCount(1);
    await expect(ended.getByRole("button")).toHaveCount(1);
    const returnToMenu = ended.getByRole("button", {
      name: "Return to main menu",
      exact: true,
    });
    expect((await returnToMenu.boundingBox())?.height).toBeGreaterThanOrEqual(
      compact ? 44 : 40,
    );
    const bounds = await ended.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(compact ? 360 : 1280);
    await reviewScreenshot(ended, {
      path: info.outputPath("multiplayer-session-ended.png"),
      animations: "disabled",
    });
    await guest.keyboard.press("Escape");
    await expect(ended).toBeVisible();

    const renewedOutageStart = campaign.fixture.operations.length;
    campaign.fixture.loseAuthority(guest);
    await expect
      .poll(
        () =>
          campaign.fixture.operations
            .slice(renewedOutageStart)
            .filter(
              ({ page, operation, status }) =>
                page === guest && operation === "room/state" && status === 503,
            ).length,
      )
      .toBeGreaterThanOrEqual(3);
    await expect(ended).toBeVisible();

    const exitStart = campaign.fixture.operations.length;
    await returnToMenu.click();
    await expect(entry(guest)).toBeFocused();
    expect(
      campaign.fixture.operations
        .slice(exitStart)
        .filter(
          ({ page, operation }) =>
            page === guest && operation === "save/publish",
        ),
    ).toHaveLength(0);
    expect(await campaign.fixture.checkpoint()).toEqual(confirmed);
    campaign.fixture.restoreAuthority(guest);

    await saveAndQuit(host);
    await campaign.resume(host);
    for (const [index, page] of campaign.players.entries()) {
      await expect(grid(page)).toBeVisible();
      expect(await captureState(page)).toMatchObject({
        matchId: confirmed!.matchId,
        seat: original[index].seat,
      });
      expect((await captureState(page)).epoch).not.toBe(original[index].epoch);
    }
    expect(campaign.errors).toEqual([]);
  },
);

test("V2 speed controls fit the toolbar and expose shared status across themes", async ({
  newIsolatedContext,
}) => {
  const campaign = await startCustom(newIsolatedContext, 2, false, true);
  const [host, guest] = campaign.players;
  for (const page of campaign.players) await selectSpeed(page, "slow speed");
  for (const width of [1440, 1280, 800, 390, 360]) {
    const player = width < 600 ? guest : host;
    await player.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await player.emulateMedia({ colorScheme });
      await expect(player.locator("html")).toHaveAttribute(
        "data-theme",
        colorScheme,
      );
      await expect(clock(player)).toBeInViewport();
      await expect(async () => {
        const gap = await clock(player).evaluate((group) => {
          const toolbar = group.closest(".MuiToolbar-root")!;
          const edge =
            toolbar.getBoundingClientRect().right -
            parseFloat(getComputedStyle(toolbar).paddingRight);
          return edge - group.getBoundingClientRect().right;
        });
        expect(Math.abs(gap)).toBeLessThanOrEqual(1);
      }).toPass();
      await expect(clock(player)).toHaveAccessibleDescription(
        player === host ? /WindyWren selected 1×/ : /SolarSam selected 1×/,
      );
    }
  }
  await reviewScreenshot(guest.locator("#appbar"), {
    path: test.info().outputPath("v2-mobile-speed.png"),
    animations: "disabled",
  });
  expect(campaign.errors).toEqual([]);
});

const cooperativeMod = (published: boolean): InstalledMod => ({
  key: "local:cooperative-grid",
  source: "local",
  enabled: true,
  ...(published ? { workshopId: "777" } : {}),
  pack: {
    schemaVersion: 1,
    gameApi: 1,
    id: "cooperative-grid",
    title: "Cooperative Grid",
    creator: "Community engineer",
    version: "1.0",
    description: "Choose funding for your grid before its first month begins.",
    seed: 42,
    baseScenarioId: 999,
    officialArcs: [],
    scenario: {
      durationMonths: 6,
      startingYear: 2020,
      startingCustomers: 10000,
      cash: 1000000000,
      dollarsPerkWh: 0.2,
    },
    objectives: [
      {
        id: "affordable",
        label: "Keep bills affordable",
        metric: "monthlyBilledRate",
        maxDollarsPerKWh: 1,
        fromMonth: 1,
        throughMonth: 6,
      },
    ],
    choices: [
      {
        id: "funding",
        title: "Grid funding",
        prompt: "Choose whether your company accepts support.",
        dueMonth: 1,
        options: [
          {
            id: "accept",
            label: "Accept funding",
            description: "Receive support for your own grid.",
            message: "Your company accepted funding.",
            grantDollars: 1000000,
          },
          {
            id: "decline",
            label: "Keep the current plan",
            description: "Keep your current plan without a grant.",
            message: "Your company kept its current plan.",
            costDollars: 0,
          },
        ],
      },
    ],
    events: [
      {
        id: "announced-support",
        title: "Opening grid support",
        message: "Operating costs fall for your grid.",
        preview: "Operating costs will fall for your grid.",
        startMonth: 1,
        durationMonths: 2,
        effects: { operatingCostMultipliersByFuel: { "Natural Gas": 0.9 } },
      },
      {
        id: "hidden-change",
        title: "Private surprise",
        message: "Supply conditions change for your grid.",
        startMonth: 4,
        durationMonths: 1,
        visibility: "surprise",
        effects: { outputMultipliersByFuel: { "Natural Gas": 0.9 } },
      },
    ],
  },
});

/** Observe the real projection worker boundary; requests and replies are passed through intact. */
async function observeNativeForecasts(page: Page) {
  await page.addInitScript(() => {
    const target = window as MultiplayerWindow;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly observationId: number;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.observationId = target.nativeWorkerSequence =
          (target.nativeWorkerSequence ?? 0) + 1;
        this.addEventListener("message", (event) => {
          if (event.data.transport)
            (target.nativeForecastReplies ??= []).push(
              `${this.observationId}:${event.data.requestId}`,
            );
        });
      }
      postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        if (
          message &&
          typeof message === "object" &&
          "game" in message &&
          "now" in message &&
          "requestId" in message
        ) {
          const request = message as { requestId: number; game: GameType };
          (target.nativeForecasts ??= []).push({
            id: `${this.observationId}:${request.requestId}`,
            scenarioId: request.game.scenarioId,
            hasCustomScenario: request.game.customScenario !== undefined,
            seed: request.game.seed,
            loads: request.game.loadAdditions.map((load) => ({ ...load })),
            responses: request.game.worldEvents.occurrences
              .filter((event) => typeof event.attributes.choice === "string")
              .map((event) => ({
                key: event.key,
                optionId: String(event.attributes.choice),
              })),
          });
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
}

async function buyNativeBackup(page: Page, peakW: number, rate: number) {
  await page.locator(".button-buildFacility").click();
  await page.locator(".button-buildGenerator").click();
  const capacity = page.getByRole("slider", { name: /^Capacity/ });
  await capacity.press("Home");
  for (let tick = 0; tick < wToSliderTick(peakW); tick++)
    await capacity.press("ArrowRight");
  await expect(page.locator("#construction-capacity")).toContainText(
    peakW === 50e6 ? /50\s?MW/ : /2\s?GW/,
  );
  await page
    .getByRole("button", {
      name: "Review purchase of Natural Gas Peaker",
      exact: true,
    })
    .click();
  const purchase = page.getByRole("dialog", { name: /^Build / });
  await purchase
    .getByRole("button", { name: "Take loan", exact: true })
    .click();
  await expect(purchase).toBeHidden();
  const build = page.getByRole("region", { name: "Build", exact: true });
  // Desktop rails support repeated purchases; compact sheets close after a purchase.
  if (page.viewportSize()!.width >= 1024) {
    await expect(build).toBeVisible();
    await build
      .getByRole("button", { name: "Close Build", exact: true })
      .click();
  }
  await expect(build).toHaveCount(0);
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  await openPane(
    programs,
    page.getByRole("button", { name: "Programs", exact: true }),
  );
  const price = programs.getByRole("slider", {
    name: "The rate you charge for electricity generation",
    exact: true,
  });
  const opening = Number(await price.getAttribute("aria-valuenow"));
  for (let tick = 0; tick < Math.round((rate - opening) / 0.01); tick++)
    await price.press("ArrowRight");
  if (rate === 0.1) {
    expect(Number(await price.getAttribute("aria-valuenow"))).toBeCloseTo(
      0.1,
      12,
    );
    await expect(price).toHaveAttribute(
      "aria-valuetext",
      /^\$0\.1 per kilowatt-hour/,
    );
  } else await expect(price).toHaveAttribute("aria-valuenow", String(rate));
  await page.keyboard.press("Escape");
}

test(
  "12x multiplayer speed controls respond while video chat is encoding",
  { tag: "@mobile" },
  async ({ newIsolatedContext }, info) => {
    const { players: pages, errors } = await startCustom(
      newIsolatedContext,
      2,
      !!info.project.use.isMobile,
    );
    const host = pages[0];
    const cdp = await host.context().newCDPSession(host);
    // Reserve CPU headroom for the competing call, on a production desktop renderer too.
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await host.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      let frame = 0;
      const draw = () => {
        for (let x = 0; x < 640; x += 20) {
          context.fillStyle = `hsl(${(frame * 7 + x) % 360} 50% 50%)`;
          context.fillRect(x, 0, 20, 360);
        }
        frame++;
      };
      draw();
      const timer = window.setInterval(draw, 1000 / 30);
      const stream = canvas.captureStream(30);
      const sender = new RTCPeerConnection();
      const receiver = new RTCPeerConnection();
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      // Exercise encoding, decoding and video presentation without covering the game controls.
      Object.assign(video.style, {
        position: "fixed",
        width: "160px",
        height: "90px",
        bottom: "0",
        right: "0",
        pointerEvents: "none",
      });
      document.body.append(video);
      receiver.ontrack = (event) => {
        video.srcObject = event.streams[0];
      };
      sender.onicecandidate = (event) => {
        if (event.candidate) void receiver.addIceCandidate(event.candidate);
      };
      receiver.onicecandidate = (event) => {
        if (event.candidate) void sender.addIceCandidate(event.candidate);
      };
      stream.getTracks().forEach((track) => sender.addTrack(track, stream));
      await sender.setLocalDescription(await sender.createOffer());
      await receiver.setRemoteDescription(sender.localDescription!);
      await receiver.setLocalDescription(await receiver.createAnswer());
      await sender.setRemoteDescription(receiver.localDescription!);
      (window as MultiplayerWindow).videoWorkload = {
        frames: async () => {
          let encoded = 0;
          (await sender.getStats()).forEach((report) => {
            if (report.type === "outbound-rtp" && report.kind === "video")
              encoded += report.framesEncoded ?? 0;
          });
          return encoded;
        },
        stop: () => {
          clearInterval(timer);
          stream.getTracks().forEach((track) => track.stop());
          sender.close();
          receiver.close();
          video.remove();
        },
      };
    });
    const responses: { input: string; ms: number }[] = [];
    const frames = () =>
      host.evaluate(() =>
        (window as MultiplayerWindow).videoWorkload!.frames(),
      );
    try {
      await expect.poll(frames).toBeGreaterThan(10);
      for (const page of pages) await selectSpeed(page, "slow speed");
      for (const page of pages)
        await clock(page)
          .getByRole("button", { name: "fast speed", exact: true })
          .click();
      await expect(clock(host)).toHaveAttribute("data-active-speed", "FAST");
      await expect
        .poll(
          () =>
            pages[1].evaluate(
              () =>
                (window as MultiplayerWindow).observedRoomView?.game?.date
                  .monthsElapsed,
            ),
          {
            timeout: 60000,
          },
        )
        .toBeGreaterThanOrEqual(12);
      const encodedBefore = await frames();
      for (const page of pages) {
        for (const [key, speed] of [
          ["1", "SLOW"],
          ["3", "FAST"],
          ["0", "PAUSED"],
          ["3", "FAST"],
        ]) {
          const started = Date.now();
          await page.keyboard.press(key);
          for (const peer of pages)
            await expect(clock(peer)).toHaveAttribute(
              "data-active-speed",
              speed,
              { timeout: 3000 },
            );
          responses.push({ input: `key ${key}`, ms: Date.now() - started });
        }
        const started = Date.now();
        await clock(page)
          .getByRole("button", { name: "normal speed", exact: true })
          .click({ timeout: 3000 });
        for (const peer of pages)
          await expect(clock(peer)).toHaveAttribute(
            "data-active-speed",
            "NORMAL",
            { timeout: 3000 },
          );
        responses.push({ input: "click 3x", ms: Date.now() - started });
        await page.keyboard.press("3");
        for (const peer of pages)
          await expect(clock(peer)).toHaveAttribute(
            "data-active-speed",
            "FAST",
          );
      }
      await expect.poll(frames).toBeGreaterThan(encodedBefore);
      expect(errors).toEqual([]);
      await test.info().attach("speed-response-under-video-load", {
        body: JSON.stringify(responses),
        contentType: "application/json",
      });
    } finally {
      await host.evaluate(() =>
        (window as MultiplayerWindow).videoWorkload!.stop(),
      );
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await cdp.detach();
    }
  },
);

for (const width of [1280, 360]) {
  test(`online co-op opens custom setup without a catalog at ${width}px`, async ({
    newIsolatedContext,
  }) => {
    const names = ["W".repeat(18), "M".repeat(18)];
    const campaign = new V2Campaign(
      newIsolatedContext,
      [[cooperativeMod(width === 1280)], []],
      names,
    );
    const host = await campaign.addPlayer(width);
    const guest = await campaign.addPlayer(width);
    const invite = await campaign.create(host);
    await campaign.requestJoin(guest, invite);
    await campaign.waitForGuest(host, guest);

    for (const page of campaign.players) {
      const setup = page.getByRole("heading", { name: "Custom setup" });
      await expect(setup).toBeVisible();
      await expect(page.getByTestId("community-scenarios")).toHaveCount(0);
      await expect(page.getByTestId("mission-row-106")).toHaveCount(0);
      const roster = page.getByRole("list", { name: "Players", exact: true });
      await expect(roster).toContainText(names[0]);
      await expect(roster).toContainText(names[1]);
      expect(
        await roster.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await campaign.start();
    expect((await campaign.fixture.checkpoint())?.spec.scenarioId).toBe(999);
    expect(campaign.errors).toEqual([]);
  });
}

for (const [scenarioId, width] of [
  [106, 1280],
  [107, 390],
] as const) {
  test(`native ${scenarioId} companies choose independently and resume the same V2 campaign at ${width}px`, async ({
    newIsolatedContext,
    advanceWorldSave,
  }) => {
    test.setTimeout(240000);
    const campaign = new V2Campaign(newIsolatedContext);
    const host = await campaign.addPlayer(width, true, scenarioId),
      guest = await campaign.addPlayer(width);
    for (const page of campaign.players) {
      await observeNativeForecasts(page);
      await page.reload();
    }
    await entry(host).click();
    await entry(guest).click();
    const invite = await campaign.create(host);
    await campaign.requestJoin(guest, invite);
    await campaign.waitForGuest(host, guest);
    await campaign.start();

    const opening = await captureState(guest);
    expect(opening).toMatchObject({
      scenarioId,
      ...(scenarioId === 107 && { seed: 268107 }),
    });
    const peak = scenarioId === 106 ? 50e6 : 2e9;
    const rate = scenarioId === 106 ? 0.12 : 0.1;
    const goal =
      scenarioId === 106 ? "Retain the community" : "Keep power flowing";
    const target =
      scenarioId === 106
        ? "Keep ≥90% of customer baseline by Dec 2035"
        : "Serving less than 95% of demand for 3 months in a row ends the run.";
    const showGoal = async (page: Page) => {
      const panel = page.getByRole("region", { name: "Scenario", exact: true });
      await openPane(
        panel,
        page.getByRole("button", { name: "Scenario", exact: true }),
      );
      await expect(panel).toContainText(goal);
      await expect(panel.getByRole("region", { name: "Goals" })).toContainText(
        target,
      );
      await expect(panel).not.toContainText("Modded");
      await page.keyboard.press("Escape");
    };
    for (const page of campaign.players) {
      await buyNativeBackup(page, peak, rate);
      await showGoal(page);
    }
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const world = await campaign.fixture.checkpoint();
    expect(
      world?.grids.every((game) =>
        game.facilities.some(
          (facility) =>
            facility.name === "Natural Gas Peaker" && facility.peakW === peak,
        ),
      ),
    ).toBe(true);
    const due = scenarioId === 106 ? 48 : 36;
    const advanced = await advanceWorldSave(
      world!,
      due - 1,
      test.info().outputPath("native-world.json"),
    );
    await campaign.fixture.replaceCheckpoint(advanced);
    await campaign.resume(host);
    for (const page of campaign.players) await selectSpeed(page, "ultra speed");

    const title =
      scenarioId === 106
        ? /Negotiate the data-center connection/
        : /Prepare for the deep freeze/;
    const dialogs = campaign.players.map((page) =>
      page.getByRole("dialog", { name: title }),
    );
    await expect(dialogs[0]).toBeVisible({ timeout: 120000 });
    await expect(dialogs[1]).toBeVisible();
    await expect.poll(async () => (await captureState(guest)).month).toBe(due);
    for (const [index, dialog] of dialogs.entries()) {
      await expect(dialog).toContainText(`Your company: ${companies[index]}`);
      await expect(dialog).toContainText(
        "Each company chooses for its own grid.",
      );
      for (const button of await dialog.getByRole("button").all()) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
    }
    await guest.keyboard.press("Escape");
    await expect(dialogs[1]).toBeVisible();
    const key =
      scenarioId === 106
        ? "story:106:data-center-boom:connection"
        : "story:107:texas-deep-freeze:winterization";
    const options =
      scenarioId === 106 ? ["fast-track", "phased"] : ["winterize", "standard"];
    const buttons =
      scenarioId === 106
        ? [/^Accept funded connection$/, /^Require phased connections$/]
        : [/^Retrofit remaining plants/, /^Keep construction budget$/];
    await dialogs[0].getByRole("button", { name: buttons[0] }).click();
    await expect(dialogs[0]).toBeHidden();
    await expect(dialogs[1]).toContainText("Still deciding: WindyWren");
    await selectSpeed(host, "pause");
    await dialogs[1].getByRole("button", { name: buttons[1] }).click();
    await expect(dialogs[1]).toBeHidden();
    for (const [index, page] of campaign.players.entries()) {
      await openPane(
        page.locator(".insights"),
        page.getByRole("button", { name: "Insights", exact: true }),
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ key, option }) => {
                const target = window as MultiplayerWindow;
                return target.nativeForecasts?.findLast(
                  (request) =>
                    request.responses.some(
                      (response) =>
                        response.key === key && response.optionId === option,
                    ) && target.nativeForecastReplies?.includes(request.id),
                );
              },
              { key, option: options[index] },
            ),
          { timeout: 60000 },
        )
        .toMatchObject({
          scenarioId,
          seed: opening.seed,
          hasCustomScenario: false,
          ...(scenarioId === 106 && {
            loads:
              index === 0
                ? [expect.objectContaining({ peakW: 100e6, startsYear: 2026 })]
                : [
                    expect.objectContaining({ peakW: 50e6, startsYear: 2026 }),
                    expect.objectContaining({ peakW: 50e6, startsYear: 2028 }),
                  ],
          }),
        });
      await expect(
        page
          .locator(".insights:visible")
          .getByRole("img", {
            name: /^(Chart of|Monthly ranges of).*?(demand|supply)/i,
          })
          .first(),
      ).toBeVisible({ timeout: 60000 });
      await page.keyboard.press("Escape");
    }
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const latest = await campaign.fixture.checkpoint();
    expect(
      latest?.grids.map(
        (game) =>
          game.worldEvents.occurrences.find((event) => event.key === key)
            ?.attributes.choice,
      ),
    ).toEqual(options);
    expect(
      latest?.grids.every(
        (game) =>
          game.scenarioId === scenarioId &&
          game.seed === opening.seed &&
          !game.customScenario &&
          !game.runIdentity,
      ),
    ).toBe(true);
    for (const [index, game] of latest!.grids.entries()) {
      const receipt = game.worldEvents.occurrences.find(
        (event) => event.key === key,
      )!;
      const retrofitPayments = game.worldEvents.occurrences.filter(
        (event) =>
          event.attributes.retrofit === true &&
          event.startsMinute === receipt.startsMinute,
      );
      expect(receipt.attributes.cost).toBe(0);
      expect(retrofitPayments.length > 0).toBe(
        scenarioId === 107 && index === 0,
      );
      expect(Number(receipt.attributes.retrofitCost ?? 0)).toBe(
        retrofitPayments.reduce(
          (sum, event) => sum + Number(event.attributes.cost),
          0,
        ),
      );
      expect(receipt.attributes.upfrontGrant).toBe(
        scenarioId === 106 && index === 0 ? 15e6 : 0,
      );
    }
    await campaign.resume(host);
    await showGoal(guest);
    expect((await captureState(guest)).seat).toBe(opening.seat);
    expect((await captureState(guest)).matchId).toBe(opening.matchId);
    expect(campaign.errors).toEqual([]);
  });
}

test("players can leave while saves are unavailable and the last checkpoint remains", async ({
  newIsolatedContext,
}) => {
  const campaign = await startCustom(newIsolatedContext, 2, false);
  const [host, guest] = campaign.players;
  const confirmed = await campaign.fixture.checkpoint();
  expect(confirmed?.matchId).toBeTruthy();

  campaign.fixture.failSaves("unavailable");
  await saveAndQuit(guest);
  await expect(grid(host)).toBeVisible();
  await saveAndQuit(host);
  await expect(entry(host)).toBeVisible();
  await expect(entry(guest)).toBeVisible();
  expect(await campaign.fixture.checkpoint()).toEqual(confirmed);
  expect(campaign.errors).toEqual([]);
});
