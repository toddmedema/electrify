import type { DesktopBridge } from "../Desktop";
import { seatPresentation } from "../couch/Presentation";

jest.mock("../Globals", () => ({
  getLocalStorage: () => globalThis.localStorage,
}));
jest.mock("../data/Audio", () => ({ pause: jest.fn(), resume: jest.fn() }));

function settings() {
  let result!: typeof import("./Settings");
  jest.isolateModules(() => {
    result = require("./Settings");
  });
  return result;
}
beforeEach(() => {
  localStorage.clear();
  delete window.electrifyDesktop;
});
afterEach(() => {
  localStorage.clear();
  delete window.electrifyDesktop;
  jest.restoreAllMocks();
  delete (navigator as Navigator & { standalone?: boolean }).standalone;
});

it("preserves the browser's first-run sound permission and omits desktop defaults", () => {
  const { initialSettings } = settings();
  expect(initialSettings.audioEnabled).toBeUndefined();
  expect(initialSettings.controllerVibrationEnabled).toBeUndefined();
  expect(initialSettings.steamTimelineEnabled).toBeUndefined();
});

it("defaults Electron sound on and independent vibration/highlights off", () => {
  window.electrifyDesktop = { apiVersion: 1 } as DesktopBridge;
  const { initialSettings } = settings();
  expect(initialSettings.audioEnabled).toBe(true);
  expect(initialSettings.controllerVibrationEnabled).toBe(false);
  expect(initialSettings.steamTimelineEnabled).toBe(false);
});

it("keeps an explicit desktop mute and zero effects volume across relaunch", () => {
  window.electrifyDesktop = { apiVersion: 1 } as DesktopBridge;
  localStorage.setItem("audioEnabled", "false");
  localStorage.setItem("soundEffectsVolume", "0");
  const { initialSettings } = settings();
  expect(initialSettings.audioEnabled).toBe(false);
  expect(initialSettings.soundEffectsVolume).toBe(0);
});

it("persists optional desktop preferences independently of the sound switch", () => {
  window.electrifyDesktop = { apiVersion: 1 } as DesktopBridge;
  const { default: reducer, initialSettings, change } = settings();
  const updated = reducer(
    initialSettings,
    change({
      audioEnabled: false,
      controllerVibrationEnabled: true,
      steamTimelineEnabled: true,
    }),
  );
  expect(updated.audioEnabled).toBe(false);
  expect(updated.controllerVibrationEnabled).toBe(true);
  expect(updated.steamTimelineEnabled).toBe(true);
  const restored = settings().initialSettings;
  expect(restored).toMatchObject({
    audioEnabled: false,
    controllerVibrationEnabled: true,
    steamTimelineEnabled: true,
  });
});

it.each([
  ["standard", undefined, "2", 1],
  ["large", "false", "1.75", 1.125],
  ["large", "true", "1.75", 1.96875],
  ["larger", "true", "2", 2.5],
  ["invalid", "true", "invalid", 1.5],
])(
  "migrates old preferences once: %p, %p, %p",
  (text, mode, scale, expected) => {
    localStorage.setItem("textSize", String(text));
    if (mode !== undefined) localStorage.setItem("tvMode", String(mode));
    localStorage.setItem("tvScale", String(scale));
    expect(settings().initialSettings.interfaceScale).toBe(expected);
    expect(localStorage.getItem("interfaceScale")).toBe(String(expected));
    localStorage.setItem("tvMode", "false");
    localStorage.setItem("textSize", "standard");
    expect(settings().initialSettings.interfaceScale).toBe(expected);
  },
);

it("migrates a legacy couch setup into independent preferences without runtime TV flags", () => {
  localStorage.setItem("textSize", "large");
  localStorage.setItem("tvMode", "true");
  localStorage.setItem("tvScale", "1.75");
  localStorage.setItem("tvInset", "4");
  const { initialSettings } = settings();
  expect(initialSettings).toMatchObject({
    interfaceScale: 1.96875,
    workspace: "single",
    screenEdgePadding: 4,
  });
  expect(initialSettings).not.toHaveProperty("tvMode");
  expect(initialSettings).not.toHaveProperty("tvScale");
});

it("restores explicit scale independently of old preferences and persists changes", () => {
  localStorage.setItem("interfaceScale", "1.75");
  localStorage.setItem("textSize", "larger");
  localStorage.setItem("tvMode", "true");
  const { default: reducer, initialSettings, change } = settings();
  expect(initialSettings.interfaceScale).toBe(1.75);
  const large = reducer(initialSettings, change({ interfaceScale: 2.25 }));
  expect(large.interfaceScale).toBe(2.25);
  expect(settings().initialSettings.interfaceScale).toBe(2.25);
  const invalid = reducer(
    large,
    change({ interfaceScale: "300%" } as unknown as Parameters<
      typeof change
    >[0]),
  );
  expect(invalid.interfaceScale).toBe(1);
  expect(localStorage.getItem("interfaceScale")).toBe("1");
});

it.each([
  "",
  "NaN",
  "Infinity",
  "true",
  "null",
  '"1.5"',
  "[]",
  "{}",
  "2.5001",
  "0.5",
  "1.5junk",
  "0x2",
])(
  "rejects malformed stored interface scale without reviving legacy preferences: %p",
  (stored) => {
    localStorage.setItem("interfaceScale", stored);
    localStorage.setItem("textSize", "larger");
    localStorage.setItem("tvMode", "true");
    expect(settings().initialSettings.interfaceScale).toBe(1);
  },
);

it.each(["standalone", "ios"])(
  "defaults installed %s PWA sound on and remembers an explicit mute after relaunch",
  (platform) => {
    if (platform === "ios") {
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        value: true,
      });
    } else {
      const matchMedia = window.matchMedia;
      jest.spyOn(window, "matchMedia").mockImplementation((query) => ({
        ...matchMedia(query),
        matches: query === "(display-mode: standalone)",
      }));
    }
    const { default: reducer, initialSettings, change } = settings();
    expect(initialSettings.audioEnabled).toBe(true);
    expect(initialSettings.controllerVibrationEnabled).toBeUndefined();
    expect(initialSettings.steamTimelineEnabled).toBeUndefined();
    expect(initialSettings.screenEdgePadding).toBe(0);
    reducer(initialSettings, change({ audioEnabled: false }));
    expect(settings().initialSettings.audioEnabled).toBe(false);
    reducer(initialSettings, change({ audioEnabled: true }));
    expect(settings().initialSettings.audioEnabled).toBe(true);
  },
);

it("migrates the old chosen TV layout once and restores explicit workspace choices", () => {
  localStorage.setItem("tvMode", "true");
  const { default: reducer, initialSettings, change } = settings();
  expect(initialSettings.workspace).toBe("single");
  expect(localStorage.getItem("workspace")).toBe("single");
  const updated = reducer(initialSettings, change({ workspace: "automatic" }));
  expect(updated.workspace).toBe("automatic");
  expect(settings().initialSettings.workspace).toBe("automatic");
});

it.each(["invalid", "true", "null", '"single"', ""])(
  "rejects a malformed stored workspace instead of reviving an old preset: %p",
  (workspace) => {
    localStorage.setItem("tvMode", "true");
    localStorage.setItem("workspace", workspace);
    expect(settings().initialSettings.workspace).toBe("automatic");
  },
);

it("rejects an invalid runtime workspace and persists the valid fallback", () => {
  const { default: reducer, initialSettings, change } = settings();
  const updated = reducer(
    initialSettings,
    change({ workspace: "tv" } as unknown as Parameters<typeof change>[0]),
  );
  expect(updated.workspace).toBe("automatic");
  expect(settings().initialSettings.workspace).toBe("automatic");
});

it.each([
  [undefined, undefined, 0],
  [undefined, "4", 0],
  ["false", "4", 0],
  ["true", undefined, 2],
  ["true", "0", 0],
  ["true", "2", 2],
  ["true", "4", 4],
  ["true", "4junk", 0],
  ["true", "", 0],
  ["true", "Infinity", 0],
  ["true", '"4"', 0],
])(
  "migrates padding only from the active legacy layout: %p, %p",
  (mode, inset, expected) => {
    if (mode !== undefined) localStorage.setItem("tvMode", mode);
    if (inset !== undefined) localStorage.setItem("tvInset", inset);
    expect(settings().initialSettings.screenEdgePadding).toBe(expected);
    expect(localStorage.getItem("screenEdgePadding")).toBe(String(expected));
    localStorage.setItem("tvMode", "false");
    expect(settings().initialSettings.screenEdgePadding).toBe(expected);
  },
);

it.each([
  "",
  "NaN",
  "Infinity",
  "true",
  "null",
  '"4"',
  "[]",
  "{}",
  "-2",
  "3",
  "4.1",
  "4junk",
  "0x4",
])(
  "rejects malformed stored padding without reviving legacy inset: %p",
  (padding) => {
    localStorage.setItem("screenEdgePadding", padding);
    localStorage.setItem("tvMode", "true");
    localStorage.setItem("tvInset", "4");
    expect(settings().initialSettings.screenEdgePadding).toBe(0);
  },
);

it("persists independent padding choices and rejects invalid runtime values", () => {
  const { default: reducer, initialSettings, change } = settings();
  expect(initialSettings.screenEdgePadding).toBe(0);
  for (const padding of [4, 2, 0] as const) {
    const updated = reducer(
      initialSettings,
      change({ screenEdgePadding: padding }),
    );
    expect(updated.screenEdgePadding).toBe(padding);
    expect(settings().initialSettings.screenEdgePadding).toBe(padding);
    expect(updated.workspace).toBe("automatic");
    expect(updated.interfaceScale).toBe(1);
  }
  const invalid = reducer(
    initialSettings,
    change({ screenEdgePadding: -4 } as unknown as Parameters<
      typeof change
    >[0]),
  );
  expect(invalid.screenEdgePadding).toBe(0);
  expect(localStorage.getItem("screenEdgePadding")).toBe("0");
});

it("projects zero padding to seats without overwriting shared shell preferences", () => {
  const {
    default: reducer,
    initialSettings,
    change,
    applyPresentation,
  } = settings();
  const shell = reducer(
    initialSettings,
    change({
      screenEdgePadding: 4,
      workspace: "automatic",
      interfaceScale: 1.5,
      audioEnabled: true,
    }),
  );
  const seat = reducer(shell, applyPresentation(seatPresentation(shell)));
  expect(seat).toMatchObject({
    screenEdgePadding: 0,
    workspace: "single",
    interfaceScale: 1.5,
    audioEnabled: false,
  });
  expect(settings().initialSettings).toMatchObject({
    screenEdgePadding: 4,
    workspace: "automatic",
    interfaceScale: 1.5,
    audioEnabled: true,
  });
});
