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

it.each([1.5, 2])(
  "restores an explicit stored scale and persists changes to %p",
  (scale) => {
    localStorage.setItem("interfaceScale", "1.75");
    const { default: reducer, initialSettings, change } = settings();
    expect(initialSettings.interfaceScale).toBe(1.75);
    const large = reducer(initialSettings, change({ interfaceScale: scale }));
    expect(large.interfaceScale).toBe(scale);
    expect(settings().initialSettings.interfaceScale).toBe(scale);
    const invalid = reducer(
      large,
      change({ interfaceScale: "300%" } as unknown as Parameters<
        typeof change
      >[0]),
    );
    expect(invalid.interfaceScale).toBe(1);
    expect(localStorage.getItem("interfaceScale")).toBe("1");
  },
);

it.each([
  "",
  "NaN",
  "Infinity",
  "true",
  "null",
  '"1.5"',
  "[]",
  "{}",
  "0.5",
  "2.5",
  "3",
  "1.5junk",
  "0x2",
])("rejects a malformed stored interface scale: %p", (stored) => {
  localStorage.setItem("interfaceScale", stored);
  expect(settings().initialSettings.interfaceScale).toBe(1);
});

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
])("rejects a malformed stored padding: %p", (padding) => {
  localStorage.setItem("screenEdgePadding", padding);
  expect(settings().initialSettings.screenEdgePadding).toBe(0);
});

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
      interfaceScale: 1.5,
      audioEnabled: true,
    }),
  );
  const seat = reducer(shell, applyPresentation(seatPresentation(shell)));
  expect(seat).toMatchObject({
    screenEdgePadding: 0,
    interfaceScale: 1.5,
    audioEnabled: false,
  });
  expect(settings().initialSettings).toMatchObject({
    screenEdgePadding: 4,
    interfaceScale: 1.5,
    audioEnabled: true,
  });
});
