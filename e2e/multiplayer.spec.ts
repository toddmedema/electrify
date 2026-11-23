/* eslint-disable testing-library/prefer-screen-queries -- Playwright owns browser queries. */
import { readFile } from "node:fs/promises";
import { unlockAllDifficulties } from "./difficulty-fixture";
import { expect, isolateAnalytics, type Browser, type Page } from "./fixtures";
import { test } from "./advance-world";
import { crossplayFixture } from "./crossplay-fixture";
import { verifyMenuKeyboard } from "./menu-keyboard";
import { reviewScreenshot } from "./review-screenshot";
import { openPane } from "./layout";
import type { InstalledMod, ModLibrary, ModRequest } from "../src/mods/Types";
import type { RoomView } from "../src/multiplayer/Types";
import type { GameType } from "../src/Types";
import { wToSliderTick } from "../src/helpers/BuildSizing";

const companies = ["SolarSam", "WindyWren", "HydroHal", "VoltVera"];
const lobby = (page: Page) =>
  page.getByRole("dialog", { name: "Play with friends", exact: true });
const entry = (page: Page) =>
  page.getByRole("button", { name: "Play with friends", exact: true });
const clock = (page: Page) =>
  page.locator(".multiplayerSpeedToggles:visible").last();
const grid = (page: Page) => page.locator(".facilities:visible");

type MultiplayerWindow = Window & {
  observedRoomView?: RoomView;
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
    private readonly browser: Browser,
    private readonly installedMods: InstalledMod[][] = [],
    private readonly names: readonly string[] = companies,
  ) {}

  async addPlayer(width = 1280, open = true) {
    const index = this.players.length;
    const name = this.names[index];
    const context = await this.browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      colorScheme: index % 2 ? "dark" : "light",
      hasTouch: width < 600,
      isMobile: width < 600,
      permissions: ["clipboard-read", "clipboard-write"],
      reducedMotion: "reduce",
    });
    await isolateAnalytics(context);
    const page = await context.newPage();
    this.players.push(page);
    page.on("pageerror", (error) => this.errors.push(error.message));
    await unlockAllDifficulties(page);
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
      ({ name, index }) => {
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
              if (view?.game) target.observedRoomView = view;
            });
          }
        };
      },
      { name, index },
    );
    await page.goto("/");
    if (open) await entry(page).click();
    return page;
  }

  async create(host: Page) {
    await lobby(host).getByRole("button", { name: "Host a game" }).click();
    return lobby(host)
      .getByText(/^[0-9a-f]{20}$/i, { exact: true })
      .innerText();
  }

  async requestJoin(guest: Page, invite: string) {
    await lobby(guest)
      .getByRole("textbox", { name: "Invite code" })
      .fill(invite);
    await lobby(guest)
      .getByRole("button", { name: "Join", exact: true })
      .click();
  }

  async approve(host: Page, guest: Page) {
    const name = this.names[this.players.indexOf(guest)];
    await expect(lobby(guest)).toContainText(/waiting for.*approv/i);
    const row = lobby(host)
      .getByText(`${name} asked to join`, { exact: true })
      .locator("..");
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(
      lobby(host).getByText(`${name} · Connected`, { exact: true }),
    ).toBeVisible();
  }

  async choose(host: Page) {
    await lobby(host).getByRole("button", { name: "Choose a game" }).click();
    await expect(host.getByTestId("mission-row-999")).toBeVisible();
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
            .getByRole("button", { name: "Load save", exact: true })
        : library.getByRole("button", { name: "Load save", exact: true });
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

async function startCustom(browser: Browser, count: number, compact: boolean) {
  const campaign = new V2Campaign(browser);
  const host = await campaign.addPlayer(compact ? 390 : 1280);
  const invite = await campaign.create(host);
  for (let index = 1; index < count; index++) {
    const guest = await campaign.addPlayer(compact || index === 3 ? 390 : 1280);
    await campaign.requestJoin(guest, invite);
    await campaign.approve(host, guest);
  }
  await campaign.choose(host);
  await host.getByTestId("mission-row-999").click();
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
      rate: view?.game?.dollarsPerkWh,
      month: view?.game?.date.monthsElapsed,
    };
  });

async function saveAndQuit(page: Page) {
  await page.getByRole("button", { name: /^menu/i }).click();
  await page
    .getByRole("menuitem", { name: "Save & Quit", exact: true })
    .click();
  await expect(entry(page)).toBeVisible();
}

async function openCampaignSaves(page: Page) {
  await entry(page).click();
  await lobby(page)
    .getByRole("button", { name: "Multiplayer saves", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Multiplayer saves", exact: true });
}

async function selectSpeed(page: Page, label: string) {
  await clock(page).getByRole("button", { name: label, exact: true }).click();
}

test("desktop menu keyboard journey includes Play with friends in both directions", async ({
  browser,
}) => {
  const campaign = new V2Campaign(browser);
  const page = await campaign.addPlayer(1280, false);
  await verifyMenuKeyboard(page);
});

test("V2 requires host approval and a replaced invite cannot admit a guest", async ({
  browser,
}) => {
  const campaign = new V2Campaign(browser);
  const host = await campaign.addPlayer(),
    guest = await campaign.addPlayer(390);
  const obsolete = await campaign.create(host);
  await expect(
    lobby(host).getByRole("button", { name: "Choose a game" }),
  ).toBeDisabled();
  await lobby(host).getByRole("button", { name: "Replace invite" }).click();
  const invite = lobby(host).getByText(/^[0-9a-f]{20}$/i, { exact: true });
  await expect(invite).not.toHaveText(obsolete);
  await campaign.requestJoin(guest, obsolete);
  await expect(lobby(guest).getByRole("alert")).toBeVisible();
  await campaign.requestJoin(guest, await invite.innerText());
  await campaign.approve(host, guest);
  await lobby(host).getByRole("button", { name: "Remove WindyWren" }).click();
  await expect(
    lobby(host).getByRole("button", { name: "Choose a game" }),
  ).toBeDisabled();
  expect(campaign.errors).toEqual([]);
});

for (const count of [2, 4]) {
  test(
    `V2 ${count} players share time and interties while building on their own grids`,
    { tag: "@mobile" },
    async ({ browser }, info) => {
      const campaign = await startCustom(
        browser,
        count,
        !!info.project.use.isMobile,
      );
      const [host, ...guests] = campaign.players;
      const buyer = guests.at(-1)!;
      for (const page of campaign.players) {
        await expect(page.locator(".transmissionLine")).toHaveCount(count - 1);
        const view = await projection(page);
        expect(
          view!.game!.transmission!.lines.every((line) =>
            line.corridorId.startsWith("peer:"),
          ),
        ).toBe(true);
        await selectSpeed(page, "slow speed");
      }
      await selectSpeed(host, "ultra speed");
      for (const page of campaign.players)
        await expect(clock(page)).toHaveAttribute("data-active-speed", "SLOW");
      await expect(clock(host)).toHaveAccessibleDescription(
        /SolarSam \(you\) selected 24×/,
      );
      const before = (await captureState(buyer)).facilities!;
      await buyer.locator(".button-buildFacility").click();
      await buyer
        .getByRole("button", { name: "Review purchase of Wind", exact: true })
        .click();
      await buyer
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect
        .poll(async () => (await captureState(buyer)).facilities)
        .toBe(before + 1);
      for (const page of campaign.players)
        await expect(clock(page)).toHaveAttribute("data-active-speed", "SLOW");
      if (buyer.viewportSize()!.width >= 1024)
        await buyer
          .getByRole("button", { name: "Close Build", exact: true })
          .click();
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
      await expect(clock(host)).toHaveAttribute("data-active-speed", "PAUSED");
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
  "V2 restores the confirmed save under a new host and keeps both company seats",
  { tag: "@mobile" },
  async ({ browser }, info) => {
    const campaign = await startCustom(browser, 2, !!info.project.use.isMobile);
    const [host, guest] = campaign.players;
    const original = await Promise.all(campaign.players.map(captureState));
    expect(original[0].seat).toBeTruthy();
    expect(original[1].seat).toBeTruthy();
    expect(original[0].seat).not.toBe(original[1].seat);
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const confirmed = await campaign.fixture.checkpoint();
    expect(confirmed?.matchId).toBe(original[0].matchId);
    await campaign.resume(guest);
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

test("V2 saves export the confirmed campaign and require confirmation to withdraw", async ({
  browser,
}) => {
  const campaign = await startCustom(browser, 2, false);
  const [host, guest] = campaign.players;
  await saveAndQuit(guest);
  await saveAndQuit(host);
  const confirmed = await campaign.fixture.checkpoint();
  await guest.setViewportSize({ width: 360, height: 640 });
  const library = await openCampaignSaves(guest);
  const actions = library.getByRole("button", { name: /^Actions for / });
  await actions.click();
  const download = guest.waitForEvent("download");
  await guest
    .getByRole("menuitem", { name: "Download confirmed save", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("electrify-multiplayer-campaign.json");
  const exported = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(exported).toMatchObject({
    format: "electrify-multiplayer",
    world: { matchId: confirmed!.matchId, seats: confirmed!.seats },
  });

  const requestWithdrawal = async () => {
    await actions.click();
    await guest
      .getByRole("menuitem", { name: "Withdraw from campaign", exact: true })
      .click();
  };
  const confirm = guest.getByRole("dialog", {
    name: "Withdraw from this campaign?",
    exact: true,
  });
  const cancel = confirm.getByRole("button", { name: "Cancel", exact: true });
  await requestWithdrawal();
  await expect(cancel).toBeFocused();
  await guest.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(actions).toBeFocused();
  await expect(
    library.getByRole("button", { name: "Load save" }),
  ).toBeVisible();

  await requestWithdrawal();
  await confirm.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(library.getByText("No multiplayer saves yet")).toBeVisible();
  const hostLibrary = await openCampaignSaves(host);
  await expect(
    hostLibrary.getByRole("button", { name: "Load save" }),
  ).toBeVisible();
  expect(await campaign.fixture.checkpoint()).toEqual(confirmed);
  expect(campaign.errors).toEqual([]);
});

test(
  "V2 rejects a stale local authority grant when the host remains connected",
  { tag: "@mobile" },
  async ({ browser }, info) => {
    const campaign = await startCustom(browser, 2, !!info.project.use.isMobile);
    const [host, guest] = campaign.players;
    for (const page of campaign.players) await selectSpeed(page, "slow speed");
    await expect(clock(host)).toHaveAttribute("data-active-speed", "SLOW");
    campaign.fixture.loseAuthority(guest);
    const warning = guest.getByRole("dialog", {
      name: "Multiplayer",
      exact: true,
    });
    await expect(warning).toContainText(/connection|reconnect/i);
    await expect(
      warning.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible();
    expect(campaign.errors).toEqual([]);
  },
);

test("V2 speed controls fit the toolbar and expose shared status across themes", async ({
  browser,
}) => {
  const campaign = await startCustom(browser, 2, false);
  const [host] = campaign.players;
  for (const page of campaign.players) await selectSpeed(page, "slow speed");
  for (const width of [1440, 1280, 800, 390, 360]) {
    await host.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await host.emulateMedia({ colorScheme });
      await expect(host.locator("html")).toHaveAttribute(
        "data-theme",
        colorScheme,
      );
      await expect(clock(host)).toBeInViewport();
      await expect(async () => {
        const gap = await clock(host).evaluate((group) => {
          const toolbar = group.closest(".MuiToolbar-root")!;
          const edge =
            toolbar.getBoundingClientRect().right -
            parseFloat(getComputedStyle(toolbar).paddingRight);
          return edge - group.getBoundingClientRect().right;
        });
        expect(Math.abs(gap)).toBeLessThanOrEqual(1);
      }).toPass();
      await expect(clock(host)).toHaveAccessibleDescription(
        /WindyWren selected 1×/,
      );
    }
  }
  await reviewScreenshot(host.locator("#appbar"), {
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
  async ({ browser }, info) => {
    const { players: pages, errors } = await startCustom(
      browser,
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
  test(`a shared V2 mod stays unranked and survives removal from the host library at ${width}px`, async ({
    browser,
  }) => {
    const hostMod = cooperativeMod(width === 1280);
    const names = ["W".repeat(18), "M".repeat(18)];
    const campaign = new V2Campaign(browser, [[hostMod], []], names);
    const host = await campaign.addPlayer(width),
      guest = await campaign.addPlayer(width);
    const invite = await campaign.create(host);
    await campaign.requestJoin(guest, invite);
    await campaign.approve(host, guest);
    await campaign.choose(host);
    await host.getByTestId("community-scenarios").click();
    const chooseMod = async (difficulty: string) => {
      await host
        .getByRole("button", { name: "Play Cooperative Grid", exact: true })
        .click();
      const picker = host.getByRole("dialog", {
        name: "Play Cooperative Grid",
        exact: true,
      });
      await picker
        .getByRole("button", { name: difficulty, exact: true })
        .click();
      await picker
        .getByRole("button", { name: "Choose for everyone", exact: true })
        .click();
    };
    await chooseMod("Easy");
    const guestReady = guest.getByRole("button", {
      name: "I'm ready",
      exact: true,
    });
    await guestReady.click();
    await expect(
      guest.getByRole("button", { name: "Ready", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await host
      .getByRole("button", {
        name: "Choose another community scenario",
        exact: true,
      })
      .click();
    await chooseMod("Medium");
    await expect(guestReady).toBeEnabled();
    for (const page of campaign.players) {
      const preview = page.locator(".coopModPreview");
      await expect(
        preview.getByRole("heading", { name: "Cooperative Grid" }),
      ).toBeVisible();
      await expect(preview).toContainText(
        "Modded · Unranked · No achievements",
      );
      await expect(preview).toContainText("Keep bills affordable");
      await expect(preview).toContainText("Grid funding");
      await expect(preview).not.toContainText("Private surprise");
      expect(
        await preview.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await campaign.start();
    const choices = campaign.players.map((page) =>
      page.getByRole("dialog", { name: /Grid funding/ }),
    );
    for (const [index, choice] of choices.entries()) {
      await expect(choice).toContainText(`Your company: ${names[index]}`);
      const bounds = await choice.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await choices[0]
      .getByRole("button", { name: "Accept funding", exact: true })
      .click();
    await expect(choices[1]).toContainText(`Still deciding: ${names[1]}`);
    await choices[1]
      .getByRole("button", { name: "Keep the current plan", exact: true })
      .click();
    await expect(choices[1]).toBeHidden();
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const initial = await campaign.fixture.checkpoint();
    const digest = initial?.spec.customScenario?.mod?.runtimeDigest;
    expect(digest).toBeTruthy();
    expect(
      initial?.grids.map(
        (game) =>
          game.worldEvents.occurrences.find(
            (event) =>
              event.attributes.choice === "accept" ||
              event.attributes.choice === "decline",
          )?.attributes.choice,
      ),
    ).toEqual(["accept", "decline"]);
    await host.evaluate(async (key) => {
      await (window as MultiplayerWindow).mockModsRequest!({
        kind: "remove",
        key,
      });
    }, hostMod.key);
    await campaign.resume(host);
    for (const page of campaign.players) {
      const game = (await projection(page))!.game!;
      expect(game.customScenario?.mod?.runtimeDigest).toBe(digest);
      expect(game.runIdentity).toBeUndefined();
      await expect(
        page.getByRole("dialog", { name: /Grid funding/ }),
      ).toBeHidden();
      expect(
        await page.evaluate(() => {
          const target = window as MultiplayerWindow;
          return [
            target.scoreSubmissions ?? 0,
            target.achievementSubmissions ?? 0,
          ];
        }),
      ).toEqual([0, 0]);
    }
    expect(campaign.modRequests[1]).toEqual([]);
    expect(campaign.errors).toEqual([]);
  });
}

for (const [scenarioId, width] of [
  [106, 1280],
  [107, 390],
] as const) {
  test(`native ${scenarioId} companies choose independently and resume the same V2 campaign at ${width}px`, async ({
    browser,
    advanceWorldSave,
  }) => {
    test.setTimeout(240000);
    const campaign = new V2Campaign(browser);
    const host = await campaign.addPlayer(width),
      guest = await campaign.addPlayer(width);
    for (const page of campaign.players) {
      await observeNativeForecasts(page);
      await page.reload();
    }
    await entry(host).click();
    await entry(guest).click();
    const invite = await campaign.create(host);
    await campaign.requestJoin(guest, invite);
    await campaign.approve(host, guest);
    await campaign.choose(host);
    await host.getByTestId(`mission-row-${scenarioId}`).click();
    await host.getByRole("button", { name: "Easy", exact: true }).click();
    await campaign.start();

    const opening = await captureState(guest);
    expect(opening).toMatchObject({
      scenarioId,
      ...(scenarioId === 107 && { seed: 268107 }),
    });
    const peak = scenarioId === 106 ? 50e6 : 2e9;
    for (const page of campaign.players)
      await buyNativeBackup(page, peak, scenarioId === 106 ? 0.12 : 0.1);
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
    for (const [index, dialog] of dialogs.entries()) {
      await expect(dialog).toContainText(`Your company: ${companies[index]}`);
      await expect(dialog).toContainText(
        "Each company chooses for its own grid.",
      );
      expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width);
    }
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
                return target.nativeForecasts?.some(
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
        .toBe(true);
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
    await campaign.resume(guest);
    expect((await captureState(guest)).seat).toBe(opening.seat);
    expect((await captureState(guest)).matchId).toBe(opening.matchId);
    expect(campaign.errors).toEqual([]);
  });
}

test("an unavailable V2 checkpoint leaves the match open until Save & Quit can retry", async ({
  browser,
}) => {
  const campaign = await startCustom(browser, 2, false);
  const [host, guest] = campaign.players;
  const confirmed = await campaign.fixture.checkpoint();
  expect(confirmed?.matchId).toBeTruthy();

  campaign.fixture.failSaves("unavailable");
  await guest.getByRole("button", { name: /^menu/i }).click();
  await guest
    .getByRole("menuitem", { name: "Save & Quit", exact: true })
    .click();
  const error = guest.getByRole("dialog", {
    name: "Your game could not be saved",
  });
  await expect(error).toBeVisible();
  await expect(
    error.getByRole("button", { name: "Disconnect", exact: true }),
  ).toHaveCount(0);
  await expect(grid(guest)).toBeVisible();
  expect(await campaign.fixture.checkpoint()).toEqual(confirmed);
  campaign.fixture.failSaves();
  await error.getByRole("button", { name: "Retry", exact: true }).click();

  await expect(entry(guest)).toBeVisible();
  await expect(clock(host)).toHaveAttribute("data-active-speed", "PAUSED");
  expect(campaign.errors).toEqual([]);
});
