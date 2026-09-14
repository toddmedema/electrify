import { getAnalytics } from "firebase/analytics";
import { logEvent } from "./Globals";

// setupTests stubs firebase/analytics so no real transport runs under jsdom; this suite
// replaces the stub with spies so it can assert whether initialization is attempted.
jest.mock("firebase/analytics", () => ({
  getAnalytics: jest.fn(() => ({})),
  logEvent: jest.fn(() => undefined),
}));

const getAnalyticsSpy = getAnalytics as jest.Mock;

// jsdom reports onLine as true through a getter, so shadow it with an own property for
// each test and restore whatever was there afterwards (own property or prototype getter).
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

afterEach(() => {
  if (originalOnLineDescriptor) {
    Object.defineProperty(window.navigator, "onLine", originalOnLineDescriptor);
  } else {
    delete (window.navigator as unknown as { onLine?: boolean }).onLine;
  }
  jest.clearAllMocks();
  getAnalyticsSpy.mockImplementation(() => ({}));
});

describe("logEvent", () => {
  it("skips analytics initialization while the page is offline", () => {
    setOnline(false);
    // The offline registration fails inside the Firebase SDK with an unhandled
    // rejection (installations/app-offline), which the dev build renders as a full
    // error overlay; navigating (the manual, any card) must not trigger it.
    expect(() => logEvent("card_view", { card: "MANUAL" })).not.toThrow();
    expect(getAnalyticsSpy).not.toHaveBeenCalled();
  });

  it("initializes analytics when the page is online", () => {
    setOnline(true);
    logEvent("card_view", { card: "MANUAL" });
    expect(getAnalyticsSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows a failure from the analytics SDK so it cannot break the game", () => {
    setOnline(true);
    getAnalyticsSpy.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => logEvent("card_view", { card: "MANUAL" })).not.toThrow();
  });
});
