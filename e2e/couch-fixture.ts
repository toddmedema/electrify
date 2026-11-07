import { BrowserContext, Frame, Page, expect } from "@playwright/test";
import type { DesktopInputAction, DesktopInputFrame } from "../src/Desktop";
import type { World } from "../src/multiplayer/Types";

type Device = DesktopInputFrame & { id: string };
const devices: Device[] = ["101", "202"].map((id) => ({
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
  checkpoint: () => World | undefined;
  layout: () => CouchLayout | undefined;
  backdropRevision: () => number;
  cancelledText: () => readonly string[];
  input: (actions: Record<string, DesktopInputAction[]>) => Promise<void>;
}
const {
  couchLayout,
}: {
  couchLayout: (
    width: number,
    height: number,
    count: number,
    options: Record<string, unknown>,
  ) => CouchLayout;
} = require("../electron/couch.cjs");
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
/** Replace native transport only. Shell coordinator, simulation worker, seat clients,
 * Redux stores, controls and data loading are the production implementations. Embedded
 * mode paints those same documents at the native bounds for full-window layout review;
 * it does not establish native focus/process isolation. */
export async function createCouchFixture(
  context: BrowserContext,
  shell: Page,
  options?: { embedded: true },
): Promise<CouchFixture<Page | Frame>> {
  const seats = new Map<string, { page: Page | Frame; generation: number }>();
  const bindings = new Map<string, string>();
  let saved: World | undefined;
  let updatedAt = 0;
  let overlayOwner: string | null = null;
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
  const cancelledText: string[] = [];
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
      switch (raw.kind) {
        case "setup":
          return { available: true, preview: true, devices };
        case "status":
          return {
            available: true,
            preview: true,
            devices,
            active: playing,
            overlay: overlayStatus(),
          };
        case "setup-confirm":
          confirmOnly = raw.value === true;
          return;
        case "cancel-text":
          cancelledText.push(String(raw.requestId));
          return true;
        case "bind":
          bindings.set(String(raw.seatId), String(raw.controllerId));
          return;
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
          if (owner !== overlayOwner) {
            overlayOwner = owner;
            overlayVersion++;
            overlayCommitted = false;
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
          scheduleCapture();
          return {
            available: true,
            active: playing,
            layout,
            overlay: overlayStatus(),
          };
        case "layout":
          return relayout(raw.options as Record<string, unknown>);
        case "send": {
          const route = seats.get(String(raw.seatId));
          if (
            route &&
            route.generation === raw.generation &&
            !actorClosed(route.page)
          )
            await route.page.evaluate(
              (detail) =>
                window.dispatchEvent(
                  new CustomEvent("couchPortMessage", { detail }),
                ),
              raw.message,
            );
          return;
        }
        case "open": {
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
            const currentGeneration = ++generation;
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
          playing = false;
          overlayOwner = null;
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
    const native = (input: Record<string, unknown>) =>
      (
        window as unknown as {
          __couchTestRequest: (
            input: Record<string, unknown>,
          ) => Promise<unknown>;
        }
      ).__couchTestRequest(input);
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
    checkpoint: () => saved,
    layout: () => layout,
    backdropRevision: () => readyCaptureId,
    cancelledText: () => cancelledText,
    async input(actions: Record<string, DesktopInputAction[]>) {
      // Native capturePage never changes the shell's DOM. Embedded capture
      // temporarily suppresses only that outer DOM, so finish its capture work
      // before resolving semantic keyboard scope or focus for a controller frame.
      for (;;) {
        const pending = captureQueue;
        await pending;
        if (pending === captureQueue) break;
      }
      // Main selects routes before asynchronous renderer handlers bind a joining device.
      const sampledBindings = new Map(bindings);
      const sampledPlaying = playing;
      const sampledOverlay = overlayOwner;
      const sampledConfirmOnly = confirmOnly;
      const frames = devices.map((device) => ({
        ...device,
        actions: actions[device.id] ?? [],
      }));
      await emit({ kind: "devices", devices: frames });
      if (!sampledPlaying || sampledOverlay) {
        const device = sampledBindings.get(sampledOverlay || "local-p1");
        const frame = frames.find((item) => item.id === device);
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
