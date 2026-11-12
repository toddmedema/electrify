jest.mock("./AppVersion", () => ({ APP_VERSION: "26sept26-1507" }));

beforeEach(() => jest.resetModules());
afterEach(() => {
  delete window.electrifyAnalytics;
  delete window.electrifyAnalyticsQueue;
});

describe("logEvent", () => {
  it("preserves custom event names, parameters and order with the shipped app version", () => {
    const report = jest.fn();
    window.electrifyAnalytics = { initialize: jest.fn(), logEvent: report };
    const { logEvent } = require("./Globals") as typeof import("./Globals");
    logEvent("scenario_start", { scenario: 108, difficulty: "normal" });
    logEvent("card_view", { card: "MANUAL", app_version: "caller-version" });
    expect(report.mock.calls).toEqual([
      [
        "scenario_start",
        { scenario: 108, difficulty: "normal", app_version: "26sept26-1507" },
      ],
      ["card_view", { card: "MANUAL", app_version: "26sept26-1507" }],
    ]);
    expect(window.electrifyAnalytics.initialize).not.toHaveBeenCalled();
  });

  it("keeps the game usable when the shared local runtime is unavailable", () => {
    const { logEvent } = require("./Globals") as typeof import("./Globals");
    expect(() => logEvent("card_view")).not.toThrow();
    expect(
      document.querySelector('script[src*="googletagmanager"]'),
    ).toBeNull();
  });

  it("buffers early events in order with the app version until the runtime arrives", () => {
    const { logEvent } = require("./Globals") as typeof import("./Globals");
    logEvent("scenario_start", { id: 107 });
    logEvent("card_view", { card: "MANUAL", app_version: "caller-version" });
    expect(window.electrifyAnalyticsQueue).toEqual([
      {
        name: "scenario_start",
        params: { id: 107, app_version: "26sept26-1507" },
      },
      {
        name: "card_view",
        params: { card: "MANUAL", app_version: "26sept26-1507" },
      },
    ]);
  });

  it("bounds the queue when the local runtime stays unavailable", () => {
    const { logEvent } = require("./Globals") as typeof import("./Globals");
    for (let i = 0; i < 1000; i++) logEvent("card_view", { i });
    expect(window.electrifyAnalyticsQueue).toHaveLength(100);
    expect(window.electrifyAnalyticsQueue?.at(-1)).toEqual({
      name: "card_view",
      params: { i: 99, app_version: "26sept26-1507" },
    });
  });

  it("swallows an optional analytics bridge failure", () => {
    window.electrifyAnalytics = {
      initialize: jest.fn(),
      logEvent: () => {
        throw new Error("blocked");
      },
    };
    const { logEvent } = require("./Globals") as typeof import("./Globals");
    expect(() => logEvent("card_view")).not.toThrow();
  });
});

describe("viewport breakpoints", () => {
  it("ignores overflowing content while resizing across the desktop breakpoint", () => {
    const originalWidth = window.innerWidth;
    const bodyWidth = jest
      .spyOn(document.body, "scrollWidth", "get")
      .mockReturnValue(1400);
    const documentWidth = jest
      .spyOn(document.documentElement, "scrollWidth", "get")
      .mockReturnValue(1400);
    const { isDesktopScreen } =
      require("./Globals") as typeof import("./Globals");
    try {
      for (const [width, desktop] of [
        [1300, true],
        [1299, false],
        [1300, true],
        [1299, false],
      ] as const) {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: width,
        });
        window.dispatchEvent(new Event("resize"));
        expect(isDesktopScreen()).toBe(desktop);
      }
    } finally {
      bodyWidth.mockRestore();
      documentWidth.mockRestore();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      window.dispatchEvent(new Event("resize"));
    }
  });
});
