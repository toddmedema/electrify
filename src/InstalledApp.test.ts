import { isInstalledWebApp } from "./InstalledApp";

it("returns false when the browser window is absent", () => {
  const browserWindow = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: undefined,
  });
  try {
    expect(isInstalledWebApp()).toBe(false);
  } finally {
    Object.defineProperty(globalThis, "window", browserWindow);
  }
});
