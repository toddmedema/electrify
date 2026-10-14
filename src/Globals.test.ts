// setupTests stubs firebase/analytics so no real transport runs under jsdom; this suite replaces
// the stub with spies so it can assert whether initialization is attempted. jest.mock's factory
// is hoisted above every declaration in the file, so the spies it closes over have to be named
// mock* -- the only identifiers Jest allows out of that scope.
const mockGetAnalytics = jest.fn();
const mockFirebaseLogEvent = jest.fn();
const mockLoadAnalytics = jest.fn();

jest.mock("firebase/analytics", () => {
  mockLoadAnalytics();
  return {
    getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
    logEvent: (...args: unknown[]) => mockFirebaseLogEvent(...args),
  };
});

// jsdom serves onLine from a getter on Navigator.prototype, so shadow it with an own property for
// each test and drop that property afterwards to uncover the original getter again.
const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "onLine",
);

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

// Globals keeps the Analytics instance for the life of the module, so each test loads its own
// copy of it to start from "not initialized yet".
function loadLogEvent(): typeof import("./Globals").logEvent {
  let logEvent!: typeof import("./Globals").logEvent;
  jest.isolateModules(() => {
    logEvent = (require("./Globals") as typeof import("./Globals")).logEvent;
  });
  return logEvent;
}

async function flushAnalytics() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => jest.resetModules());

afterEach(() => {
  if (originalOnLineDescriptor) {
    Object.defineProperty(window.navigator, "onLine", originalOnLineDescriptor);
  } else {
    delete (window.navigator as unknown as { onLine?: boolean }).onLine;
  }
  // react-scripts sets resetMocks, so call counts and implementations are already cleared here.
});

describe("logEvent", () => {
  it("skips loading and initializing analytics while the page is offline", async () => {
    setOnline(false);
    const logEvent = loadLogEvent();

    // Initializing while offline fails inside the Firebase SDK with an unhandled rejection
    // (installations/app-offline) that the dev build renders as a full error overlay, so
    // navigating -- the manual, any card -- must not reach getAnalytics() at all.
    logEvent("card_view", { card: "MANUAL" });
    await flushAnalytics();

    expect(mockLoadAnalytics).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    expect(mockFirebaseLogEvent).not.toHaveBeenCalled();
  });

  it("loads analytics on demand and reports the event when the page is online", async () => {
    setOnline(true);
    const analytics = {};
    mockGetAnalytics.mockReturnValue(analytics);
    const logEvent = loadLogEvent();
    expect(mockLoadAnalytics).not.toHaveBeenCalled();

    logEvent("card_view", { card: "MANUAL" });
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    await flushAnalytics();

    expect(mockLoadAnalytics).toHaveBeenCalledTimes(1);
    expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    expect(mockFirebaseLogEvent).toHaveBeenCalledWith(analytics, "card_view", {
      card: "MANUAL",
    });
  });

  it("shares one load and initializes once, preserving the order of pending events", async () => {
    setOnline(true);
    mockGetAnalytics.mockReturnValue({});
    const logEvent = loadLogEvent();

    logEvent("scenario_start", {});
    logEvent("card_view", { card: "MANUAL" });
    await flushAnalytics();

    expect(mockLoadAnalytics).toHaveBeenCalledTimes(1);
    expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    expect(mockFirebaseLogEvent).toHaveBeenCalledTimes(2);
    expect(mockFirebaseLogEvent.mock.calls.map((call) => call[1])).toEqual([
      "scenario_start",
      "card_view",
    ]);
  });

  it("keeps reporting through a dropout once analytics is up", async () => {
    setOnline(true);
    mockGetAnalytics.mockReturnValue({});
    const logEvent = loadLogEvent();
    logEvent("scenario_start", {});
    await flushAnalytics();

    // Only the initialization needs the network; a player who started online stays measured
    // rather than going silent for the rest of the session.
    setOnline(false);
    logEvent("card_view", { card: "MANUAL" });
    await flushAnalytics();

    expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    expect(mockFirebaseLogEvent).toHaveBeenCalledTimes(2);
  });

  it("initializes on the first event after the browser comes back online", async () => {
    setOnline(false);
    mockGetAnalytics.mockReturnValue({});
    const logEvent = loadLogEvent();
    logEvent("card_view", { card: "MANUAL" });
    await flushAnalytics();

    setOnline(true);
    logEvent("card_view", { card: "MANUAL" });
    await flushAnalytics();

    expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    expect(mockFirebaseLogEvent).toHaveBeenCalledTimes(1);
  });

  it("does not initialize if connectivity drops while the chunk is loading", async () => {
    setOnline(true);
    const logEvent = loadLogEvent();
    logEvent("scenario_start", {});
    setOnline(false);
    await flushAnalytics();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    expect(mockFirebaseLogEvent).not.toHaveBeenCalled();
    setOnline(true);
    mockGetAnalytics.mockReturnValue({});
    logEvent("card_view", { card: "MANUAL" });
    await flushAnalytics();
    expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    expect(mockFirebaseLogEvent).toHaveBeenCalledTimes(1);
  });

  it("swallows an SDK initialization failure and retries on the next event", async () => {
    setOnline(true);
    mockGetAnalytics.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const logEvent = loadLogEvent();

    expect(() => logEvent("card_view", { card: "MANUAL" })).not.toThrow();
    await flushAnalytics();
    expect(mockFirebaseLogEvent).not.toHaveBeenCalled();
    mockGetAnalytics.mockReturnValue({});
    logEvent("scenario_start", {});
    await flushAnalytics();
    expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    expect(mockFirebaseLogEvent).toHaveBeenCalledTimes(1);
  });

  it("catches a chunk-load rejection and retries on the next event", async () => {
    setOnline(true);
    mockLoadAnalytics.mockImplementationOnce(() => {
      throw new Error("chunk unavailable");
    });
    const logEvent = loadLogEvent();
    logEvent("card_view", { card: "MANUAL" });
    await flushAnalytics();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    mockGetAnalytics.mockReturnValue({});
    logEvent("scenario_start", {});
    await flushAnalytics();
    expect(mockLoadAnalytics).toHaveBeenCalledTimes(2);
    expect(mockFirebaseLogEvent).toHaveBeenCalledTimes(1);
  });
});
