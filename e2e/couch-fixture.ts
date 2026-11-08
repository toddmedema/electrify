import { BrowserContext, Frame, Page, expect } from "@playwright/test";
import type { DesktopInputAction, DesktopInputFrame } from "../src/Desktop";
import type { World } from "../src/multiplayer/Types";

type Device = DesktopInputFrame & { id: string };
const defaultDevices: Device[] = ["101", "202"].map((id) => ({
  id,
  connected: true,
  actions: [],
  glyphs: {
    up: { label: "D-pad up" },
    down: { label: "D-pad down" },
    left: { label: "D-pad left" },
    right: { label: "D-pad right" },
    confirm: { label: id === "101" ? "A" : "Cross" },
    back: { label: id === "101" ? "B" : "Circle" },
    menu: { label: id === "101" ? "Start" : "Options" },
    menuAlt: { label: id === "101" ? "View" : "PlayStation Share" },
    pause: { label: id === "101" ? "Y" : "Triangle" },
    speedUp: { label: "Right stick up" },
    speedDown: { label: "Right stick down" },
    previousPane: { label: id === "101" ? "LB" : "L1" },
    nextPane: { label: id === "101" ? "RB" : "R1" },
    build: { label: id === "101" ? "X" : "Square" },
    previousChart: { label: id === "101" ? "LT" : "L2" },
    nextChart: { label: id === "101" ? "RT" : "R2" },
  },
}));

interface CouchLayout {
  fits: boolean;
  zoom: number;
  cssWidth: number;
  cssHeight: number;
  bounds: { x: number; y: number; width: number; height: number }[];
}
export interface CouchFixture<Actor extends Page | Frame> {
  seats: Map<string, { page: Actor; generation: number }>;
  failNextNativeReload: (seatId: string) => void;
  settledNativeRequests: (kind: string) => Promise<number>;
  nativeEvidence: () => {
    topology: Record<string, { generation: number; hasPort: boolean }>;
    errors: readonly string[];
    calls: { bind: number; status: number; inputFrame: number };
  };
  nativeBindings: () => Record<string, string>;
  bindAttempts: () => readonly { seatId: string; controllerId: string }[];
  setConnected: (connections: Record<string, boolean>) => Promise<void>;
  deferNextBind: (commitBeforeReply?: boolean) => {
    requested: Promise<void>;
    settle: (outcome: "resolve" | "reject") => void;
  };
  checkpoint: () => World | undefined;
  layout: () => CouchLayout | undefined;
  backdropRevision: () => number;
  refreshRequests: () => number;
  presentationMessages: () => number;
  settleCaptures: () => Promise<void>;
  cancelledText: () => readonly string[];
  failNextNative: (kind: "setup" | "list-saves" | "close") => void;
  input: (actions: Record<string, DesktopInputAction[]>) => Promise<void>;
}
const {
  couchLayout,
  sharedMenuFrame,
}: {
  couchLayout: (
    width: number,
    height: number,
    count: number,
    options: Record<string, unknown>,
  ) => CouchLayout;
  sharedMenuFrame: (
    seatIds: Iterable<string>,
    bindings: ReadonlyMap<string, string>,
    devices: Device[],
    preferredSeatId?: string,
  ) => { seatId: string; frame: Device } | undefined;
} = require("../electron/couch.cjs");
interface NativeHarness {
  manager: {
    setup: boolean;
    bindings: Map<string, string>;
    seats: Map<
      string,
      {
        generation: number;
        port?: unknown;
        view: { webContents: { reload: () => void } };
      }
    >;
    bind: (
      seatId: string,
      controllerId: string,
    ) => { seatId: string; controllerId: string };
    status: () => {
      available: boolean;
      devices: Device[];
      bindings: Record<string, string>;
      active: boolean;
    };
    inputFrame: (frames: Device[]) => void;
    open: (input: Record<string, unknown>) => Promise<unknown>;
    close: () => void;
    overlay: (owner: string | null, shared: boolean) => unknown;
    relayout: (options: Record<string, unknown>) => unknown;
  };
  size: number[];
}
const {
  createCouchNativeFixture,
}: {
  createCouchNativeFixture: (configuration: {
    input: () => unknown;
    publish: (event: { kind: string }) => void;
  }) => NativeHarness;
} = require("../scripts/ci/couch-native-fixture");
const isPage = (actor: Page | Frame): actor is Page =>
  "setViewportSize" in actor;
const actorClosed = (actor: Page | Frame) =>
  isPage(actor) ? actor.isClosed() : actor.isDetached();

export function createCouchFixture(
  context: BrowserContext,
  shell: Page,
): Promise<CouchFixture<Page>>;
export function createCouchFixture(
  context: BrowserContext,
  shell: Page,
  options: { embedded: true },
): Promise<CouchFixture<Frame>>;
export function createCouchFixture(
  context: BrowserContext,
  shell: Page,
  options: { nativeBindings: true },
): Promise<CouchFixture<Page>>;
/** Replace native transport only. Shell coordinator, simulation worker, seat clients,
 * Redux stores, controls and data loading are the production implementations. Embedded
 * mode paints those same documents at the native bounds for full-window layout review;
 * it does not establish native focus/process isolation. */
export async function createCouchFixture(
  context: BrowserContext,
  shell: Page,
  options?: { embedded?: true; nativeBindings?: true },
): Promise<CouchFixture<Page | Frame>> {
  const seats = new Map<string, { page: Page | Frame; generation: number }>();
  let nativeEvents = Promise.resolve();
  const inputAdapter = {
    initialized: true,
    deviceContexts: new Map(),
    releaseDevice: () => {},
    setDeviceMode: () => {},
    setContext: () => {},
    setDeviceContext: () => ({ connected: true, actions: [], glyphs: {} }),
  };
  const native = options?.nativeBindings
    ? createCouchNativeFixture({
        input: () => inputAdapter,
        publish: (event) => {
          if (event.kind === "devices" || event.kind === "seat-lost")
            nativeEvents = nativeEvents.then(() => emit(event));
        },
      })
    : undefined;
  const viewport = shell.viewportSize();
  if (native && viewport)
    native.size.splice(0, 2, viewport.width, viewport.height);
  const bindings = native?.manager.bindings ?? new Map<string, string>();
  const nativeErrors: string[] = [];
  const nativeCalls = { bind: 0, status: 0, inputFrame: 0 };
  const devices = structuredClone(defaultDevices);
  const bindAttempts: { seatId: string; controllerId: string }[] = [];
  let deferredBind:
    | {
        commitBeforeReply: boolean;
        requested: () => void;
        outcome: Promise<"resolve" | "reject">;
      }
    | undefined;
  let saved: World | undefined;
  let updatedAt = 0;
  let overlayOwner: string | null = null;
  let overlayShared = false;
  let sharedInputSeat: string | undefined;
  let playing = false;
  let confirmOnly = false;
  let generation = 0;
  let layout: CouchLayout | undefined;
  let layoutOptions: Record<string, unknown> = {};
  let overlayVersion = 0;
  let captureId = 0;
  let publishedCaptureId = 0;
  let readyCaptureId = 0;
  let overlayCommitted = false;
  let captureQueue = Promise.resolve();
  let refreshRequests = 0;
  let presentationMessages = 0;
  const settleCaptures = async () => {
    for (;;) {
      const pending = captureQueue;
      await pending;
      if (pending === captureQueue) return;
    }
  };
  const cancelledText: string[] = [];
  const failNextNative = new Set<string>();
  const iframeId = (id: string) => `couch-fixture-${id}`;
  async function relayout(
    update: Record<string, unknown> = {},
    refreshOverlay = true,
  ) {
    layoutOptions = { ...layoutOptions, ...update };
    if (
      !playing ||
      shell.isClosed() ||
      [...seats.values()].some(({ page }) => actorClosed(page))
    )
      return { layout };
    const viewport = shell.viewportSize();
    if (!viewport) throw new Error("Couch fixture needs an explicit viewport");
    layout = couchLayout(viewport.width, viewport.height, 2, layoutOptions);
    if (options?.embedded) {
      await shell.evaluate(
        ({ layout, hidden }) => {
          ["local-p1", "local-p2"].forEach((id, index) => {
            const frame = document.getElementById(`couch-fixture-${id}`);
            if (!frame) return;
            const bounds = layout.bounds[index];
            Object.assign(frame.style, {
              position: "fixed",
              left: `${bounds.x}px`,
              top: `${bounds.y}px`,
              width: `${bounds.width / layout.zoom}px`,
              height: `${bounds.height / layout.zoom}px`,
              transform: `scale(${layout.zoom})`,
              transformOrigin: "top left",
              border: "0",
              padding: "0",
              margin: "0",
              zIndex: "1000",
              visibility: hidden || !layout.fits ? "hidden" : "visible",
            });
          });
        },
        { layout, hidden: overlayCommitted },
      );
    } else {
      for (const route of seats.values()) {
        if (isPage(route.page))
          await route.page.setViewportSize({
            width: Math.floor(layout.cssWidth),
            height: Math.floor(layout.cssHeight),
          });
      }
    }
    await emit({ kind: "layout", layout });
    if (overlayOwner && refreshOverlay) scheduleCapture();
    return { layout };
  }
  const emit = async (event: unknown) =>
    shell.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent("couchNativeEvent", { detail }));
    }, event);
  const feedDevices = async (frames: Device[]) => {
    if (native) {
      nativeCalls.inputFrame++;
      native.manager.inputFrame(frames);
      await nativeEvents;
    } else await emit({ kind: "devices", devices: frames });
  };
  const syncNativeSeat = async (seatId: string) => {
    const route = seats.get(seatId);
    const seat = native?.manager.seats.get(seatId);
    if (!route || !seat?.port) return;
    if (route.generation !== seat.generation) {
      route.generation = seat.generation;
      const target = new URL(shell.url());
      target.search = `couchSeat=${seatId}&generation=${seat.generation}`;
      await route.page.goto(target.href);
      await expect(route.page.locator("html")).toHaveAttribute(
        "data-couch-seat",
        seatId,
      );
    }
    await emit({ kind: "seat-attached", seatId, generation: seat.generation });
  };
  const overlayStatus = () =>
    overlayOwner
      ? { owner: overlayOwner, version: overlayVersion, captureId }
      : null;
  function scheduleCapture() {
    const owner = overlayOwner;
    if (!owner || !layout) return;
    const version = overlayVersion;
    const id = ++captureId;
    const capturedLayout = structuredClone(layout);
    const viewport = shell.viewportSize()!;
    captureQueue = captureQueue
      .then(async () => {
        if (
          owner !== overlayOwner ||
          version !== overlayVersion ||
          id !== captureId
        )
          return;
        const snapshots = [];
        try {
          for (const [index, [seatId, route]] of [...seats].entries()) {
            let png: Buffer;
            if (isPage(route.page)) png = await route.page.screenshot();
            else {
              // Native capturePage reads a seat document alone, including while
              // its view is hidden during refresh. Temporarily expose that real
              // document and suppress only the outer shell in this capture.
              await shell.locator(`#${iframeId(seatId)}`).evaluate((frame) => {
                (frame as HTMLElement).style.visibility = "visible";
              });
              png = await route.page.locator("html").screenshot({
                animations: "disabled",
                style:
                  'html:not([data-couch-seat]) body > :not(iframe[id^="couch-fixture-"]), html:not([data-couch-seat]) body > :not(iframe[id^="couch-fixture-"]) * { visibility: hidden !important; }',
              });
            }
            snapshots.push({
              seatId,
              generation: route.generation,
              bounds: capturedLayout.bounds[index],
              image: `data:image/png;base64,${png.toString("base64")}`,
            });
          }
        } finally {
          await relayout({}, false);
        }
        if (
          owner !== overlayOwner ||
          version !== overlayVersion ||
          id !== captureId
        )
          return;
        publishedCaptureId = id;
        await emit({
          kind: "overlay-backdrop",
          owner,
          version,
          captureId: id,
          layout: capturedLayout,
          viewport,
          snapshots,
        });
      })
      .catch((error) => {
        if (
          !shell.isClosed() &&
          ![...seats.values()].some(({ page }) => actorClosed(page)) &&
          owner === overlayOwner &&
          version === overlayVersion &&
          id === captureId
        )
          console.error("Couch fixture seat capture failed", error);
      });
  }
  await context.exposeBinding(
    "__couchTestRequest",
    async ({ frame: sourceFrame }, raw: Record<string, unknown>) => {
      if (raw.kind === "seat-post") {
        const route = [...seats].find(
          ([, value]) =>
            (isPage(value.page) ? value.page.mainFrame() : value.page) ===
            sourceFrame,
        );
        if (route)
          await emit({
            kind: "seat-message",
            seatId: route[0],
            generation: route[1].generation,
            message: raw.message,
          });
        return;
      }
      if (sourceFrame !== shell.mainFrame())
        throw new Error("Only the shell owns native session controls");
      if (failNextNative.delete(String(raw.kind)))
        throw new Error(`Fixture ${String(raw.kind)} failure`);
      switch (raw.kind) {
        case "setup":
          if (native) {
            native.manager.setup = true;
            await feedDevices(devices);
            return { ...native.manager.status(), preview: true };
          }
          return { available: true, preview: true, devices };
        case "status":
          if (native) {
            nativeCalls.status++;
            return { ...native.manager.status(), preview: true };
          }
          return {
            available: true,
            preview: true,
            devices,
            active: playing,
            bindings: Object.fromEntries(bindings),
            overlay: overlayStatus(),
          };
        case "setup-confirm":
          confirmOnly = raw.value === true;
          return;
        case "cancel-text":
          cancelledText.push(String(raw.requestId));
          return true;
        case "bind": {
          const seatId = String(raw.seatId);
          const controllerId = String(raw.controllerId);
          bindAttempts.push({ seatId, controllerId });
          if (native) {
            nativeCalls.bind++;
            try {
              const result = native.manager.bind(seatId, controllerId);
              await nativeEvents;
              await syncNativeSeat(seatId);
              return result;
            } catch (failure) {
              nativeErrors.push(String(failure));
              await nativeEvents;
              throw failure;
            }
          }
          const pending = deferredBind;
          deferredBind = undefined;
          if (pending?.commitBeforeReply) bindings.set(seatId, controllerId);
          pending?.requested();
          if (pending && (await pending.outcome) === "reject")
            throw new Error("Fixture bind failure");
          if (!pending?.commitBeforeReply) bindings.set(seatId, controllerId);
          return { seatId, controllerId };
        }
        case "reset-bindings":
          bindings.clear();
          return;
        case "list-saves":
          return {
            kind: "local",
            storage: "local",
            slots: saved
              ? [
                  {
                    id: "saved-local",
                    name: "Local campaign",
                    updatedAt,
                    players: saved.seats.map((seat) => seat.name),
                  },
                ]
              : [],
          };
        case "read-save":
          return saved;
        case "write-save":
          saved = structuredClone(raw.world) as World;
          updatedAt = Date.now();
          return { id: "saved-local", updatedAt };
        case "overlay": {
          const owner = raw.seatId as string | null;
          native?.manager.overlay(owner, raw.shared === true);
          const wasShared = overlayShared;
          const previousOwner = overlayOwner;
          overlayOwner = owner;
          overlayShared = !!owner && raw.shared === true;
          if (overlayShared) {
            if (!wasShared || previousOwner !== owner) {
              sharedInputSeat = owner!;
              const controllerId = bindings.get(owner!);
              if (controllerId)
                await emit({
                  kind: "shell-controller",
                  seatId: owner,
                  controllerId,
                  generation: seats.get(owner!)?.generation,
                });
            }
          } else sharedInputSeat = undefined;
          overlayVersion++;
          if (!owner) overlayCommitted = false;
          await relayout({}, false);
          if (owner) scheduleCapture();
          else {
            captureId++;
            await emit({
              kind: "overlay-backdrop",
              owner: null,
              version: overlayVersion,
              captureId,
              snapshots: [],
            });
          }
          return {
            available: true,
            active: playing,
            layout,
            overlay: overlayStatus(),
          };
        }
        case "overlay-ready":
          if (
            overlayOwner &&
            raw.version === overlayVersion &&
            raw.captureId === captureId &&
            raw.captureId === publishedCaptureId
          ) {
            overlayCommitted = true;
            readyCaptureId = publishedCaptureId;
            await relayout({}, false);
            return true;
          }
          return false;
        case "refresh-overlay":
          refreshRequests++;
          scheduleCapture();
          return {
            available: true,
            active: playing,
            layout,
            overlay: overlayStatus(),
          };
        case "layout":
          native?.manager.relayout(
            (raw.options ?? {}) as Record<string, unknown>,
          );
          return relayout(raw.options as Record<string, unknown>);
        case "send": {
          const route = seats.get(String(raw.seatId));
          if (
            route &&
            route.generation === raw.generation &&
            !actorClosed(route.page)
          ) {
            if ((raw.message as { kind?: string })?.kind === "presentation")
              presentationMessages++;
            await route.page.evaluate(
              (detail) =>
                window.dispatchEvent(
                  new CustomEvent("couchPortMessage", { detail }),
                ),
              raw.message,
            );
          }
          return;
        }
        case "open": {
          if (native) await native.manager.open(raw);
          layoutOptions = { ...raw, ...layoutOptions };
          playing = true;
          await relayout();
          for (const seat of raw.seats as { id: string }[]) {
            let seatPage: Page | Frame;
            if (options?.embedded) {
              await shell.evaluate(
                ({ id, seatId }) => {
                  const frame = document.createElement("iframe");
                  frame.id = id;
                  frame.title = `${seatId} company`;
                  document.body.appendChild(frame);
                },
                { id: iframeId(seat.id), seatId: seat.id },
              );
              const handle = await shell
                .locator(`#${iframeId(seat.id)}`)
                .elementHandle();
              const frame = await handle?.contentFrame();
              if (!frame) throw new Error("Could not create the seat document");
              seatPage = frame;
            } else seatPage = await context.newPage();
            const currentGeneration =
              native?.manager.seats.get(seat.id)?.generation ?? ++generation;
            seats.set(seat.id, {
              page: seatPage,
              generation: currentGeneration,
            });
            await relayout();
            const target = new URL(shell.url());
            target.search = `couchSeat=${seat.id}&generation=${currentGeneration}`;
            await seatPage.goto(target.href);
            await expect(seatPage.locator("html")).toHaveAttribute(
              "data-couch-seat",
              seat.id,
            );
            await emit({
              kind: "seat-attached",
              seatId: seat.id,
              generation: currentGeneration,
            });
          }
          return { available: true, layout };
        }
        case "close":
          native?.manager.close();
          playing = false;
          overlayOwner = null;
          overlayShared = false;
          sharedInputSeat = undefined;
          overlayVersion++;
          captureId++;
          overlayCommitted = false;
          await emit({
            kind: "overlay-backdrop",
            owner: null,
            version: overlayVersion,
            captureId,
            snapshots: [],
          });
          for (const { page: actor } of seats.values()) {
            if (isPage(actor)) await actor.close();
          }
          await shell.evaluate(() => {
            document
              .querySelectorAll('iframe[id^="couch-fixture-"]')
              .forEach((frame) => frame.remove());
          });
          seats.clear();
          bindings.clear();
          return;
        default:
          throw new Error(
            `Unexpected couch fixture request: ${String(raw.kind)}`,
          );
      }
    },
  );
  await context.addInitScript(() => {
    if (!/^https?:$/.test(location.protocol)) return;
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("textSize", "larger");
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 1, date: "2026-01-01", timesPlayed: 1 }],
      }),
    );
    const params = new URLSearchParams(location.search);
    const seatId = params.get("couchSeat");
    const replies: Record<string, number> = {};
    Object.defineProperty(window, "__couchFixtureReplies", { value: replies });
    const native = async (input: Record<string, unknown>) => {
      try {
        return await (
          window as unknown as {
            __couchTestRequest: (
              input: Record<string, unknown>,
            ) => Promise<unknown>;
          }
        ).__couchTestRequest(input);
      } finally {
        // Observe completion after the caller's own await continuation, without timed sleeps.
        queueMicrotask(() =>
          queueMicrotask(() => {
            const kind = String(input.kind);
            replies[kind] = (replies[kind] ?? 0) + 1;
          }),
        );
      }
    };
    const subscribe = <T>(name: string, callback: (value: T) => void) => {
      const listener = (event: Event) =>
        callback((event as CustomEvent<T>).detail);
      window.addEventListener(name, listener);
      return () => window.removeEventListener(name, listener);
    };
    const noop = () => () => {};
    const display = {
      fullscreen: false,
      width: 1920,
      height: 1080,
      resolutions: [{ width: 1920, height: 1080 }],
    };
    const frame = {
      connected: true,
      actions: [],
      glyphs: { confirm: { label: "A" } },
    } as DesktopInputFrame;
    const callbacks = new Set<(message: unknown) => void>();
    const pending: unknown[] = [];
    if (seatId) {
      subscribe("couchPortMessage", (message) => {
        if (!callbacks.size) pending.push(message);
        else callbacks.forEach((callback) => callback(message));
      });
      window.electrifyCouch = {
        role: "seat",
        seatId,
        ready: async () => {},
        getGeneration: () => Number(params.get("generation")),
        post: (message) => {
          void native({ kind: "seat-post", message });
        },
        onMessage: (callback) => {
          callbacks.add(callback);
          pending.splice(0).forEach(callback);
          return () => {
            callbacks.delete(callback);
          };
        },
      };
    }
    window.electrifyDesktop = {
      apiVersion: 1,
      getState: async () => ({
        display,
        steam: {
          available: true,
          online: true,
          steamId: "76561198000000001",
          displayName: "TV host",
          cloudEnabled: false,
        },
      }),
      setDisplay: async () => display,
      quit: async () => {},
      readSaveLibrary: async () => ({
        local: null,
        cloud: null,
        cloudState: "disabled",
      }),
      writeSaveLibrary: async () => ({ cloudState: "disabled" }),
      getLeaderboard: async () => [],
      submitScore: async () => {},
      submitAchievements: async () => {},
      readAchievements: async () => ({
        version: 1,
        earned: [],
        tutorials: [],
        wins: [],
      }),
      openFriends: async () => {},
      multiplayerRequest: async () => ({
        available: true,
        selfId: "76561198000000001",
        members: [],
        connected: [],
      }),
      onMultiplayerEvent: noop,
      setActivity: async () => {},
      addTimelineEvent: async () => {},
      setInputContext: async () => frame,
      onInput: (callback) => subscribe("couchControllerInput", callback),
      showTextInput: async () => ({ status: "cancelled" }),
      onStateChanged: noop,
      onGameFocusChanged: noop,
      onBeforeQuit: noop,
      readyToQuit: () => {},
      ...(seatId
        ? {}
        : {
            couchRequest: native,
            onCouchEvent: (callback: (value: unknown) => void) =>
              subscribe("couchNativeEvent", callback),
          }),
    };
  });
  return {
    seats,
    nativeBindings: () => Object.fromEntries(bindings),
    failNextNativeReload(seatId) {
      const seat = native?.manager.seats.get(seatId);
      if (!seat?.port) throw new Error("Native-backed live seat required");
      const reload = seat.view.webContents.reload;
      seat.view.webContents.reload = () => {
        seat.view.webContents.reload = reload;
        throw new Error("Fixture native reload failure");
      };
    },
    settledNativeRequests: (kind) =>
      shell.evaluate(
        (key) =>
          (
            window as unknown as {
              __couchFixtureReplies: Record<string, number>;
            }
          ).__couchFixtureReplies[key] ?? 0,
        kind,
      ),
    nativeEvidence: () => ({
      topology: Object.fromEntries(
        [...(native?.manager.seats ?? [])].map(([id, seat]) => [
          id,
          { generation: seat.generation, hasPort: !!seat.port },
        ]),
      ),
      errors: [...nativeErrors],
      calls: { ...nativeCalls },
    }),
    bindAttempts: () => bindAttempts,
    async setConnected(connections) {
      for (const [id, connected] of Object.entries(connections)) {
        const existing = devices.find((device) => device.id === id);
        if (existing) existing.connected = connected;
        else
          devices.push({
            ...structuredClone(defaultDevices[0]),
            id,
            connected,
          });
      }
      await feedDevices(devices);
    },
    deferNextBind(commitBeforeReply = false) {
      if (deferredBind) throw new Error("A bind is already deferred");
      let requested!: () => void;
      let settle!: (outcome: "resolve" | "reject") => void;
      const pending = new Promise<void>((resolve) => {
        requested = resolve;
      });
      const outcome = new Promise<"resolve" | "reject">((resolve) => {
        settle = resolve;
      });
      deferredBind = { commitBeforeReply, requested, outcome };
      return { requested: pending, settle };
    },
    checkpoint: () => saved,
    layout: () => layout,
    backdropRevision: () => readyCaptureId,
    refreshRequests: () => refreshRequests,
    presentationMessages: () => presentationMessages,
    settleCaptures,
    cancelledText: () => cancelledText,
    failNextNative: (kind) => {
      failNextNative.add(kind);
    },
    async input(actions: Record<string, DesktopInputAction[]>) {
      // Native capturePage never changes the shell's DOM. Embedded capture
      // temporarily suppresses only that outer DOM, so finish its capture work
      // before resolving semantic keyboard scope or focus for a controller frame.
      await settleCaptures();
      // Main selects routes before asynchronous renderer handlers bind a joining device.
      const sampledBindings = new Map(bindings);
      const sampledPlaying = playing;
      const sampledOverlay = overlayOwner;
      const sampledShared = overlayShared;
      const sampledConfirmOnly = confirmOnly;
      const frames = devices.map((device) => ({
        ...device,
        actions: actions[device.id] ?? [],
      }));
      await feedDevices(frames);
      if (!sampledPlaying || sampledOverlay) {
        const selected = sampledShared
          ? sharedMenuFrame(
              sampledBindings.keys(),
              sampledBindings,
              frames,
              sharedInputSeat ?? sampledOverlay ?? undefined,
            )
          : undefined;
        const device = sampledBindings.get(sampledOverlay || "local-p1");
        const frame = sampledShared
          ? selected?.frame
          : frames.find((item) => item.id === device);
        if (selected && selected.seatId !== sharedInputSeat) {
          sharedInputSeat = selected.seatId;
          await emit({
            kind: "shell-controller",
            seatId: selected.seatId,
            controllerId: selected.frame.id,
            generation: seats.get(selected.seatId)?.generation,
          });
        }
        if (frame)
          await shell.evaluate(
            (detail) =>
              window.dispatchEvent(
                new CustomEvent("couchControllerInput", { detail }),
              ),
            {
              ...frame,
              actions: sampledConfirmOnly
                ? frame.actions.filter((action) => action !== "confirm")
                : frame.actions,
            },
          );
      } else {
        await Promise.all(
          [...seats].map(async ([id, route]) => {
            const frame = frames.find(
              (item) => item.id === sampledBindings.get(id),
            );
            if (frame)
              await route.page.evaluate(
                (detail) =>
                  window.dispatchEvent(
                    new CustomEvent("couchControllerInput", { detail }),
                  ),
                frame,
              );
          }),
        );
      }
    },
  };
}
