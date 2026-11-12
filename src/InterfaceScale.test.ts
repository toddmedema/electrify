import {
  applyInterfaceScale,
  getInterfaceScale,
  migrateInterfaceScale,
  normalizeInterfaceScale,
  subscribeInterfaceScale,
} from "./InterfaceScale";
import { seatPresentation } from "./couch/Presentation";
import type { SettingsType } from "./Types";

afterEach(() => applyInterfaceScale(1));

it.each([720, 1080, 2160])(
  "keeps 150% explicit at a %p px display height",
  (height) => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "innerHeight")!;
    try {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: height,
      });
      applyInterfaceScale(1.5);
      expect(document.documentElement.style.fontSize).toBe("150%");
      expect(getInterfaceScale()).toBe(1.5);
    } finally {
      Object.defineProperty(window, "innerHeight", descriptor);
    }
  },
);

it("shares one explicit multiplier between the root UI and chart subscriptions", () => {
  const viewport = [window.innerWidth, window.innerHeight];
  const changed = jest.fn();
  const stop = subscribeInterfaceScale(changed);
  try {
    applyInterfaceScale(2.5);
    expect(document.documentElement.style.fontSize).toBe("250%");
    expect(document.documentElement.dataset.interfaceScale).toBe("2.5");
    expect(getInterfaceScale()).toBe(2.5);
    expect(changed).toHaveBeenCalledTimes(1);
    applyInterfaceScale(2.5);
    expect(changed).toHaveBeenCalledTimes(1);
    applyInterfaceScale(1.125);
    expect(document.documentElement.style.fontSize).toBe("112.5%");
    expect([window.innerWidth, window.innerHeight]).toEqual(viewport);
  } finally {
    stop();
  }
});

it.each([undefined, null, "", "1.5", "250%", 0.99, 2.51, {}, NaN, Infinity])(
  "rejects malformed or unsupported interface scales: %p",
  (value) => {
    expect(normalizeInterfaceScale(value)).toBe(1);
    applyInterfaceScale(2.5);
    applyInterfaceScale(value);
    expect(getInterfaceScale()).toBe(1);
    expect(document.documentElement.style.fontSize).toBe("100%");
  },
);

it("preserves every legacy text and explicit TV-scale product", () => {
  expect(migrateInterfaceScale("large", true, 1.75)).toBe(1.96875);
  expect(migrateInterfaceScale("larger", true, 2)).toBe(2.5);
  expect(migrateInterfaceScale("larger", false, 2)).toBe(1.25);
  expect(migrateInterfaceScale("large", undefined, 2)).toBe(1.125);
  expect(migrateInterfaceScale("invalid", true, Infinity)).toBe(1.5);
});

it.each([1, 1.5])(
  "projects scale %p to seats without another TV multiplier",
  (interfaceScale) => {
    const settings: SettingsType = {
      theme: "system",
      units: "metric",
      musicVolume: 1,
      soundEffectsVolume: 1,
      interfaceScale,
      tvMode: true,
      tvScale: 2,
    };
    const seat = seatPresentation(settings);
    expect(seat.interfaceScale).toBe(interfaceScale);
    applyInterfaceScale(seat.interfaceScale);
    expect(getInterfaceScale()).toBe(interfaceScale);
  },
);
