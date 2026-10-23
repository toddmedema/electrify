import {
  applyTextSize,
  getTextScale,
  normalizeTextSize,
  subscribeTextSize,
} from "./TextSize";

afterEach(() => applyTextSize("standard"));

it("bounds device typography to the supported sizes and preserves viewport dimensions", () => {
  const viewport = [window.innerWidth, window.innerHeight];
  const changed = jest.fn();
  const stop = subscribeTextSize(changed);
  try {
    applyTextSize("larger");
    expect(document.documentElement.style.fontSize).toBe("125%");
    expect(getTextScale()).toBe(1.25);
    expect(document.documentElement.dataset.textSize).toBe("larger");
    expect(changed).toHaveBeenCalledTimes(1);
    applyTextSize("larger");
    expect(changed).toHaveBeenCalledTimes(1);
    applyTextSize("large");
    expect(document.documentElement.style.fontSize).toBe("112.5%");
    expect([window.innerWidth, window.innerHeight]).toEqual(viewport);
  } finally {
    stop();
  }
});

it.each([undefined, null, "", "900%", "small", 100, {}, NaN])(
  "falls back safely for an invalid saved text size: %p",
  (value) => {
    expect(normalizeTextSize(value)).toBe("standard");
    applyTextSize("larger");
    applyTextSize(value);
    expect(getTextScale()).toBe(1);
    expect(document.documentElement.style.fontSize).toBe("100%");
  },
);
