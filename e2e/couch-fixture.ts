import { BrowserContext, Page, expect } from "@playwright/test";
import type { DesktopInputAction, DesktopInputFrame } from "../src/Desktop";
import type { World } from "../src/multiplayer/Types";

type Device = DesktopInputFrame & { id: string };
const devices: Device[] = ["101", "202"].map((id) => ({
  id,
  connected: true,
  actions: [],
  glyphs: {
    confirm: { label: id === "101" ? "A" : "Cross" },
    build: { label: "X" },
  },
}));

/** Replace native transport only. Shell coordinator, simulation worker, seat clients,
 * Redux stores, controls and data loading are the production implementations. */
export async function createCouchFixture(context: BrowserContext, shell: Page) {
  const seats = new Map<string, { page: Page; generation: number }>();
  const bindings = new Map<string, string>();
  let saved: World | undefined;
  let updatedAt = 0;
  let overlayOwner: string | null = null;
  let playing = false;
  let confirmOnly = false;
  let generation = 0;
  const emit = async (event: unknown) =>
    shell.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent("couchNativeEvent", { detail }));
    }, event);
  await context.exposeBinding(
    "__couchTestRequest",
    async ({ page }, raw: Record<string, unknown>) => {
      if (raw.kind === "seat-post") {
        const route = [...seats].find(([, value]) => value.page === page);
        if (route)
          await emit({
            kind: "seat-message",
            seatId: route[0],
            generation: route[1].generation,
            message: raw.message,
          });
        return;
      }
      if (page !== shell)
        throw new Error("Only the shell owns native session controls");
      switch (raw.kind) {
        case "setup":
          return { available: true, preview: true, devices };
        case "status":
          return { available: true, preview: true, devices, active: playing };
        case "setup-confirm":
          confirmOnly = raw.value === true;
          return;
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
        case "overlay":
          overlayOwner = raw.seatId as string | null;
          return;
        case "layout":
          return { layout: { fits: true } };
        case "send": {
          const route = seats.get(String(raw.seatId));
          if (
            route &&
            route.generation === raw.generation &&
            !route.page.isClosed()
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
          playing = true;
          for (const seat of raw.seats as { id: string }[]) {
            const seatPage = await context.newPage();
            const currentGeneration = ++generation;
            seats.set(seat.id, {
              page: seatPage,
              generation: currentGeneration,
            });
            await seatPage.setViewportSize({ width: 620, height: 640 });
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
          return { available: true, layout: { fits: true } };
        }
        case "close":
          playing = false;
          overlayOwner = null;
          await Promise.all(
            [...seats.values()].map(({ page: seatPage }) => seatPage.close()),
          );
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
    async input(actions: Record<string, DesktopInputAction[]>) {
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
