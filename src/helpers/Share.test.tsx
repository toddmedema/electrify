import { buildShareText, canShare, shareText } from "./Share";

interface Shareable {
  share?: (data: { text: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

const nav = navigator as Navigator & Shareable;
const original = { share: nav.share, clipboard: nav.clipboard };

function setNavigator(overrides: Shareable) {
  Object.defineProperty(nav, "share", {
    value: overrides.share,
    configurable: true,
  });
  Object.defineProperty(nav, "clipboard", {
    value: overrides.clipboard,
    configurable: true,
  });
}

afterEach(() => setNavigator(original));

describe("buildShareText", () => {
  it("reads as something a person would post", () => {
    expect(
      buildShareText({
        score: 1812,
        scenarioName: "Deregulation",
        difficulty: "CEO",
      }),
    ).toBe(
      "I scored 1,812 running Deregulation at CEO difficulty on Electrify - electrifygame.com",
    );
  });
});

describe("canShare", () => {
  it("keeps a share affordance for the legacy copy fallback", () => {
    setNavigator({});
    expect(canShare()).toBe(true);
  });

  it("is true with only a clipboard", () => {
    setNavigator({ clipboard: { writeText: async () => undefined } });
    expect(canShare()).toBe(true);
  });
});

describe("shareText", () => {
  it("uses the platform share sheet when there is one", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    setNavigator({ share });
    expect(await shareText("hello")).toBe("share");
    expect(share).toHaveBeenCalledWith({ text: "hello" });
  });

  /**
   * Closing the share sheet rejects with an AbortError. That is a decision, not a failure: the
   * player must not see an error, and the text must not be quietly copied to their clipboard
   * instead of being sent where they chose not to send it.
   */
  it("reports a dismissed share sheet as a cancellation, without touching the clipboard", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({
      share: jest.fn().mockRejectedValue(new Error("AbortError")),
      clipboard: { writeText },
    });
    expect(await shareText("hello")).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when there is no share sheet", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });
    expect(await shareText("hello")).toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("gives up when the clipboard is refused", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setNavigator({
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error("nope")) },
    });
    expect(await shareText("hello")).toBe("unavailable");
    warn.mockRestore();
  });

  it("gives up when the browser offers nothing", async () => {
    setNavigator({});
    expect(await shareText("hello")).toBe("unavailable");
  });
});
