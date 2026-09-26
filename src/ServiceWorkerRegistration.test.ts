import {
  BACKGROUND_CACHE_DELAY_MS,
  registerServiceWorker,
} from "./ServiceWorkerRegistration";

type Listener = () => void;

function fakeWindow({
  installed = false,
  registration = Promise.resolve({}),
}: { installed?: boolean; registration?: Promise<unknown> } = {}) {
  const postMessage = jest.fn();
  const register = jest.fn(() => registration);
  const serviceWorker = {
    register,
    ready: Promise.resolve({ active: { postMessage } }),
  };
  const listeners = new Map<string, Listener[]>();
  const win = {
    navigator: { serviceWorker },
    matchMedia: jest.fn(() => ({ matches: installed })),
    setTimeout: (callback: () => void, ms: number) =>
      window.setTimeout(callback, ms),
    addEventListener: (name: string, listener: Listener) =>
      listeners.set(name, [...(listeners.get(name) ?? []), listener]),
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
    expect(messageTypes(sw.postMessage)).toEqual(["CACHE_ICONS"]);
  });

  it("also syncs every weather location for an installed app", async () => {
    const sw = fakeWindow({ installed: true });
    restore = sw.restore;

    registerServiceWorker(sw.win);
    await flush();
    jest.advanceTimersByTime(BACKGROUND_CACHE_DELAY_MS);
    await flush();

    expect(messageTypes(sw.postMessage).sort()).toEqual([
      "CACHE_ICONS",
      "SYNC_OFFLINE_DATA",
    ]);
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
      "CACHE_ICONS",
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
