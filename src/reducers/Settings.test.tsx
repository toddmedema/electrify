import type { DesktopBridge } from "../Desktop";

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
