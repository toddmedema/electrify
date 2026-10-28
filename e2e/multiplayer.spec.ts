import { expect, Page, Browser } from "@playwright/test";
import { gzipSync } from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import type { InstalledMod, ModLibrary, ModRequest } from "../src/mods/Types";
import type { GameType } from "../src/Types";
import { wToSliderTick } from "../src/helpers/BuildSizing";
import { openPane } from "./layout";
import { test } from "./advance-world";
import type {
  LobbyState,
  NativeEvent,
  NativeRequest,
  SharedSaveLibrary,
} from "../src/multiplayer/Native";
import type { RoomView, World } from "../src/multiplayer/Types";
import { verifyMenuKeyboard } from "./menu-keyboard";

type SteamTestWindow = typeof window & {
  mockSteamDeliveries?: Set<Promise<void>>;
  mockSteamAcknowledge?: (id: number, error?: string) => Promise<void>;
  releaseMockSteamDelivery?: () => void;
  receivedMockSteamEvent?: unknown;
  mockSteamGeneration?: number;
  mockSharedSaveRequests?: number;
  mockScoreSubmissions?: number;
  mockAchievementSubmissions?: number;
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
  // These tests create multiple contexts directly, including the keyboard-only journey.
  // Closing exports traces: do that in guaranteed teardown, with all peers closing together.
  await Promise.all(browser.contexts().map((context) => context.close()));
});

// Return synchronously: DevTools can garbage-collect an awaited promise even after delivery.
// A separate browser-to-Node acknowledgment reports completion of the real async decoder.
function receiveSteamEvent({
  id,
  compressed,
  generation,
}: {
  id: number;
  compressed: string;
  generation: number;
}): void {
  const target = window as SteamTestWindow;
  const pending = (target.mockSteamDeliveries ??= new Set<Promise<void>>());
  const delivery = (async () => {
    const bytes = Uint8Array.from(atob(compressed), (character) =>
      character.charCodeAt(0),
    );
    const json = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    if (generation !== (target.mockSteamGeneration ?? 0)) return;
    const event = JSON.parse(json, (_key, value) =>
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      ["Infinity", "-Infinity", "NaN"].includes(value.$electrifyNumber)
        ? Number(value.$electrifyNumber)
        : value,
    );
    window.dispatchEvent(new CustomEvent("mockSteamEvent", { detail: event }));
  })();
  pending.add(delivery);
  const acknowledge = (error?: unknown) => {
    pending.delete(delivery);
    void target.mockSteamAcknowledge!(
      id,
      error === undefined
        ? undefined
        : error instanceof Error
          ? error.message
          : String(error),
    );
  };
  void delivery.then(
    () => acknowledge(),
    (error) => acknowledge(error),
  );
}

async function createSteamTransport(page: Page) {
  const session = await page.context().newCDPSession(page);
  const receive = receiveSteamEvent.toString();
  let sequence = 0;
  let generation = 0;
  const pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  await page.exposeBinding(
    "mockSteamAcknowledge",
    (_source, id: number, error?: string) => {
      const delivery = pending.get(id);
      pending.delete(id);
      if (error === undefined) delivery?.resolve();
      else delivery?.reject(new Error(error));
    },
  );
  const interrupted = (reason: string) => {
    pending.forEach((delivery) =>
      delivery.reject(
        new Error(`Renderer ${reason} before acknowledging Steam delivery`),
      ),
    );
    pending.clear();
  };
  page.on("close", () => interrupted("closed"));
  page.on("crash", () => interrupted("crashed"));
  return {
    pending: () => pending.size,
    async reset() {
      const obsolete = [...pending.entries()];
      const next = ++generation;
      await session.send("Runtime.evaluate", {
        expression: `window.mockSteamGeneration = ${next}`,
        returnByValue: true,
      });
      // Native leave cancels the old channel without waiting for an async decoder.
      for (const [id, delivery] of obsolete) {
        if (pending.get(id) !== delivery) continue;
        pending.delete(id);
        delivery.resolve();
      }
    },
    async send(event: NativeEvent) {
      // Mirror the native compressed transport and keep full snapshots out of traces.
      const compressed = gzipSync(
        JSON.stringify(event, (_key, value) =>
          typeof value === "number" && !Number.isFinite(value)
            ? { $electrifyNumber: String(value) }
            : value,
        ),
      ).toString("base64");
      const id = ++sequence;
      const acknowledged = new Promise<void>((resolve, reject) =>
        pending.set(id, { resolve, reject }),
      );
      try {
        await Promise.all([
          // Background IPC must not trigger Playwright's before/after DOM snapshots on
          // every heartbeat and view. UI actions still retain their ordinary trace snapshots.
          session
            .send("Runtime.evaluate", {
              expression: `(${receive})(${JSON.stringify({ id, compressed, generation })})`,
              awaitPromise: false,
              returnByValue: true,
            })
            .then(({ exceptionDetails }) => {
              if (exceptionDetails)
                throw new Error(
                  exceptionDetails.exception?.description ||
                    exceptionDetails.text,
                );
            }),
          acknowledged,
        ]);
      } finally {
        pending.delete(id);
      }
    },
  };
}

/** Steam persona names, by player index, so the game shows names rather than seat numbers. */
const STEAM_NAMES = ["SolarSam", "WindyWren", "HydroHal", "VoltVera"];

class SteamRoom {
  constructor(
    private readonly createTransport = createSteamTransport,
    private readonly installedMods: InstalledMod[][] = [],
    private readonly personaNames: readonly string[] = STEAM_NAMES,
  ) {}
  modEntries = new Map<string, InstalledMod[]>();
  modRequests = new Map<string, ModRequest[]>();
  subscriptions = new Map<string, Set<string>>();
  heldScenarios = new Set<string>();
  pendingScenarios = new Map<string, NativeEvent>();
  async releaseScenario(id: string) {
    this.heldScenarios.delete(id);
    const pending = this.pendingScenarios.get(id);
    this.pendingScenarios.delete(id);
    if (pending) await this.event(id, pending);
  }
  async mods(id: string, input: ModRequest): Promise<ModLibrary> {
    this.modRequests.get(id)!.push(structuredClone(input));
    let entries = this.modEntries.get(id)!;
    if (input.kind === "enable")
      entries = entries.map((entry) =>
        entry.key === input.key ? { ...entry, enabled: input.enabled } : entry,
      );
    if (input.kind === "remove")
      entries = entries.filter((entry) => entry.key !== input.key);
    if (input.kind === "subscribe") this.subscriptions.get(id)!.add(input.id);
    this.modEntries.set(id, entries);
    return { entries: structuredClone(entries) };
  }
  private info = test.info();
  transportErrors: string[] = [];
  audioRequests: string[] = [];
  pages = new Map<string, Page>();
  private transports = new Map<
    string,
    Awaited<ReturnType<typeof createSteamTransport>>
  >();
  members: LobbyState["members"] = [];
  checkpoint?: World;
  campaignName = "Friends campaign";
  campaignCloudState: SharedSaveLibrary["cloudState"] = "ready";
  campaignWarning?: string;
  campaignError?: string;
  campaignListHold?: Promise<void>;
  invites: string[] = [];
  views = new Map<string, RoomView>();
  pendingViews = new Map<string, NativeEvent>();
  deliveringViews = new Set<string>();
  heldViews = new Set<string>();
  dropped = new Set<string>();
  host = "76561198000000001";
  lobbyId = "109775242999999999";
  private async transportFailure(id: string, error: unknown) {
    if (this.transportErrors.length) return;
    const message = `${id}: ${error instanceof Error ? error.message : String(error)}`;
    this.transportErrors.push(message);
    await this.info.attach("Steam bridge transport failure", {
      body: message,
      contentType: "text/plain",
    });
  }
  state(id: string): LobbyState {
    const member = this.members.some((seat) => seat.id === id);
    return {
      available: true,
      selfId: id,
      hostId: member ? this.host : undefined,
      lobbyId: member ? this.lobbyId : undefined,
      members: member ? [...this.members] : [],
      connected:
        !member || this.dropped.has(id)
          ? []
          : id === this.host
            ? this.members
                .filter((m) => m.id !== id && !this.dropped.has(m.id))
                .map((m) => m.id)
            : this.members.some((m) => m.id === id)
              ? [this.host]
              : [],
      savedAt: this.checkpoint ? Date.now() : null,
      sharedAt: this.checkpoint ? Date.now() : null,
    };
  }
  async event(id: string, event: NativeEvent) {
    if (
      event.kind === "message" &&
      event.payload.kind === "scenario" &&
      this.heldScenarios.has(id)
    ) {
      this.pendingScenarios.set(id, event);
      return;
    }
    // Native leave closes peer channels; unsent frames cannot enter a departed renderer.
    if (
      event.kind === "message" &&
      !this.members.some((member) => member.id === id)
    )
      return;
    if (
      event.kind === "message" &&
      event.payload.kind === "keepalive" &&
      this.heldViews.has(id)
    )
      return;
    if (event.kind !== "message" || event.payload.kind !== "view") {
      await this.deliver(id, event);
      return;
    }
    // Like the native queue, replace an unsent snapshot rather than building a tick backlog.
    this.pendingViews.set(id, event);
    if (this.heldViews.has(id) || this.deliveringViews.has(id)) return;
    this.deliveringViews.add(id);
    try {
      while (this.pendingViews.has(id) && !this.heldViews.has(id)) {
        const next = this.pendingViews.get(id)!;
        this.pendingViews.delete(id);
        await this.deliver(id, next);
      }
    } finally {
      this.deliveringViews.delete(id);
    }
  }
  async deliver(id: string, event: NativeEvent) {
    const page = this.pages.get(id)!;
    try {
      await this.transports.get(id)!.send(event);
    } catch (error) {
      if (!page.isClosed()) await this.transportFailure(id, error);
      throw error;
    }
  }
  async publish() {
    // A registered page may still be navigating before it joins. Its decoder cannot yet ACK.
    // Capture this lobby's recipients before awaiting delivery so new pages cannot join the loop.
    for (const id of this.members.map((member) => member.id))
      await this.event(id, { kind: "state", state: this.state(id) });
  }
  async request(id: string, input: NativeRequest): Promise<unknown> {
    if (input.kind === "state") return this.state(id);
    if (input.kind === "create" || input.kind === "join") {
      if (input.kind === "join" && input.lobbyId !== this.lobbyId)
        throw new Error("Invalid lobby code");
      if (!this.members.some((m) => m.id === id))
        this.members.push({
          id,
          name: this.personaNames[Number(id.slice(-1)) - 1],
        });
      await this.publish();
      return this.state(id);
    }
    if (input.kind === "member") {
      this.members.find((m) => m.id === id)![input.key] = input.value;
      await this.publish();
      return this.state(id);
    }
    if (input.kind === "unlock") return this.state(id);
    if (input.kind === "send") {
      if (input.payload.kind === "view")
        this.views.set(input.to, input.payload.view);
      if (
        this.dropped.has(id) ||
        this.dropped.has(input.to) ||
        !this.members.some((member) => member.id === id) ||
        !this.members.some((member) => member.id === input.to)
      )
        throw new Error("Player disconnected");
      // Native Steam transport consumes heartbeats before publishing renderer events.
      if (input.payload.kind === "heartbeat") return;
      await this.event(input.to, {
        kind: "message",
        sender: id,
        payload: input.payload,
      });
      return;
    }
    if (input.kind === "checkpoint") {
      this.checkpoint = input.world;
      await this.publish();
      return this.state(id);
    }
    if (input.kind === "read-checkpoint") return this.checkpoint;
    if (input.kind === "delete-save") this.checkpoint = undefined;
    if (input.kind === "invite") {
      this.invites.push(id);
      return;
    }
    if (input.kind === "list-saves" || input.kind === "delete-save") {
      if (input.kind === "list-saves") await this.campaignListHold;
      if (this.campaignError) throw new Error(this.campaignError);
      return {
        cloudState: this.campaignCloudState,
        warning: this.campaignWarning,
        slots: this.checkpoint
          ? [
              {
                id: "saved-campaign",
                name: this.campaignName,
                updatedAt: Date.now(),
                matchId: this.checkpoint.matchId,
                schema: this.checkpoint.schema,
                players: this.checkpoint.seats.map((s) => s.name),
              },
            ]
          : [],
      };
    }
    if (input.kind === "reconnect") {
      this.dropped.delete(id);
      await this.publish();
      return this.state(id);
    }
    if (input.kind === "leave") {
      this.members = this.members.filter((m) => m.id !== id);
      this.pendingViews.delete(id);
      this.heldViews.delete(id);
      this.pendingScenarios.delete(id);
      this.heldScenarios.delete(id);
      await this.transports.get(id)!.reset();
      if (this.members.some((member) => member.id === this.host))
        await this.event(this.host, { kind: "disconnected", sender: id });
      await this.publish();
      return;
    }
  }
  async player(
    browser: Browser,
    index: number,
    mobile = false,
    openLobby = true,
  ) {
    const id = `7656119800000000${index + 1}`;
    const initialMods = structuredClone(this.installedMods[index] ?? []);
    this.modEntries.set(id, initialMods);
    this.modRequests.set(id, []);
    this.subscriptions.set(
      id,
      new Set(
        initialMods.flatMap((entry) =>
          entry.workshopId ? [entry.workshopId] : [],
        ),
      ),
    );
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      colorScheme: index % 2 ? "dark" : "light",
      hasTouch: mobile,
      isMobile: mobile,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/audio/"))
        this.audioRequests.push(request.url());
    });
    this.transports.set(id, await this.createTransport(page));
    // publish() may run during setup; expose the player only once delivery is ready.
    this.pages.set(id, page);
    page.on("crash", () => {
      void this.transportFailure(id, new Error("Renderer crashed"));
    });
    await page.exposeBinding(
      "mockSteamRequest",
      (_source, input: NativeRequest) => this.request(id, input),
    );
    await page.exposeBinding("mockModsRequest", (_source, input: ModRequest) =>
      this.mods(id, input),
    );
    await page.addInitScript(
      ({ id }) => {
        // Multiplayer flow tests do not exercise sound. Avoid four headless audio engines.
        localStorage.setItem("audioEnabled", "false");
        localStorage.setItem("theme", "system");
        const noop = () => () => {};
        const display = {
          fullscreen: false,
          width: 1280,
          height: 900,
          resolutions: [{ width: 1280, height: 900 }],
        };
        window.electrifyDesktop = {
          apiVersion: 1,
          getState: async () => ({
            display,
            steam: {
              available: true,
              online: true,
              steamId: id,
              displayName: "Player",
              cloudEnabled: false,
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
            const target = window as SteamTestWindow;
            target.mockScoreSubmissions =
              (target.mockScoreSubmissions ?? 0) + 1;
          },
          readAchievements: async () => ({
            version: 1,
            earned: [],
            tutorials: [],
            wins: [],
          }),
          submitAchievements: async () => {
            const target = window as SteamTestWindow;
            target.mockAchievementSubmissions =
              (target.mockAchievementSubmissions ?? 0) + 1;
          },
          mods: (input) =>
            (
              window as unknown as {
                mockModsRequest: (input: ModRequest) => Promise<ModLibrary>;
              }
            ).mockModsRequest(input),
          openFriends: async () => {},
          setActivity: async () => {},
          addTimelineEvent: async () => {},
          multiplayerRequest: async (input) => {
            try {
              return await (
                window as unknown as {
                  mockSteamRequest: (input: NativeRequest) => Promise<unknown>;
                }
              ).mockSteamRequest(input);
            } finally {
              if (input.kind === "list-saves") {
                const target = window as SteamTestWindow;
                target.mockSharedSaveRequests =
                  (target.mockSharedSaveRequests || 0) + 1;
              }
            }
          },
          onMultiplayerEvent: (callback) => {
            const handler = (event: Event) =>
              callback((event as CustomEvent<NativeEvent>).detail);
            window.addEventListener("mockSteamEvent", handler);
            return () => window.removeEventListener("mockSteamEvent", handler);
          },
        };
      },
      { id },
    );
    await page.goto("/");
    if (openLobby)
      await page
        .getByRole("button", { name: "Play with friends", exact: true })
        .click();
    return page;
  }
}

/** Hosting goes straight to choosing a game, where friends can join at any time. */
async function hostGame(page: Page) {
  await page.getByRole("button", { name: "Host a game", exact: true }).click();
  await expect(page.getByTestId("mission-row-999")).toBeVisible();
}
async function joinGame(page: Page, room: SteamRoom) {
  await page.getByLabel("Invite code", { exact: true }).fill(room.lobbyId);
  await page.getByRole("button", { name: "Join", exact: true }).click();
}
async function openSaves(page: Page) {
  await page
    .getByRole("button", { name: "Load multiplayer save", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Multiplayer saves", exact: true }),
  ).toBeFocused();
}
async function loadSave(page: Page, name: string) {
  await openSaves(page);
  await page
    .getByRole("article", { name, exact: true })
    .getByRole("button", { name: "Load save", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Pick your company", exact: true }),
  ).toBeVisible();
}
const company = (page: Page, name: string) =>
  page.getByRole("listitem", { name: `${name}'s company`, exact: true });

// Each width runs in one theme; both themes stay covered.
for (const [width, theme] of [
  [1280, "light"],
  [390, "dark"],
  [360, "dark"],
] as const) {
  test(`multiplayer saves offer direct resume and safe deletion at ${width}px in ${theme}`, async ({
    browser,
  }) => {
    const room = new SteamRoom();
    room.checkpoint = {
      schema: 3,
      matchId: "library-campaign",
      seats: [
        { id: room.host, name: "SolarSam" },
        { id: "76561198000000002", name: "WindyWren" },
      ],
      outcomes: {},
    } as unknown as World;
    const checkpoint = room.checkpoint;
    const mobile = width < 600;
    const page = await room.player(browser, 0, mobile);
    await page.setViewportSize({
      width,
      height: width === 360 ? 640 : mobile ? 844 : 900,
    });
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const capture = async (state: string) => {
      if (!process.env.CAMPAIGN_DESIGN_SCREENSHOTS) return;
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `${process.env.CAMPAIGN_DESIGN_SCREENSHOTS}/${width}-${theme}-${state}.png`,
        animations: "disabled",
        style: ".MuiTouchRipple-root { visibility: hidden !important; }",
      });
    };
    const bounded = async (
      region = page.getByRole("dialog").last(),
      minimum = mobile ? 44 : 40,
    ) => {
      expect(
        await region.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      const bounds = await region.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      for (const button of await region.getByRole("button").evaluateAll((els) =>
        els
          .filter((el) => el.getBoundingClientRect().height > 0)
          .map((el) => ({
            label: el.getAttribute("aria-label") || el.textContent,
            height: el.getBoundingClientRect().height,
          })),
      )) {
        expect(
          button.height,
          `${button.label} touch target`,
        ).toBeGreaterThanOrEqual(minimum);
      }
    };
    // Play with friends offers only hosting or joining with a code.
    const entry = page.getByRole("dialog", {
      name: "Play with friends",
      exact: true,
    });
    // Back is the header's arrow, as on every screen; there are no bottom actions.
    await expect(entry.getByRole("button")).toHaveText([
      "",
      "Host a game",
      "Join",
    ]);
    await expect(entry.getByRole("button").first()).toHaveAccessibleName(
      "Back",
    );
    const [field, join] = await Promise.all([
      entry.getByLabel("Invite code", { exact: true }).boundingBox(),
      entry.getByRole("button", { name: "Join", exact: true }).boundingBox(),
    ]);
    // The code and Join share one row.
    expect(Math.abs(field!.y - join!.y)).toBeLessThan(12);
    expect(join!.x).toBeGreaterThan(field!.x + field!.width);
    await bounded();
    await capture("entry");
    await hostGame(page);
    const bar = page
      .getByRole("region", { name: "Playing together", exact: true })
      .last();
    await expect(
      bar.getByRole("img", { name: "Host", exact: true }),
    ).toBeVisible();
    await expect(bar.getByText(/Invite friends to play|can join/)).toHaveCount(
      0,
    );
    await expect(
      bar.getByRole("button", { name: "Invite friends", exact: true }),
    ).toHaveClass(/MuiButton-contained/);
    await bar
      .getByRole("button", { name: "Copy invite code", exact: true })
      .click();
    await expect(page.getByText("Invite code copied")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(room.lobbyId);
    await expect(
      page.getByRole("button", { name: "Invite a friend to start" }),
    ).toHaveCount(0);
    await bounded(bar);
    await capture("host-alone");
    await openSaves(page);
    const save = page.getByRole("article", {
      name: room.campaignName,
      exact: true,
    });
    await expect(save).toBeVisible();
    await expect(
      save.getByText("SolarSam, WindyWren", { exact: true }),
    ).toBeVisible();
    await expect(
      save.getByRole("button", { name: "Load save", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /rename|export|import/i }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        /Saved on this computer|Differing Steam Cloud|Host a lobby and invite|[Ss]hared campaign/,
      ),
    ).toHaveCount(0);
    await bounded();
    await capture("saved");
    await page.keyboard.press("Escape");
    room.campaignCloudState = "offline";
    await openSaves(page);
    await expect(
      page.getByText(/Saved on this computer|Steam Cloud is offline/),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    room.campaignError =
      "Save files could not be read. Your existing files have been kept.";
    await openSaves(page);
    await expect(page.getByRole("alert")).toContainText(room.campaignError);
    await capture("error");
    await page
      .getByRole("alert")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Back", exact: true })
      .click();
    room.campaignError = undefined;
    // Closing the list while it loads leaves the scenario screen as it was.
    let release!: () => void;
    const completed = await page.evaluate(
      () => (window as SteamTestWindow).mockSharedSaveRequests || 0,
    );
    room.campaignListHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page
      .getByRole("button", { name: "Load multiplayer save", exact: true })
      .click();
    await expect(page.getByRole("status").last()).toContainText(
      "Loading multiplayer saves…",
    );
    await page.keyboard.press("Escape");
    release();
    room.campaignListHold = undefined;
    await page.waitForFunction(
      (before) =>
        ((window as SteamTestWindow).mockSharedSaveRequests || 0) > before,
      completed,
    );
    await expect(
      page.getByRole("heading", { name: "Multiplayer saves", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("mission-row-999")).toBeVisible();
    await loadSave(page, room.campaignName);
    await expect(company(page, "SolarSam")).toContainText("You");
    await expect(company(page, "WindyWren")).toContainText("Saved company");
    await expect(
      page.getByRole("button", { name: "Resume game", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Someone must take WindyWren's company"),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Invite friends", exact: true })
      .click();
    await expect.poll(() => room.invites).toEqual([room.host]);
    await bounded();
    await capture("resume-invite");
    const guest = await room.player(browser, 1, mobile);
    await joinGame(guest, room);
    await expect(company(page, "WindyWren")).toContainText("WindyWren");
    await expect(company(guest, "WindyWren")).toContainText("You");
    await expect(
      page.getByRole("button", { name: "Resume game", exact: true }),
    ).toBeEnabled();
    await capture("resume-ready");
    // Choosing a new game instead brings both friends back to the scenario screens.
    await page
      .getByRole("button", { name: "Choose a new game", exact: true })
      .click();
    await page.getByTestId("mission-row-999").click();
    await expect(
      guest.getByText("Custom setup", { exact: true }).last(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back", exact: true })
      .last()
      .click();
    room.campaignName = "A".repeat(80);
    await openSaves(page);
    const longSave = page.getByRole("article", {
      name: room.campaignName,
      exact: true,
    });
    await expect(longSave).toBeVisible();
    await bounded();
    await capture("long-name");
    await longSave
      .getByRole("button", { name: "Load save", exact: true })
      .click();
    for (const peer of [page, guest])
      await expect(
        peer.getByRole("dialog", { name: "Pick your company", exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resume game", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Choose a new game", exact: true })
      .click();
    await openSaves(page);
    const openDelete = async () => {
      await longSave
        .getByRole("button", {
          name: `Actions for ${room.campaignName}`,
          exact: true,
        })
        .click();
      await expect(page.getByRole("menuitem")).toHaveCount(1);
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
      const confirmation = page.getByRole("dialog", {
        name: "Delete multiplayer save?",
        exact: true,
      });
      await expect(
        confirmation.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await expect(
        confirmation.getByRole("button", { name: "Delete", exact: true }),
      ).toBeInViewport();
      return confirmation;
    };
    let confirmation = await openDelete();
    await bounded();
    await capture("delete");
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(longSave).toBeVisible();
    confirmation = await openDelete();
    await confirmation
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      page.getByText("No multiplayer saves yet", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Multiplayer saves", exact: true }),
    ).toBeFocused();
    await capture("empty");
    await page.keyboard.press("Escape");
    // Without saves, the scenario screen offers only a new game.
    await expect(
      page.getByRole("button", { name: "Load multiplayer save" }),
    ).toHaveCount(0);
    expect(room.members).toHaveLength(2);
    room.checkpoint = checkpoint;
    expect(room.transportErrors).toEqual([]);
  });
}

test("friends join and leave freely before the start, and claim saved companies to resume", async ({
  browser,
}) => {
  const room = new SteamRoom();
  room.checkpoint = {
    schema: 3,
    matchId: "claim-campaign",
    seats: [
      { id: room.host, name: "SolarSam" },
      { id: "76561198000000002", name: "WindyWren" },
    ],
    outcomes: {},
  } as unknown as World;
  const host = await room.player(browser, 0);
  const errors: string[] = [];
  host.on("pageerror", (error) => errors.push(error.message));
  await hostGame(host);
  // A friend joins, leaves and another joins while the host is choosing.
  const hydro = await room.player(browser, 2);
  await joinGame(hydro, room);
  await expect(hydro.getByText("Following SolarSam").last()).toBeVisible();
  const roster = host
    .getByRole("list", { name: "Players", exact: true })
    .last();
  await expect(roster.getByText("HydroHal", { exact: true })).toBeVisible();
  await hydro
    .getByRole("button", { name: "Leave", exact: true })
    .last()
    .click();
  await hydro.getByRole("button", { name: "Leave lobby", exact: true }).click();
  await expect(
    hydro.getByRole("button", { name: "Play with friends", exact: true }),
  ).toBeVisible();
  await expect(roster.getByText("HydroHal", { exact: true })).toHaveCount(0);
  await expect(host.getByRole("dialog")).toHaveCount(0);
  await hydro
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await joinGame(hydro, room);
  await expect(hydro.getByText("Following SolarSam").last()).toBeVisible();
  // A friend who was not in the save takes an open company.
  await loadSave(host, room.campaignName);
  await expect(company(hydro, "WindyWren")).toBeVisible();
  await expect(host.getByText("HydroHal must pick a company")).toBeVisible();
  await hydro
    .getByRole("button", { name: "Take WindyWren's company", exact: true })
    .click();
  await expect(company(host, "WindyWren")).toContainText("HydroHal");
  await expect(
    host.getByRole("button", { name: "Resume game", exact: true }),
  ).toBeEnabled();
  // The saved player joins too; the explicit claim holds, so they must pick.
  const windy = await room.player(browser, 1);
  await joinGame(windy, room);
  await expect(host.getByText("WindyWren must pick a company")).toBeVisible();
  await expect(
    host.getByRole("button", { name: "Resume game", exact: true }),
  ).toBeDisabled();
  // Once the newcomer leaves, the returning player gets their own company back.
  await hydro.getByRole("button", { name: "Leave lobby", exact: true }).click();
  await expect(company(host, "WindyWren")).toContainText("WindyWren");
  await expect(company(windy, "WindyWren")).toContainText("You");
  await expect(
    host.getByRole("button", { name: "Resume game", exact: true }),
  ).toBeEnabled();
  // When the host leaves, friends go home with an explanation instead of a reconnect prompt.
  await host.getByRole("button", { name: "Leave lobby", exact: true }).click();
  const home = windy.getByRole("dialog", {
    name: "Play with friends",
    exact: true,
  });
  await expect(home.getByRole("alert")).toContainText(
    "The host closed the lobby.",
  );
  await expect(
    home.getByRole("button", { name: "Host a game", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
  expect(room.transportErrors).toEqual([]);
});

test("mock Steam publishes only to players with an initialized transport", async ({
  browser,
}) => {
  let releaseTransport!: () => void;
  let transportStarted!: () => void;
  const blocked = new Promise<void>((resolve) => {
    releaseTransport = resolve;
  });
  const started = new Promise<void>((resolve) => {
    transportStarted = resolve;
  });
  const room = new SteamRoom(async (page) => {
    const transport = await createSteamTransport(page);
    transportStarted();
    await blocked;
    return transport;
  });
  const joining = room.player(browser, 0, false, false);
  try {
    await started;
    // Another player's lobby update can arrive while this player's CDP setup is pending.
    await expect(room.publish()).resolves.toBeUndefined();
    expect(room.pages.size).toBe(0);
    expect(room.transportErrors).toEqual([]);
  } finally {
    releaseTransport();
    await joining;
  }
  expect(room.pages.size).toBe(1);
  await expect(room.publish()).resolves.toBeUndefined();
  expect(room.transportErrors).toEqual([]);
});

test("mock Steam lobby publication skips registered players who have not joined", async ({
  browser,
}) => {
  let transports = 0;
  const room = new SteamRoom(async (page) => {
    const transport = await createSteamTransport(page);
    if (++transports === 2)
      return {
        ...transport,
        send: async () => {
          throw new Error("Unjoined renderer is navigating");
        },
      };
    return transport;
  });
  const host = await room.player(browser, 0);
  await hostGame(host);
  await room.player(browser, 1, false, false);
  await host.evaluate(() => {
    window.addEventListener("mockSteamEvent", (event) => {
      (window as SteamTestWindow).receivedMockSteamEvent = (
        event as CustomEvent<NativeEvent>
      ).detail;
    });
  });
  await expect(room.publish()).resolves.toBeUndefined();
  expect(
    await host.evaluate(
      () => (window as SteamTestWindow).receivedMockSteamEvent,
    ),
  ).toEqual({ kind: "state", state: room.state(room.host) });
  expect(room.transportErrors).toEqual([]);
});

test("mock Steam delivery survives garbage collection while decompression is pending", async ({
  page,
}) => {
  const transport = await createSteamTransport(page);
  await page.evaluate(() => {
    const target = window as SteamTestWindow;
    const text = Response.prototype.text;
    Response.prototype.text = function () {
      return text.call(this).then(
        (json) =>
          new Promise<string>((resolve) => {
            target.releaseMockSteamDelivery = () => resolve(json);
          }),
      );
    };
    window.addEventListener("mockSteamEvent", (event) => {
      target.receivedMockSteamEvent = (event as CustomEvent).detail;
    });
  });
  const event: NativeEvent = {
    kind: "state",
    state: { available: true, members: [], connected: [] },
  };
  let completed = false;
  const delivery = transport.send(event).then(() => {
    completed = true;
  });
  await page.waitForFunction(
    () =>
      typeof (window as SteamTestWindow).releaseMockSteamDelivery ===
      "function",
  );
  expect(
    await page.evaluate(
      () => (window as SteamTestWindow).mockSteamDeliveries?.size,
    ),
  ).toBe(1);
  expect(transport.pending()).toBe(1);
  expect(completed).toBe(false);
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.collectGarbage");
  expect(completed).toBe(false);
  await page.evaluate(() =>
    (window as SteamTestWindow).releaseMockSteamDelivery?.(),
  );
  await delivery;
  expect(transport.pending()).toBe(0);
  expect(
    await page.evaluate(() => {
      const target = window as SteamTestWindow;
      return {
        pending: target.mockSteamDeliveries?.size,
        event: target.receivedMockSteamEvent,
      };
    }),
  ).toEqual({ pending: 0, event });
  // An already-decompressing old-channel callback must stay cancelled after rejoining.
  await page.evaluate(() => {
    delete (window as SteamTestWindow).releaseMockSteamDelivery;
  });
  const obsolete = transport.send({
    ...event,
    state: { ...event.state, error: "Old channel" },
  });
  await page.waitForFunction(
    () =>
      typeof (window as SteamTestWindow).releaseMockSteamDelivery ===
      "function",
  );
  await transport.reset();
  await obsolete;
  await page.evaluate(() =>
    (window as SteamTestWindow).releaseMockSteamDelivery?.(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as SteamTestWindow).mockSteamDeliveries?.size,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () => (window as SteamTestWindow).receivedMockSteamEvent,
    ),
  ).toEqual(event);
  await page.evaluate(() => {
    delete (window as SteamTestWindow).releaseMockSteamDelivery;
  });
  const resumedEvent: NativeEvent = {
    ...event,
    state: { ...event.state, error: "New channel" },
  };
  const resumed = transport.send(resumedEvent);
  await page.waitForFunction(
    () =>
      typeof (window as SteamTestWindow).releaseMockSteamDelivery ===
      "function",
  );
  await page.evaluate(() =>
    (window as SteamTestWindow).releaseMockSteamDelivery?.(),
  );
  await resumed;
  expect(
    await page.evaluate(
      () => (window as SteamTestWindow).receivedMockSteamEvent,
    ),
  ).toEqual(resumedEvent);
  // Decoder failures travel through the ACK too, rather than becoming a lost pending send.
  await page.evaluate(() => {
    Response.prototype.text = () =>
      Promise.reject(new Error("Probe decode failed"));
  });
  await expect(transport.send(event)).rejects.toThrow("Probe decode failed");
  expect(transport.pending()).toBe(0);
  expect(
    await page.evaluate(
      () => (window as SteamTestWindow).mockSteamDeliveries?.size,
    ),
  ).toBe(0);
  await session.detach();
});

test("desktop menu keyboard journey includes Play with friends in both directions", async ({
  browser,
}) => {
  const room = new SteamRoom();
  const page = await room.player(browser, 0, false, false);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "system");
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("musicVolume", "0.5");
    localStorage.setItem("soundEffectsVolume", "0.5");
  });
  await page.reload();
  await verifyMenuKeyboard(page);
});

const clock = (page: Page) =>
  page.locator(".multiplayerSpeedToggles:visible").last();
async function ready(page: Page) {
  await clock(page)
    .getByRole("button", { name: "slow speed", exact: true })
    .click();
}

async function startSharedGame(browser: Browser, count: number) {
  const room = new SteamRoom();
  const pages: Page[] = [],
    errors: string[] = [];
  for (let index = 0; index < count; index++) {
    const page = await room.player(
      browser,
      index,
      count === 4 && index === count - 1,
    );
    page.on("pageerror", (error) => errors.push(error.message));
    pages.push(page);
    // The host chooses in the normal scenario screens; every guest follows along read-only.
    if (index === 0) await hostGame(page);
    else await joinGame(page, room);
  }
  // 999 is CUSTOM_SCENARIO_ID: the custom game row sits at the end of the list.
  await pages[0].getByTestId("mission-row-999").click();
  for (const guest of pages.slice(1)) {
    // The outgoing card stays mounted while the next one slides in, so check the newest.
    await expect(guest.getByText("Following SolarSam").last()).toBeVisible();
    await expect(
      guest.getByText("Custom setup", { exact: true }).last(),
    ).toBeVisible();
    await guest.getByRole("button", { name: "I'm ready", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Ready", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await expect(
    pages[0]
      .getByRole("list", { name: "Players", exact: true })
      .last()
      .getByRole("img", { name: "Ready", exact: true }),
  ).toHaveCount(count - 1);
  await pages[0]
    .getByRole("button", { name: "Start for everyone", exact: true })
    .click();
  return { room, pages, errors };
}

async function expectClockInViewport(page: Page) {
  const bounds = await page
    .locator(".speedToggles:visible")
    .last()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.overflow).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: /Player speeds;/ }),
  ).toHaveCount(0);
  const icons = await clock(page)
    .locator(".multiplayerSpeedPeers svg")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const icon = element.getBoundingClientRect();
        const button = element.closest("button")!.getBoundingClientRect();
        return {
          left: icon.left - button.left,
          right: button.right - icon.right,
          top: icon.top - button.top,
          bottom: button.bottom - icon.bottom,
          buttonHeight: button.height,
          glyph: element.querySelector("path")?.getAttribute("d"),
          tone: `${element.closest("button")!.getAttribute("aria-pressed")} ${getComputedStyle(element).color}`,
        };
      }),
    );
  expect(new Set(icons.map((icon) => icon.glyph)).size).toBe(
    icons.length ? 1 : 0,
  );
  // One neutral tone per surface: who chose a speed is in the description, not in colour.
  for (const pressed of ["true", "false"])
    expect(
      new Set(
        icons
          .filter((icon) => icon.tone.startsWith(pressed))
          .map((icon) => icon.tone),
      ).size,
    ).toBeLessThanOrEqual(1);
  for (const { buttonHeight, glyph: _glyph, tone: _tone, ...icon } of icons) {
    for (const inset of Object.values(icon))
      expect(inset).toBeGreaterThanOrEqual(0);
    expect(icon.top).toBeGreaterThanOrEqual(buttonHeight / 2);
    expect(icon.bottom).toBeLessThanOrEqual(3);
  }
}

async function expectClockMeaning(
  page: Page,
  selectedName: string,
  activeName: string,
) {
  const selected = clock(page).getByRole("button", {
    name: selectedName,
    exact: true,
  });
  const active = clock(page).getByRole("button", {
    name: activeName,
    exact: true,
  });
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(active).toHaveAttribute("aria-current", "true");
  await expect(clock(page).locator('button[aria-current="true"]')).toHaveCount(
    1,
  );
  const fill = (element: Element) => getComputedStyle(element).backgroundColor;
  // Your own selection is the filled segment.
  expect(await selected.evaluate(fill)).not.toBe("rgba(0, 0, 0, 0)");
  // The shared clock's speed wears the pulsing ring, drawn in its label's colour: status,
  // not the interaction blue, unless it shares the filled segment.
  const ring = await active.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    const button = element.getBoundingClientRect();
    const label = element
      .querySelector(".multiplayerSpeedLabel")!
      .getBoundingClientRect();
    const size = parseFloat(style.width);
    const centerY = button.top + element.clientTop + parseFloat(style.top);
    return {
      content: style.content,
      radius: style.borderTopLeftRadius,
      animation: style.animationName,
      color: style.borderTopColor,
      labelColor: getComputedStyle(element).color,
      top: centerY - size / 2 - button.top,
      bottom: button.bottom - (centerY + size / 2),
      offCenter: Math.abs(label.top + label.height / 2 - centerY),
      clearance: size - 2 * parseFloat(style.borderTopWidth) - label.width,
    };
  });
  expect(ring.content).not.toBe("none");
  expect(ring.radius).toBe("50%");
  expect(ring.animation).toBe("tutorialTargetPulse");
  expect(ring.color).toBe(ring.labelColor);
  // It sits inside the segment, around the lifted label, and clears the label's sides.
  expect(ring.top).toBeGreaterThanOrEqual(1);
  expect(ring.bottom).toBeGreaterThanOrEqual(1);
  expect(ring.offCenter).toBeLessThanOrEqual(1);
  expect(ring.clearance).toBeGreaterThanOrEqual(2);
  if (selectedName !== activeName) {
    expect(
      await selected.evaluate(
        (element) => getComputedStyle(element, "::before").content,
      ),
    ).toBe("none");
    expect(await active.evaluate(fill)).toBe("rgba(0, 0, 0, 0)");
    await expect(selected).not.toHaveAttribute("aria-current");
  }
}

async function verifySpeedLayouts(browser: Browser, pages: Page[]) {
  const desktop = pages[0],
    mobile = pages[3],
    blockingPeer = pages[1];
  const report: unknown[] = [];
  for (const touch of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: touch ? 390 : 1280, height: touch ? 844 : 900 },
      hasTouch: touch,
      isMobile: touch,
      colorScheme: "light",
    });
    const baseline = await context.newPage();
    await baseline.addInitScript(() => {
      localStorage.setItem("theme", "system");
      localStorage.setItem("audioEnabled", "false");
    });
    await baseline.goto("/?scenario=103");
    await baseline
      .getByRole("button", { name: "Start game", exact: true })
      .click();
    const target = touch ? mobile : desktop;
    for (const width of touch ? [390, 360] : [1280]) {
      for (const theme of ["light", "dark"] as const) {
        for (const page of [target, baseline]) {
          await page.setViewportSize({ width, height: touch ? 844 : 900 });
          await page.emulateMedia({ colorScheme: theme });
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
        }
        const dimensions = async (page: Page) =>
          page
            .locator(".speedToggles:visible")
            .last()
            .getByRole("button")
            .evaluateAll((buttons) =>
              buttons.map((button, index) => {
                const rect = button.getBoundingClientRect();
                const previous = buttons[index - 1]?.getBoundingClientRect();
                const style = getComputedStyle(button);
                return {
                  label: button.getAttribute("aria-label"),
                  width: rect.width,
                  height: rect.height,
                  gap: previous ? rect.x - previous.right : 0,
                  padding: style.padding,
                  fontSize: style.fontSize,
                };
              }),
            );
        const compare = async (catalog: boolean) => {
          let actual: Awaited<ReturnType<typeof dimensions>> = [];
          // The catalog can still be entering when its controls first become visible.
          await expect(async () => {
            const expected = await dimensions(baseline);
            actual = await dimensions(target);
            for (const button of expected) {
              expect(button.width).toBeGreaterThan(0);
              const peer = actual.find((item) => item.label === button.label)!;
              expect(peer.width).toBeCloseTo(button.width, 1);
              expect(peer.height).toBeCloseTo(button.height, 1);
              expect(peer.gap).toBeCloseTo(button.gap, 1);
              expect(peer.padding).toBe(button.padding);
              expect(peer.fontSize).toBe(button.fontSize);
            }
          }).toPass({ timeout: 20000 });
          await expectClockInViewport(target);
          if (!catalog) {
            const status = await target
              .locator("#topbar .gameStatus")
              .evaluate((element) => ({
                client: element.clientWidth,
                scroll: element.scrollWidth,
              }));
            expect(status.scroll - status.client).toBeLessThanOrEqual(1);
          }
          report.push({ width, theme, touch, catalog, buttons: actual });
        };
        await compare(false);
        const capture = async (state = "") => {
          if (!process.env.MULTIPLAYER_SCREENSHOTS) return;
          await target.mouse.move(0, 0);
          await expect(target.getByRole("tooltip")).toBeHidden();
          await expect(
            target.getByText("Calculating forecast…", { exact: true }),
          ).toBeHidden({ timeout: 30000 });
          await target.screenshot({
            path: `${process.env.MULTIPLAYER_SCREENSHOTS}/qa-${width}-${theme}${state}.png`,
            fullPage: true,
          });
        };
        await expectClockMeaning(target, "ultra speed", "slow speed");
        await capture();
        await clock(target)
          .getByRole("button", { name: "slow speed", exact: true })
          .click();
        await expectClockMeaning(target, "slow speed", "slow speed");
        await capture("-same");
        await clock(target)
          .getByRole("button", { name: "ultra speed", exact: true })
          .click();
        await blockingPeer.locator(".button-buildFacility").click();
        await expectClockMeaning(target, "ultra speed", "pause");
        await expectClockInViewport(target);
        await capture("-paused");
        await blockingPeer
          .getByRole("button", { name: "Close Build", exact: true })
          .click();
        await expect(clock(target)).toHaveAttribute(
          "data-active-speed",
          "SLOW",
        );
        for (const page of [target, baseline])
          await page.locator(".button-buildFacility").click();
        await compare(true);
        for (const page of [target, baseline])
          await page
            .getByRole("button", { name: "Close Build", exact: true })
            .click();
      }
    }
  }
  await test.info().attach("speed-control-layouts", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
}

test("multiplayer speed controls match normal dimensions in desktop and touch layouts", async ({
  browser,
}) => {
  test.skip(
    !process.env.MULTIPLAYER_LAYOUT_QA,
    "Explicit six-layout comparison and visual QA",
  );
  test.setTimeout(240000);
  const { room, pages, errors } = await startSharedGame(browser, 4);
  for (const page of pages) await ready(page);
  // Three peers must fit along one button's bottom, including simultaneous temporary pauses.
  await expect(
    clock(pages[0])
      .getByRole("button", { name: "slow speed", exact: true })
      .locator(".multiplayerSpeedPeers svg"),
  ).toHaveCount(3);
  await expectClockInViewport(pages[0]);
  for (const peer of pages.slice(1))
    await peer.locator(".button-buildFacility").click();
  await expect(
    clock(pages[0])
      .getByRole("button", { name: "pause", exact: true })
      .locator(".multiplayerSpeedPeers svg"),
  ).toHaveCount(3);
  await expectClockInViewport(pages[0]);
  for (const peer of pages.slice(1))
    await peer
      .getByRole("button", { name: "Close Build", exact: true })
      .click();
  const selections = [
    "ultra speed",
    "normal speed",
    "slow speed",
    "ultra speed",
  ];
  for (let index = 0; index < pages.length; index++)
    await pages[index]
      .getByRole("button", { name: selections[index], exact: true })
      .click();
  await verifySpeedLayouts(browser, pages);
  expect(errors).toEqual([]);
  expect(room.transportErrors).toEqual([]);
});
async function saveAndQuit(page: Page) {
  await page.getByRole("button", { name: /^menu/ }).click();
  await page
    .getByRole("menuitem", { name: "Save & Quit", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play with friends", exact: true }),
  ).toBeVisible();
}

for (const width of [1280, 390]) {
  test(`multiplayer creation and resume walkthrough at ${width}px`, async ({
    browser,
  }) => {
    const room = new SteamRoom();
    room.campaignName = "Campaign 1";
    const mobile = width < 600;
    const host = await room.player(browser, 0, mobile);
    const guest = await room.player(browser, 1, mobile);
    await guest.emulateMedia({ colorScheme: "light" });
    const errors: string[] = [];
    for (const page of [host, guest])
      page.on("pageerror", (error) => errors.push(error.message));
    const capture = async (step: string, page = host, actionName?: string) => {
      if (!process.env.CAMPAIGN_WALKTHROUGH_SCREENSHOTS) return;
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeHidden();
      await expect(
        page.getByText("Calculating forecast…", { exact: true }),
      ).toBeHidden({ timeout: 30000 });
      await expect(
        page.getByText("Calculating Year 1 outlook…", { exact: true }).last(),
      ).toBeHidden({ timeout: 30000 });
      if (actionName) {
        const action = page.getByRole("button", {
          name: actionName,
          exact: true,
        });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeInViewport({ ratio: 1 });
      }
      await page.screenshot({
        path: `${process.env.CAMPAIGN_WALKTHROUGH_SCREENSHOTS}/${width}-${step}.png`,
        animations: "disabled",
        style: ".MuiTouchRipple-root { visibility: hidden !important; }",
      });
    };
    await capture("01-play-with-friends");
    await hostGame(host);
    await host
      .getByRole("button", { name: "Invite friends", exact: true })
      .click();
    await expect.poll(() => room.invites).toEqual([room.host]);
    await capture("02-host-and-invite");
    await guest.getByLabel("Invite code", { exact: true }).fill(room.lobbyId);
    await expect(guest.getByLabel("Invite code", { exact: true })).toHaveValue(
      room.lobbyId,
    );
    await guest.getByLabel("Invite code", { exact: true }).blur();
    await capture("03-join-with-code", guest);
    await guest.getByRole("button", { name: "Join", exact: true }).click();
    const roster = host.getByRole("list", { name: "Players", exact: true });
    await expect(
      roster.last().getByRole("img", { name: "Reviewing", exact: true }),
    ).toBeVisible();
    await capture("04-friend-joined");
    await host.getByTestId("mission-row-999").click();
    await expect(
      host.getByRole("button", { name: "Start for everyone", exact: true }),
    ).toBeEnabled();
    await capture("05-configure-game");
    await expect(guest.getByText("Following SolarSam").last()).toBeVisible();
    await expect(
      guest.getByText("Custom setup", { exact: true }).last(),
    ).toBeVisible();
    await capture("06-friend-ready", guest, "I'm ready");
    await guest.getByRole("button", { name: "I'm ready", exact: true }).click();
    await expect(
      roster.last().getByRole("img", { name: "Ready", exact: true }),
    ).toBeVisible();
    await capture("07-ready-to-start", host, "Start for everyone");
    await host
      .getByRole("button", { name: "Start for everyone", exact: true })
      .click();
    for (const page of [host, guest]) {
      await expect(page.locator(".facilities:visible")).toBeVisible();
      await expectClockMeaning(page, "pause", "pause");
    }
    await capture("08-game-paused");
    // A multiplayer save persists actual running progress, not merely a freshly created world.
    const initialDate = { ...room.views.get("76561198000000002")!.game!.date };
    for (const page of [host, guest]) await ready(page);
    await expect(clock(host)).toHaveAttribute("data-active-speed", "SLOW");
    await expect
      .poll(() => room.views.get("76561198000000002")?.game?.date)
      .not.toEqual(initialDate);
    // Hovering a speed names each player at it.
    await expect(
      clock(host).getByRole("button", { name: "slow speed", exact: true }),
    ).toHaveAttribute("title", "1×: SolarSam (you), WindyWren");
    await host.getByRole("button", { name: "pause", exact: true }).click();
    await host.getByRole("button", { name: /^menu/ }).click();
    await expect(
      host.getByRole("menuitem", { name: "Saved games", exact: true }),
    ).toHaveCount(0);
    await capture("09-save-and-quit");
    await host.keyboard.press("Escape");
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const savedDates = room.checkpoint!.grids.map((grid) => ({ ...grid.date }));
    const savedFacilities = room.checkpoint!.grids.map(
      (grid) => grid.facilities.length,
    );
    await capture("10-saved");
    await host
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await hostGame(host);
    await expect(
      host.getByRole("button", { name: "Load multiplayer save", exact: true }),
    ).toBeVisible();
    await capture("11-load-save-bar");
    await openSaves(host);
    await expect(
      host.getByRole("article", { name: "Campaign 1", exact: true }),
    ).toBeVisible();
    await capture("12-multiplayer-saves");
    await host.getByRole("button", { name: "Load save", exact: true }).click();
    await expect(company(host, "SolarSam")).toContainText("You");
    await expect(
      company(host, "WindyWren").getByRole("button", {
        name: "Take WindyWren's company",
      }),
    ).toBeVisible();
    await expect(
      host.getByRole("button", { name: "Resume game", exact: true }),
    ).toBeDisabled();
    await host
      .getByRole("dialog")
      .getByRole("button", { name: "Invite friends", exact: true })
      .click();
    await expect.poll(() => room.invites).toEqual([room.host, room.host]);
    await capture("13-pick-companies");
    await guest
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await joinGame(guest, room);
    // The returning friend takes back their own company by default.
    await expect(company(guest, "WindyWren")).toContainText("You");
    await expect(
      host.getByRole("button", { name: "Resume game", exact: true }),
    ).toBeEnabled();
    await capture("14-friend-rejoined", guest);
    await capture("15-resume-ready", host, "Resume game");
    await host
      .getByRole("button", { name: "Resume game", exact: true })
      .click();
    for (const page of [host, guest]) {
      await expect(page.locator(".facilities:visible")).toBeVisible();
      await expectClockMeaning(page, "pause", "pause");
    }
    await expect
      .poll(() => room.views.get("76561198000000002")?.game?.date)
      .toEqual(savedDates[1]);
    await expect
      .poll(() => room.views.get("76561198000000002")?.game?.facilities.length)
      .toBe(savedFacilities[1]);
    await capture("16-restored-paused");
    await capture("17-friend-restored-paused", guest);
    expect(errors).toEqual([]);
    expect(room.transportErrors).toEqual([]);
  });
}

for (const count of [2, 4]) {
  test(
    count +
      " players use the normal game, shared speeds, player interties, and menu saves",
    async ({ browser }) => {
      const { room, pages, errors } = await startSharedGame(browser, count);
      for (const page of pages) {
        await expect(page.locator(".facilities:visible")).toBeVisible();
        await expect(page.locator(".transmissionLine")).toHaveCount(count - 1);
        await expect(
          page.getByRole("button", { name: "Save match", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Your neighbors", exact: true }),
        ).toHaveCount(0);
      }
      const buyer = pages[count - 1];
      const buyerId = room.members[count - 1].id;
      await expect
        .poll(() => room.views.get(buyerId)?.game?.transmission?.lines.length)
        .toBe(count - 1);
      const starting = room.views.get(buyerId)!.game!;
      expect(
        starting.transmission!.lines.every(
          (line) =>
            line.corridorId.startsWith("peer:") &&
            line.yearsToBuildLeft === 0 &&
            !line.upgrade,
        ),
      ).toBe(true);
      if (count === 2) {
        // Keep the exact heartbeat deadline: a real >5s snapshot gap shows a warning, and
        // a healthy authoritative view must release that notice before players can resume.
        const warning = buyer.getByRole("dialog", {
          name: "Multiplayer",
          exact: true,
        });
        // Unchanged paused games still receive compact authenticated keepalives.
        await buyer.waitForTimeout(5500);
        await expect(warning).toBeHidden();
        room.heldViews.add(buyerId);
        await expect(
          warning.getByText(
            "Waiting for the host. Reconnect if the connection was lost.",
            { exact: true },
          ),
        ).toBeVisible();
        room.heldViews.delete(buyerId);
        await expect(warning).toBeHidden();
      }
      for (const page of pages) await ready(page);
      const selections =
        count === 4
          ? ["ultra speed", "normal speed", "slow speed", "ultra speed"]
          : ["ultra speed", "slow speed"];
      for (let i = 0; i < pages.length; i++)
        await pages[i]
          .getByRole("button", { name: selections[i], exact: true })
          .click();
      for (const page of pages)
        await expect(clock(page)).toHaveAttribute("data-active-speed", "SLOW");
      await expect(clock(pages[0])).toHaveAccessibleDescription(
        /SolarSam \(you\) selected 24×/,
      );
      await expect(clock(pages[0])).toHaveAccessibleDescription(
        count === 4 ? /WindyWren selected 3×/ : /WindyWren selected 1×/,
      );
      if (count === 4)
        await expect(clock(pages[0])).toHaveAccessibleDescription(
          /HydroHal selected 1×/,
        );
      await expect(
        pages[0].getByRole("button", { name: /Player speeds;/ }),
      ).toHaveCount(0);
      // The ordinary build catalog pauses the shared clock, and normal purchases reach the host.
      const fleetBefore = room.views.get(buyerId)?.game?.facilities.length ?? 0;
      await buyer.locator(".button-buildFacility").click();
      for (const page of pages)
        await expect(clock(page)).toHaveAttribute(
          "data-active-speed",
          "PAUSED",
        );
      await buyer
        .getByRole("button", { name: "Review purchase of Wind", exact: true })
        .click();
      await buyer
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect
        .poll(() => room.views.get(buyerId)?.game?.facilities.length)
        .toBe(fleetBefore + 1);
      await expect(buyer.locator(".facilities:visible")).toBeVisible();
      for (const page of pages)
        await expect(clock(page)).toHaveAttribute("data-active-speed", "SLOW");
      // Manual pauses are owned by their player; another player cannot resume them.
      await pages[0]
        .getByRole("button", { name: "pause", exact: true })
        .click();
      // Delay the guest's acknowledgment so its next click reverses an in-flight choice,
      // even though its last host snapshot still shows SLOW selected.
      if (count === 2) {
        await expect(clock(buyer)).toHaveAttribute(
          "data-active-speed",
          "PAUSED",
        );
        await expect(
          clock(buyer).getByRole("button", { name: "slow speed", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        room.heldViews.add(buyerId);
      }
      await pages[1]
        .getByRole("button", { name: "normal speed", exact: true })
        .click();
      for (const page of pages)
        await expect(clock(page)).toHaveAttribute(
          "data-active-speed",
          "PAUSED",
        );
      await pages[0]
        .getByRole("button", { name: "ultra speed", exact: true })
        .click();
      if (count === 2)
        await pages[1]
          .getByRole("button", { name: "slow speed", exact: true })
          .click();
      if (count === 2) room.heldViews.delete(buyerId);
      for (const page of pages)
        await expect(clock(page)).toHaveAttribute("data-active-speed", "SLOW");
      // Normal settings navigation is another local pause that freezes every player.
      await pages[0].getByRole("button", { name: /^menu/ }).click();
      await pages[0]
        .getByRole("menuitem", { name: "Settings", exact: true })
        .click();
      await expect(clock(buyer)).toHaveAttribute("data-active-speed", "PAUSED");
      await pages[0]
        .getByRole("button", { name: /close|back/i })
        .first()
        .click();
      await expect(clock(buyer)).toHaveAttribute("data-active-speed", "SLOW");
      if (count === 2) {
        // Normal inspectors and purchase dialogs upgrade one shared player wire.
        await pages[0]
          .getByRole("button", { name: /^Inspect WindyWren,/ })
          .click();
        await pages[0]
          .getByRole("button", {
            name: "Review upgrade of WindyWren",
            exact: true,
          })
          .click();
        await pages[0]
          .getByRole("button", { name: "Pay cash", exact: true })
          .click();
        await buyer.getByRole("button", { name: /^Inspect SolarSam,/ }).click();
        await expect(
          buyer.getByText(/SolarSam requested this upgrade/),
        ).toBeVisible();
        await buyer
          .getByRole("button", {
            name: "Review upgrade of SolarSam",
            exact: true,
          })
          .click();
        await buyer
          .getByRole("button", { name: "Pay cash", exact: true })
          .click();
        await expect
          .poll(
            () =>
              room.views.get(buyerId)?.game?.transmission?.lines[0].upgrade
                ?.targetCapacityW,
          )
          .toBe(starting.transmission!.lines[0].capacityW * 1.5);
        await pages[0]
          .getByRole("button", { name: /^Inspect WindyWren,/ })
          .click();
        await buyer.getByRole("button", { name: /^Inspect SolarSam,/ }).click();
      }
      const dropped = buyerId;
      room.dropped.add(dropped);
      await room.event(room.host, { kind: "disconnected", sender: dropped });
      await room.publish();
      await expect(clock(pages[0])).toHaveAttribute(
        "data-active-speed",
        "PAUSED",
      );
      await buyer.evaluate(() =>
        window.electrifyDesktop!.multiplayerRequest!({ kind: "reconnect" }),
      );
      for (const page of pages) await ready(page);
      if (count === 4) {
        await buyer.setViewportSize({ width: 360, height: 844 });
        await expectClockInViewport(buyer);
        await buyer.getByRole("button", { name: "Build", exact: true }).click();
        await expectClockInViewport(buyer);
        await buyer
          .getByRole("button", { name: "Close Build", exact: true })
          .click();
        await buyer.setViewportSize({ width: 390, height: 844 });
      }
      // Guest Save & Quit requests a fresh whole-world checkpoint before it disconnects.
      await saveAndQuit(buyer);
      const oldView = room.views.get(buyerId)!;
      const deliverOldView = async () => {
        // A frame decoded after native leave must not reinstall the departed match.
        await room.deliver(buyerId, {
          kind: "message",
          sender: room.host,
          payload: { kind: "view", view: oldView },
        });
        await expect(
          buyer.getByRole("button", { name: "Play with friends", exact: true }),
        ).toBeVisible();
        expect(room.state(buyerId)).toMatchObject({
          hostId: undefined,
          lobbyId: undefined,
          members: [],
          connected: [],
        });
      };
      await deliverOldView();
      expect(room.checkpoint!.grids[count - 1].facilities).toHaveLength(
        fleetBefore + 1,
      );
      expect(
        room.checkpoint!.grids.every(
          (grid) => grid.date.minute === room.checkpoint!.grids[0].date.minute,
        ),
      ).toBe(true);
      for (let i = 1; i < count - 1; i++) await saveAndQuit(pages[i]);
      await saveAndQuit(pages[0]);
      await pages[0]
        .getByRole("button", { name: "Play with friends", exact: true })
        .click();
      await hostGame(pages[0]);
      await loadSave(pages[0], "Friends campaign");
      await room.deliver(buyerId, {
        kind: "message",
        sender: room.host,
        payload: { kind: "view", view: oldView },
      });
      await expect(buyer.locator(".facilities:visible")).toHaveCount(0);
      await expect(
        pages[0].getByRole("button", { name: "Resume game", exact: true }),
      ).toBeDisabled();
      for (let i = 1; i < count; i++) {
        await pages[i]
          .getByRole("button", { name: "Play with friends", exact: true })
          .click();
        await joinGame(pages[i], room);
      }
      await pages[0]
        .getByRole("button", { name: "Resume game", exact: true })
        .click();
      for (const page of pages)
        await expect(page.locator(".facilities:visible")).toBeVisible();
      await expect
        .poll(() => room.views.get(buyerId)?.game?.facilities.length)
        .toBe(fleetBefore + 1);
      expect(errors).toEqual([]);
      expect(room.transportErrors).toEqual([]);
      expect(room.audioRequests).toEqual([]);
    },
  );
}

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
        id: "serve-customers",
        label: "Keep your grid reliable",
        metric: "monthlyReliability",
        minDemandServedShare: 0.5,
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

for (const width of [1280, 390, 360]) {
  test(`a shared mod needs no guest setup and survives library removal at ${width}px`, async ({
    browser,
  }) => {
    // Valid Steam names can be a single long word. Test the company identity inside
    // each scrollable surface: the dialog's outer box can fit while its text clips.
    const companyNames = ["W".repeat(32), "M".repeat(32)];
    const hostEntry = cooperativeMod(width !== 390);
    const guestEntry: InstalledMod = {
      ...cooperativeMod(true),
      key: "workshop:888",
      source: "workshop",
      workshopId: "888",
      pack: {
        ...hostEntry.pack,
        id: "guest-only-grid",
        title: "Guest's own grid",
        version: "different installed version",
      },
    };
    const disabledEntry: InstalledMod = {
      ...hostEntry,
      key: "local:disabled-grid",
      enabled: false,
      pack: { ...hostEntry.pack, id: "disabled-grid", title: "Disabled Grid" },
    };
    const room = new SteamRoom(
      createSteamTransport,
      [[hostEntry, disabledEntry], [guestEntry]],
      [...companyNames, ...STEAM_NAMES.slice(2)],
    );
    const hostId = room.host;
    const guestId = "76561198000000002";
    const host = await room.player(browser, 0, width < 600);
    const guest = await room.player(browser, 1, width < 600);
    const errors: string[] = [];
    for (const page of [host, guest]) {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
    }
    const guestLibrary = structuredClone(room.modEntries.get(guestId));
    const guestSubscriptions = [...room.subscriptions.get(guestId)!];
    const unchangedGuest = () => {
      expect(room.modEntries.get(guestId)).toEqual(guestLibrary);
      expect([...room.subscriptions.get(guestId)!]).toEqual(guestSubscriptions);
      expect(room.modRequests.get(guestId)).toEqual([]);
    };
    const capture = async (name: string, page: Page) => {
      await expect(
        page.locator("iframe#webpack-dev-server-client-overlay"),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (!process.env.REVIEW_SCREENSHOT_DIR) return;
      await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeHidden();
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `coop-mod-${width}-${name}.png`,
        ),
        animations: "disabled",
        style: ".MuiTouchRipple-root { visibility: hidden !important; }",
      });
    };
    await hostGame(host);
    await joinGame(guest, room);
    await host.getByTestId("community-scenarios").click();
    await expect(
      host.getByRole("button", { name: "Play Cooperative Grid", exact: true }),
    ).toBeEnabled();
    await expect(
      host.getByRole("button", { name: "Play Disabled Grid", exact: true }),
    ).toHaveCount(0);
    room.heldScenarios.add(guestId);
    const choose = async (difficulty: "Easy" | "Medium") => {
      await host
        .getByRole("button", { name: "Play Cooperative Grid", exact: true })
        .click();
      const dialog = host.getByRole("dialog", {
        name: "Play Cooperative Grid",
        exact: true,
      });
      await dialog
        .getByRole("button", { name: difficulty, exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Choose for everyone", exact: true })
        .click();
    };
    await choose("Easy");
    await expect(
      guest.getByRole("button", { name: "Receiving scenario…", exact: true }),
    ).toBeDisabled();
    await expect.poll(() => room.pendingScenarios.has(guestId)).toBe(true);
    const originalSelection = room.pendingScenarios.get(guestId)!;
    await capture("receiving-dark", guest);
    unchangedGuest();
    await room.releaseScenario(guestId);
    await expect(
      guest.getByRole("button", { name: "I'm ready", exact: true }),
    ).toBeEnabled();
    for (const page of [host, guest]) {
      const preview = page.locator(".coopModPreview");
      await expect(
        preview.getByRole("heading", { name: "Cooperative Grid", exact: true }),
      ).toBeVisible();
      await expect(preview).toContainText("By Community engineer · v1.0");
      await expect(preview).toContainText(
        "Modded · Unranked · No achievements",
      );
      await expect(preview).toContainText("Keep your grid reliable");
      await expect(preview).toContainText(
        "Delivered customer electricity divided by customer demand each completed month.",
      );
      await expect(preview).toContainText("Grid funding");
      await expect(preview).not.toContainText("Private surprise");
      expect(
        await preview.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    if (hostEntry.workshopId)
      await expect(
        guest.getByRole("button", {
          name: "Keep a copy from Workshop",
          exact: true,
        }),
      ).toBeVisible();
    else
      await expect(
        guest.getByText("This is the host's local mod.", { exact: true }),
      ).toBeVisible();
    await guest.getByRole("button", { name: "I'm ready", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Ready", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    // A newly frozen difficulty is a new agreement, even when the package is unchanged.
    await host
      .getByRole("button", {
        name: "Choose another community scenario",
        exact: true,
      })
      .click();
    room.heldScenarios.add(guestId);
    await choose("Medium");
    await expect(
      guest.getByRole("button", { name: "Receiving scenario…", exact: true }),
    ).toBeDisabled();
    await expect.poll(() => room.pendingScenarios.has(guestId)).toBe(true);
    expect(room.pendingScenarios.get(guestId)).not.toEqual(originalSelection);
    await room.releaseScenario(guestId);
    const readyButton = guest.getByRole("button", {
      name: "I'm ready",
      exact: true,
    });
    await expect(readyButton).toHaveAttribute("aria-pressed", "false");
    await readyButton.focus();
    await guest.keyboard.press("Enter");
    await expect(
      guest.getByRole("button", { name: "Ready", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const start = host.getByRole("button", {
      name: "Start for everyone",
      exact: true,
    });
    await expect(start).toBeEnabled();
    await start.scrollIntoViewIfNeeded();
    await capture("preview-light", host);
    await capture("preview-dark", guest);
    unchangedGuest();
    await start.click();
    const hostChoice = host.getByRole("dialog", { name: /Grid funding/ });
    const guestChoice = guest.getByRole("dialog", { name: /Grid funding/ });
    for (const [page, dialog, companyName] of [
      [host, hostChoice, companyNames[0]],
      [guest, guestChoice, companyNames[1]],
    ] as const) {
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Your company: ${companyName}`);
      await expect(dialog).toContainText(
        `Still deciding: ${companyNames.join(", ")}`,
      );
      await expect(dialog).toContainText("One-time grant: $1M");
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      expect(
        await dialog
          .locator(".MuiDialogContent-root")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      for (const button of await dialog.getByRole("button").all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const primary = dialog.getByRole("button", {
        name: "Accept funding",
        exact: true,
      });
      const secondary = dialog.getByRole("button", {
        name: "Keep the current plan",
        exact: true,
      });
      await expect(primary).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(secondary).toBeFocused();
      await expect(secondary).toBeInViewport();
      await page.keyboard.press("Shift+Tab");
      await expect(primary).toBeFocused();
      await capture(page === host ? "choice-light" : "choice-dark", page);
    }
    await expect(
      hostChoice.getByRole("button", { name: "Accept funding", exact: true }),
    ).toBeFocused();
    await host.keyboard.press("Enter");
    await expect(hostChoice).toBeHidden();
    await expect(guestChoice).toContainText(
      `Still deciding: ${companyNames[1]}`,
    );
    await ready(host);
    await expect
      .poll(
        () =>
          room.views
            .get(guestId)
            ?.game?.multiplayer?.clock?.players.find(
              (player) => player.id === guestId,
            )?.pauseReason,
      )
      .toBe("Choosing a response");
    expect(room.views.get(guestId)?.speed).toBe("PAUSED");
    expect(room.views.get(guestId)?.game?.date.minute).toBe(0);
    await expect(
      guestChoice.getByRole("button", { name: "Accept funding", exact: true }),
    ).toBeFocused();
    await guest.keyboard.press("Tab");
    await expect(
      guestChoice.getByRole("button", {
        name: "Keep the current plan",
        exact: true,
      }),
    ).toBeFocused();
    await guest.keyboard.press("Space");
    await expect(guestChoice).toBeHidden();
    await ready(guest);
    await expect
      .poll(() => room.views.get(guestId)?.game?.date.minute ?? 0)
      .toBeGreaterThan(0);
    await clock(host)
      .getByRole("button", { name: "pause", exact: true })
      .click();
    for (const [page, companyName, outcome] of [
      [host, companyNames[0], "Your company accepted funding."],
      [guest, companyNames[1], "Your company kept its current plan."],
    ] as const) {
      const events = page.locator(".eventLog");
      await openPane(
        events,
        page.getByRole("button", { name: "Events", exact: true }),
      );
      await expect(events).toContainText(`Events for ${companyName}.`);
      await expect(events).toContainText(outcome);
      expect(
        await events
          .locator(".scrollable")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await capture(page === host ? "events-light" : "events-dark", page);
      await page
        .getByRole("button", { name: "Close Events", exact: true })
        .click();
      await expect(events).toBeHidden();
    }
    const scenarioPanel = guest.getByRole("region", {
      name: "Scenario",
      exact: true,
    });
    await openPane(
      scenarioPanel,
      guest.getByRole("button", { name: "Scenario", exact: true }),
    );
    await expect(scenarioPanel).toContainText("Keep your grid reliable");
    await guest.keyboard.press("Escape");
    await saveAndQuit(guest);
    await saveAndQuit(host);
    const checkpoint = structuredClone(room.checkpoint!);
    const digest = checkpoint.spec.customScenario!.mod!.runtimeDigest;
    expect(checkpoint.spec.customScenario!.mod!.parameters.difficulty).toBe(
      "Manager",
    );
    checkpoint.grids.forEach((grid, index) => {
      expect(grid.scenarioId).toBe(999);
      expect(grid.runIdentity).toBeUndefined();
      expect(grid.customScenario!.mod!.runtimeDigest).toBe(digest);
      const receipts = grid.worldEvents.occurrences.filter(
        (event) => event.key === "mod:cooperative-grid:funding",
      );
      expect(receipts).toHaveLength(1);
      expect(receipts[0].attributes.choice).toBe(
        index === 0 ? "accept" : "decline",
      );
      expect(receipts[0].attributes.upfrontGrant).toBe(
        index === 0 ? 1000000 : 0,
      );
    });
    unchangedGuest();
    // Simulate removing the host's installed package while its frozen match is closed.
    room.modEntries.set(hostId, []);
    await host
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await hostGame(host);
    await loadSave(host, room.campaignName);
    await guest
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await joinGame(guest, room);
    await expect(
      host.getByRole("button", { name: "Resume game", exact: true }),
    ).toBeEnabled();
    await host
      .getByRole("button", { name: "Resume game", exact: true })
      .click();
    for (const page of [host, guest]) {
      await expect(page.locator(".facilities:visible")).toBeVisible();
      await expect(
        page.getByRole("dialog", { name: /Grid funding/ }),
      ).toBeHidden();
      await expect(
        page.locator("iframe#webpack-dev-server-client-overlay"),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() => ({
          scores: (window as SteamTestWindow).mockScoreSubmissions ?? 0,
          achievements:
            (window as SteamTestWindow).mockAchievementSubmissions ?? 0,
        })),
      ).toEqual({ scores: 0, achievements: 0 });
    }
    await expect
      .poll(() => room.views.get(guestId)?.game?.date)
      .toEqual(checkpoint.grids[1].date);
    await expect
      .poll(() => room.views.get(guestId)?.scenarioDigest)
      .toBe(digest);
    expect(room.modEntries.get(hostId)).toEqual([]);
    unchangedGuest();
    expect(errors).toEqual([]);
    expect(room.transportErrors).toEqual([]);
  });
}

/** Observe the real projection worker boundary; requests and replies are passed through intact. */
async function observeNativeForecasts(page: Page) {
  await page.addInitScript(() => {
    const target = window as SteamTestWindow;
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
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Take loan", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
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
      /^\$0\.1 per kilowatt hour/,
    );
  } else await expect(price).toHaveAttribute("aria-valuenow", String(rate));
  await page.keyboard.press("Escape");
}

for (const scenarioId of [106, 107] as const) {
  for (const width of [1280, 390, 360]) {
    test(`native ${scenarioId} companies choose independently and preserve rules on resume at ${width}px`, async ({
      browser,
      advanceWorldSave,
    }) => {
      test.setTimeout(240000);
      const room = new SteamRoom(async (page) => {
        await observeNativeForecasts(page);
        return createSteamTransport(page);
      });
      room.campaignName = `Official ${scenarioId} campaign`;
      const host = await room.player(browser, 0, width < 600);
      const guest = await room.player(browser, 1, width < 600);
      const guestId = "76561198000000002";
      const pages = [host, guest];
      const errors: string[] = [];
      const resumeSaved = async () => {
        await host
          .getByRole("button", { name: "Play with friends", exact: true })
          .click();
        await hostGame(host);
        await loadSave(host, room.campaignName);
        await guest
          .getByRole("button", { name: "Play with friends", exact: true })
          .click();
        await joinGame(guest, room);
        const resume = host.getByRole("button", {
          name: "Resume game",
          exact: true,
        });
        await expect(resume).toBeEnabled();
        await resume.click();
        for (const page of pages)
          await expect(page.locator(".facilities:visible")).toBeVisible();
      };
      const advanceSaved = async (month: number) => {
        await saveAndQuit(guest);
        await saveAndQuit(host);
        room.checkpoint = await advanceWorldSave(
          room.checkpoint!,
          month,
          test.info().outputPath("native-world.json"),
        );
        await resumeSaved();
      };
      for (const page of pages) {
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
      }
      const capture = async (name: string, page: Page) => {
        await expect(
          page.locator("iframe#webpack-dev-server-client-overlay"),
        ).toHaveCount(0);
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(1);
        if (!process.env.REVIEW_SCREENSHOT_DIR) return;
        await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip")).toBeHidden();
        await expect(page.locator(".snackbarContent")).toBeHidden();
        await page.screenshot({
          path: path.join(process.env.REVIEW_SCREENSHOT_DIR, name),
          animations: "disabled",
          style: ".MuiTouchRipple-root { visibility: hidden !important; }",
        });
      };
      const goal =
        scenarioId === 106
          ? "Retain the community"
          : "Keep the lights on through the freeze";
      const scenarioPanel = (page: Page) =>
        page.getByRole("region", { name: "Scenario", exact: true });
      const showGoal = async (page: Page) => {
        const panel = scenarioPanel(page);
        await openPane(
          panel,
          page.getByRole("button", { name: "Scenario", exact: true }),
        );
        await expect(panel).toContainText(goal);
        await expect(panel).not.toContainText("Modded");
        return panel;
      };
      await hostGame(host);
      await joinGame(guest, room);
      await host.getByTestId(`mission-row-${scenarioId}`).click();
      const easy = host.getByRole("button", { name: "Easy", exact: true });
      await easy.focus();
      await host.keyboard.press("Enter");
      await expect(easy).toHaveAttribute("aria-pressed", "true");
      await expect(guest.getByText("Following SolarSam").last()).toBeVisible();
      const readyButton = guest.getByRole("button", {
        name: "I'm ready",
        exact: true,
      });
      await readyButton.focus();
      await guest.keyboard.press("Enter");
      await expect(
        guest.getByRole("button", { name: "Ready", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      for (const page of pages)
        await expect(page.locator(".coopModPreview")).toHaveCount(0);
      await host
        .getByRole("button", { name: "Start for everyone", exact: true })
        .click();
      await expect
        .poll(() => room.views.get(guestId)?.game?.scenarioId)
        .toBe(scenarioId);
      expect(room.views.get(guestId)!.game!.customScenario).toBeUndefined();
      expect(room.views.get(guestId)!.game!.difficulty).toBe("Employee");
      expect(room.views.get(guestId)!.scenarioDigest).toBeUndefined();
      const seed = room.views.get(guestId)!.game!.seed;
      if (scenarioId === 107) expect(seed).toBe(268107);
      await test.info().attach("Native shared seed and paid route", {
        body: JSON.stringify({
          scenarioId,
          seed,
          width,
          difficulty: "Employee",
          backupW: scenarioId === 106 ? 50e6 : 2e9,
          financed: true,
          rate: scenarioId === 106 ? 0.12 : 0.1,
        }),
        contentType: "application/json",
      });
      for (const page of pages) {
        await expect(page.locator(".facilities:visible")).toBeVisible();
        await buyNativeBackup(
          page,
          scenarioId === 106 ? 50e6 : 2e9,
          scenarioId === 106 ? 0.12 : 0.1,
        );
        await expect(await showGoal(page)).toContainText(
          "0/1 months completed",
        );
        await page.keyboard.press("Escape");
      }
      const dueMonth = scenarioId === 106 ? 48 : 36;
      // Simulate the long lead-in from the UI's purchases, then cross the actual decision
      // boundary in the production worker. This avoids a CI timer-speed dependency.
      await advanceSaved(dueMonth - 1);
      for (const page of pages)
        await clock(page)
          .getByRole("button", { name: "ultra speed", exact: true })
          .click();
      const choiceTitle =
        scenarioId === 106
          ? "Negotiate the data-center connection"
          : "Prepare for the deep freeze";
      const dialogs = pages.map((page) =>
        page.getByRole("dialog", { name: new RegExp(choiceTitle) }),
      );
      await expect(dialogs[0]).toBeVisible({ timeout: 120000 });
      await expect(dialogs[1]).toBeVisible();
      await expect
        .poll(() => room.views.get(guestId)?.game?.date.monthsElapsed)
        .toBe(dueMonth);
      await expect
        .poll(() =>
          room.checkpoint?.grids.map((game) => game.date.monthsElapsed),
        )
        .toEqual([dueMonth, dueMonth]);
      const pending = structuredClone(room.checkpoint!);
      const decisionKey =
        scenarioId === 106
          ? "story:106:data-center-boom:connection"
          : "story:107:texas-deep-freeze:winterization";
      for (const game of pending.grids) {
        expect(game.scenarioId).toBe(scenarioId);
        expect(game.customScenario).toBeUndefined();
        expect(game.runIdentity).toBeUndefined();
        expect(game.seed).toBe(seed);
        expect(game.facilities).toContainEqual(
          expect.objectContaining({
            name: "Natural Gas Peaker",
            peakW: scenarioId === 106 ? 50e6 : 2e9,
          }),
        );
        expect(
          game.worldEvents.occurrences.some(
            (event) => event.key === decisionKey,
          ),
        ).toBe(false);
        expect(game.monthlyHistory).toHaveLength(dueMonth);
      }
      for (const [index, dialog] of dialogs.entries()) {
        await expect(dialog).toContainText(
          `Your company: ${index === 0 ? "SolarSam" : "WindyWren"}`,
        );
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
      if (scenarioId === 106 && [1280, 360].includes(width))
        await capture(
          `native-106-${width}-choice-${width === 1280 ? "light" : "dark"}.png`,
          width === 1280 ? host : guest,
        );
      const responses =
        scenarioId === 106
          ? ["fast-track", "phased"]
          : ["winterize", "standard"];
      const buttons =
        scenarioId === 106
          ? [/^Accept funded connection$/, /^Require phased connections$/]
          : [/^Fund winterization/, /^Keep construction budget$/];
      await dialogs[0].getByRole("button", { name: buttons[0] }).focus();
      await host.keyboard.press("Enter");
      await expect(dialogs[0]).toBeHidden();
      await expect(dialogs[1]).toContainText("Still deciding: WindyWren");
      // Keep the shared clock paused after the second commitment while its forecast is inspected.
      await clock(host)
        .getByRole("button", { name: "pause", exact: true })
        .click();
      await dialogs[1].getByRole("button", { name: buttons[1] }).focus();
      await guest.keyboard.press("Enter");
      await expect(dialogs[1]).toBeHidden();
      for (const [index, page] of pages.entries()) {
        await openPane(
          page.locator(".insights"),
          page.getByRole("button", { name: "Insights", exact: true }),
        );
        await expect
          .poll(
            () =>
              page.evaluate(
                ({ key, response }) => {
                  const target = window as SteamTestWindow;
                  return target.nativeForecasts?.some(
                    (request) =>
                      request.responses.some(
                        (choice) =>
                          choice.key === key && choice.optionId === response,
                      ) && target.nativeForecastReplies?.includes(request.id),
                  );
                },
                { key: decisionKey, response: responses[index] },
              ),
            { timeout: 60000 },
          )
          .toBe(true);
        const request = await page.evaluate(
          ({ key, response }) =>
            (window as SteamTestWindow).nativeForecasts!.findLast((request) =>
              request.responses.some(
                (choice) => choice.key === key && choice.optionId === response,
              ),
            ),
          { key: decisionKey, response: responses[index] },
        );
        expect(request!.scenarioId).toBe(scenarioId);
        expect(request!.hasCustomScenario).toBe(false);
        expect(request!.seed).toBe(seed);
        if (scenarioId === 106)
          expect(
            request!.loads.map((load) => ({
              peakW: load.peakW,
              year: load.startsYear,
            })),
          ).toEqual(
            index === 0
              ? [{ peakW: 100e6, year: 2026 }]
              : [
                  { peakW: 50e6, year: 2026 },
                  { peakW: 50e6, year: 2028 },
                ],
          );
        const chart = page
          .locator(".insights:visible")
          .getByRole("img", { name: /^(Chart of|Monthly ranges of)/ })
          .first();
        await expect(chart).toBeVisible({ timeout: 60000 });
        await expect(chart).toHaveAttribute("aria-label", /demand|supply/i);
        await page.keyboard.press("Escape");
      }
      await expect
        .poll(() =>
          room.checkpoint?.grids.map(
            (game) =>
              game.worldEvents.occurrences.find(
                (event) => event.key === decisionKey,
              )?.attributes.choice,
          ),
        )
        .toEqual(responses);
      for (const [index, game] of room.checkpoint!.grids.entries()) {
        const receipt = game.worldEvents.occurrences.find(
          (event) => event.key === decisionKey,
        )!;
        expect(receipt.attributes.cost).toBe(
          scenarioId === 107 && index === 0 ? 90e6 : 0,
        );
        expect(receipt.attributes.upfrontGrant).toBe(
          scenarioId === 106 && index === 0 ? 15e6 : 0,
        );
        expect(game.date.monthsElapsed).toBe(dueMonth);
      }
      if (scenarioId === 107) {
        // Keep the February freeze and goal rollover in the browser; simulate its lead-in.
        await advanceSaved(49);
        for (const page of pages)
          await clock(page)
            .getByRole("button", { name: "ultra speed", exact: true })
            .click();
        await expect
          .poll(() => room.views.get(guestId)?.game?.date.monthsElapsed, {
            timeout: 60000,
          })
          .toBeGreaterThanOrEqual(50);
        await clock(host)
          .getByRole("button", { name: "pause", exact: true })
          .click();
        const keepWatching = guest.getByRole("button", {
          name: "Keep watching",
          exact: true,
        });
        if (await keepWatching.isVisible()) await keepWatching.click();
        for (const page of pages) {
          const panel = await showGoal(page);
          await expect(panel).toContainText("1/1 months completed");
          await expect(panel.getByText("Met", { exact: true })).toBeVisible();
          await page.keyboard.press("Escape");
        }
        if (width === 390) {
          const panel = await showGoal(guest);
          const title = panel.getByText(goal, { exact: true });
          const observed = panel.getByText(/1\/1 months completed/);
          await title.scrollIntoViewIfNeeded();
          await observed.scrollIntoViewIfNeeded();
          await expect(title).toBeInViewport();
          await expect(observed).toBeInViewport();
          await expect(
            panel.getByText("Met", { exact: true }),
          ).toBeInViewport();
          await capture("native-107-390-goal-dark.png", guest);
          await guest.keyboard.press("Escape");
        }
      } else {
        await expect(await showGoal(guest)).toContainText(
          "0/1 months completed",
        );
        await guest.keyboard.press("Escape");
      }
      await saveAndQuit(guest);
      await saveAndQuit(host);
      const saved = structuredClone(room.checkpoint!);
      if (scenarioId === 107)
        for (const game of saved.grids) {
          const february = game.monthlyHistory.find(
            (month) => month.year === 2021 && month.month === 2,
          )!;
          expect(february).toBeDefined();
          expect(february.demandWh).toBeGreaterThan(0);
          expect(
            game.objectiveProgress!.entries.find(
              (entry) => entry.id === "reliability",
            )!.observations,
          ).toEqual([[49, february.supplyWh, february.demandWh]]);
        }
      const facts = (game: GameType) => ({
        date: game.date,
        history: game.monthlyHistory,
        facilities: game.facilities,
        events: game.worldEvents,
        progress: game.objectiveProgress,
        rate: game.dollarsPerkWh,
      });
      await resumeSaved();
      for (const page of pages) {
        await expect(page.locator(".facilities:visible")).toBeVisible();
        await expect(
          page.getByRole("dialog", { name: new RegExp(choiceTitle) }),
        ).toBeHidden();
        await expect(
          page.locator("iframe#webpack-dev-server-client-overlay"),
        ).toHaveCount(0);
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(1);
        expect(
          await page.evaluate(() => ({
            scores: (window as SteamTestWindow).mockScoreSubmissions ?? 0,
            achievements:
              (window as SteamTestWindow).mockAchievementSubmissions ?? 0,
          })),
        ).toEqual({ scores: 0, achievements: 0 });
      }
      await expect
        .poll(
          () =>
            room.views.get(guestId)?.game &&
            facts(room.views.get(guestId)!.game!),
        )
        .toEqual(facts(saved.grids[1]));
      await expect
        .poll(() => room.checkpoint?.grids.map(facts))
        .toEqual(saved.grids.map(facts));
      expect(room.checkpoint!.spec).toEqual({
        scenarioId,
        difficulty: "Employee",
      });
      expect(room.views.get(guestId)!.game!.customScenario).toBeUndefined();
      expect(room.views.get(guestId)!.scenarioDigest).toBeUndefined();
      expect(errors).toEqual([]);
      expect(room.transportErrors).toEqual([]);
    });
  }
}
