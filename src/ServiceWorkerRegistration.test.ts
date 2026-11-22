import {
  BACKGROUND_CACHE_DELAY_MS,
  registerServiceWorker,
} from "./ServiceWorkerRegistration";

type Listener = () => void;

function fakeWindow({
  installed = false,
  registration,
}: { installed?: boolean; registration?: Promise<unknown> } = {}) {
  const postMessage = jest.fn();
  const registrationListeners = new Map<string, Listener>();
  const workers = {
    active: { postMessage },
    waiting: null as { postMessage: jest.Mock } | null,
    installing: null as { postMessage: jest.Mock } | null,
    addEventListener: (name: string, listener: Listener) =>
      registrationListeners.set(name, listener),
  };
  const register = jest.fn(() => registration ?? Promise.resolve(workers));
  const serviceWorker = { register, ready: Promise.resolve(workers) };
  const listeners = new Map<string, Listener[]>();
  const win = {
    navigator: { serviceWorker },
    matchMedia: jest.fn(() => ({ matches: installed })),
    setTimeout: (callback: () => void, ms: number) =>
      window.setTimeout(callback, ms),
    addEventListener: (name: string, listener: Listener) =>
      listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    removeEventListener: (name: string, listener: Listener) =>
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((l) => l !== listener),
      ),
  };
  const originalServiceWorker = navigator.serviceWorker;
  // prefetchIcons() talks to the global navigator, so point it at the same fake worker.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });
  return {
    win: win as unknown as Window,
    register,
    postMessage,
    workers,
    fireRegistration: (name: string) => registrationListeners.get(name)?.(),
    fire: (name: string) => listeners.get(name)?.forEach((l) => l()),
    restore: () =>
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: originalServiceWorker,
      }),
  };
}

/** Let resolved registration and `ready` promises run their callbacks. */
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function messageTypes(postMessage: jest.Mock) {
  return postMessage.mock.calls.map(([message]) => message.type);
}

describe("registerServiceWorker", () => {
  let restore: () => void = () => undefined;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    restore();
    jest.restoreAllMocks();
  });

  it("caches icons in the background for a browser tab, but not every weather location", async () => {
    const sw = fakeWindow();
    restore = sw.restore;

    registerServiceWorker(sw.win);
    await flush();
    expect(sw.register).toHaveBeenCalledWith("/service-worker.js");
    // Nothing competes with the first screen.
    expect(sw.postMessage).not.toHaveBeenCalled();

    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    await flush();
    expect(messageTypes(sw.postMessage)).toEqual([
      "CACHE_BUILD",
      "CACHE_ICONS",
    ]);
  });

  it("registers and installs background listeners once across title-to-game handoff", async () => {
    const sw = fakeWindow();
    restore = sw.restore;
    registerServiceWorker(sw.win);
    registerServiceWorker(sw.win);
    await flush();
    registerServiceWorker(sw.win);
    expect(sw.register).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    await flush();
    expect(messageTypes(sw.postMessage)).toEqual([
      "CACHE_BUILD",
      "CACHE_ICONS",
    ]);
    sw.postMessage.mockClear();
    sw.fire("online");
    await flush();
    expect(messageTypes(sw.postMessage)).toEqual([
      "CACHE_BUILD",
      "CACHE_ICONS",
    ]);
  });

  it("allows a later entry to retry a failed registration without duplicate listeners", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const sw = fakeWindow();
    restore = sw.restore;
    sw.register.mockRejectedValueOnce(new Error("denied"));
    registerServiceWorker(sw.win);
    await flush();
    registerServiceWorker(sw.win);
    await flush();
    expect(sw.register).toHaveBeenCalledTimes(2);
    sw.fire("appinstalled");
    await flush();
    expect(messageTypes(sw.postMessage)).toEqual([
      "CACHE_BUILD",
      "CACHE_ICONS",
      "SYNC_OFFICIAL_OFFLINE_DATA",
    ]);
  });

  it("sends the installed app the shipped hashes for official scenario weather", async () => {
    const sw = fakeWindow({ installed: true });
    restore = sw.restore;

    registerServiceWorker(sw.win);
    await flush();
    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    await flush();

    expect(messageTypes(sw.postMessage).sort()).toEqual([
      "CACHE_BUILD",
      "CACHE_ICONS",
      "SYNC_OFFICIAL_OFFLINE_DATA",
    ]);
    const { weather } = sw.postMessage.mock.calls.find(
      ([message]) => message.type === "SYNC_OFFICIAL_OFFLINE_DATA",
    )![0];
    expect(weather).toEqual(
      expect.arrayContaining([
        { id: "PIT", integrity: expect.stringMatching(/^sha256-/) },
        { id: "AlleghenyUpper", integrity: expect.stringMatching(/^sha256-/) },
        { id: "BurlingtonVT", integrity: expect.stringMatching(/^sha256-/) },
        { id: "Kyiv", integrity: expect.stringMatching(/^sha256-/) },
      ]),
    );
    expect(weather).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "Tokyo" })]),
    );
  });

  it("warms waiting and newly installing workers during an update", async () => {
    const sw = fakeWindow({ installed: true });
    restore = sw.restore;
    const waiting = { postMessage: jest.fn() };
    const installing = { postMessage: jest.fn() };
    sw.workers.waiting = waiting;
    registerServiceWorker(sw.win);
    await flush();
    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    await flush();

    expect(messageTypes(sw.postMessage)).toEqual([
      "CACHE_BUILD",
      "CACHE_ICONS",
    ]);
    expect(messageTypes(waiting.postMessage)).toEqual([
      "SYNC_OFFICIAL_OFFLINE_DATA",
    ]);

    sw.workers.installing = installing;
    sw.fireRegistration("updatefound");
    await flush();
    expect(messageTypes(installing.postMessage)).toEqual([
      "SYNC_OFFICIAL_OFFLINE_DATA",
    ]);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it("caches audio and data immediately when this session installs, and retries on reconnection", async () => {
    const sw = fakeWindow();
    restore = sw.restore;
    registerServiceWorker(sw.win);
    await flush();
    sw.fire("appinstalled");
    await flush();
    expect(messageTypes(sw.postMessage)).toContain(
      "SYNC_OFFICIAL_OFFLINE_DATA",
    );
    sw.postMessage.mockClear();
    sw.fire("online");
    await flush();
    expect(messageTypes(sw.postMessage)).toContain(
      "SYNC_OFFICIAL_OFFLINE_DATA",
    );
  });

  it("re-requests icons when connectivity returns", async () => {
    const sw = fakeWindow();
    restore = sw.restore;

    registerServiceWorker(sw.win);
    await flush();
    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    await flush();
    sw.fire("online");
    await flush();

    expect(messageTypes(sw.postMessage)).toEqual([
      "CACHE_BUILD",
      "CACHE_ICONS",
      "CACHE_BUILD",
      "CACHE_ICONS",
    ]);
  });

  it("ignores connectivity changes before the worker is registered", async () => {
    const sw = fakeWindow({ registration: new Promise(() => undefined) });
    restore = sw.restore;

    registerServiceWorker(sw.win);
    sw.fire("online");
    await flush();
    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    await flush();

    expect(sw.postMessage).not.toHaveBeenCalled();
  });

  it("warns and never asks for background caching when registration fails", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const sw = fakeWindow({
      registration: Promise.reject(new Error("denied")),
    });
    restore = sw.restore;

    registerServiceWorker(sw.win);
    await flush();
    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    sw.fire("online");
    await flush();

    expect(warn).toHaveBeenCalledWith(
      "Couldn't enable offline play:",
      expect.any(Error),
    );
    expect(sw.postMessage).not.toHaveBeenCalled();
  });
});
