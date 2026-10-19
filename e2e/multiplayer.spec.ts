import { test, expect, Page, Browser } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type {
  LobbyState,
  NativeEvent,
  NativeRequest,
} from "../src/multiplayer/Native";
import type { RoomView, World } from "../src/multiplayer/Types";
import { verifyMenuKeyboard } from "./menu-keyboard";

type SteamTestWindow = typeof window & {
  mockSteamDeliveries?: Set<Promise<void>>;
  mockSteamAcknowledge?: (id: number, error?: string) => Promise<void>;
  releaseMockSteamDelivery?: () => void;
  receivedMockSteamEvent?: unknown;
  mockSteamGeneration?: number;
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

class SteamRoom {
  constructor(private readonly createTransport = createSteamTransport) {}
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
    for (const id of this.pages.keys())
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
          name: `Player ${this.members.length + 1}`,
        });
      await this.publish();
      return this.state(id);
    }
    if (input.kind === "member") {
      this.members.find((m) => m.id === id)!.ready = input.value;
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
    if (input.kind === "reconnect") {
      this.dropped.delete(id);
      await this.publish();
      return this.state(id);
    }
    if (input.kind === "leave") {
      this.members = this.members.filter((m) => m.id !== id);
      this.pendingViews.delete(id);
      this.heldViews.delete(id);
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
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      colorScheme: index % 2 ? "dark" : "light",
      hasTouch: mobile,
      isMobile: mobile,
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
          submitScore: async () => {},
          openFriends: async () => {},
          setActivity: async () => {},
          addTimelineEvent: async () => {},
          multiplayerRequest: (input) =>
            (
              window as unknown as {
                mockSteamRequest: (input: NativeRequest) => Promise<unknown>;
              }
            ).mockSteamRequest(input),
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
    if (index === 0)
      await page.getByRole("button", { name: "Host a Steam lobby" }).click();
    else {
      await page.getByLabel("Lobby code", { exact: true }).fill(room.lobbyId);
      await page
        .getByRole("button", { name: "Join lobby", exact: true })
        .click();
    }
  }
  // The host chooses in the normal scenario screens; every guest follows along read-only.
  await pages[0]
    .getByRole("button", { name: "Choose a game together", exact: true })
    .click();
  // 999 is CUSTOM_SCENARIO_ID: the custom game row sits at the end of the list.
  await pages[0].getByTestId("mission-row-999").click();
  for (const guest of pages.slice(1)) {
    // The outgoing card stays mounted while the next one slides in, so check the newest.
    await expect(guest.getByText("Following Player 1").last()).toBeVisible();
    await expect(
      guest.getByText("Custom setup", { exact: true }).last(),
    ).toBeVisible();
    await guest.getByRole("button", { name: "I'm ready", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Ready", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await expect(
    pages[0].getByText(`${count - 1} of ${count - 1} ready`).last(),
  ).toBeVisible();
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
        /Player 1 \(you\) selected 24×/,
      );
      await expect(clock(pages[0])).toHaveAccessibleDescription(
        count === 4 ? /Player 2 selected 3×/ : /Player 2 selected 1×/,
      );
      if (count === 4)
        await expect(clock(pages[0])).toHaveAccessibleDescription(
          /Player 3 selected 1×/,
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
          .getByRole("button", { name: /^Inspect Player 2,/ })
          .click();
        await pages[0]
          .getByRole("button", {
            name: "Review upgrade of Player 2",
            exact: true,
          })
          .click();
        await pages[0]
          .getByRole("button", { name: "Pay cash", exact: true })
          .click();
        await buyer.getByRole("button", { name: /^Inspect Player 1,/ }).click();
        await expect(
          buyer.getByText(/Player 1 requested this upgrade/),
        ).toBeVisible();
        await buyer
          .getByRole("button", {
            name: "Review upgrade of Player 1",
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
          .getByRole("button", { name: /^Inspect Player 2,/ })
          .click();
        await buyer.getByRole("button", { name: /^Inspect Player 1,/ }).click();
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
      for (let i = 0; i < count; i++) {
        await pages[i]
          .getByRole("button", { name: "Play with friends", exact: true })
          .click();
        if (i === 0)
          await pages[i]
            .getByRole("button", { name: "Host a Steam lobby", exact: true })
            .click();
        else {
          await pages[i]
            .getByLabel("Lobby code", { exact: true })
            .fill(room.lobbyId);
          await pages[i]
            .getByRole("button", { name: "Join lobby", exact: true })
            .click();
        }
        if (i === 0) await deliverOldView();
      }
      await pages[0]
        .getByRole("button", { name: "Resume last shared save", exact: true })
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
