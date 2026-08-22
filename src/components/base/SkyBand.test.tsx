import { sunElevation, twilightFactor } from "./SkyBand";

// Roughly San Francisco in June, the location the first scenarios use
const SUNRISE = 6 * 60;
const SUNSET = 20 * 60;

describe("sunElevation", () => {
  it("is zero before sunrise and after sunset", () => {
    expect(sunElevation(0, SUNRISE, SUNSET)).toBe(0);
    expect(sunElevation(SUNRISE - 1, SUNRISE, SUNSET)).toBe(0);
    expect(sunElevation(SUNSET + 1, SUNRISE, SUNSET)).toBe(0);
    expect(sunElevation(1439, SUNRISE, SUNSET)).toBe(0);
  });

  it("peaks at solar noon, halfway between sunrise and sunset", () => {
    const noon = SUNRISE + (SUNSET - SUNRISE) / 2;
    expect(sunElevation(noon, SUNRISE, SUNSET)).toBeCloseTo(1);
    expect(sunElevation(noon - 120, SUNRISE, SUNSET)).toBeLessThan(1);
    expect(sunElevation(noon + 120, SUNRISE, SUNSET)).toBeLessThan(1);
  });

  it("rises through the morning and falls through the afternoon", () => {
    const at = (hours: number[]) =>
      hours.map((h) => sunElevation(h * 60, SUNRISE, SUNSET));
    // Sorting a copy and comparing is the same claim as "each hour beats the last", without
    // burying an expect inside a conditional
    const morning = at([7, 8, 9, 10, 11, 12]);
    const afternoon = at([14, 15, 16, 17, 18, 19]);

    expect(morning).toEqual([...morning].sort((a, b) => a - b));
    expect(afternoon).toEqual([...afternoon].sort((a, b) => b - a));
    expect(new Set(morning).size).toBe(morning.length);
    expect(new Set(afternoon).size).toBe(afternoon.length);
  });

  // Polar latitudes can hand back a sunset at or before sunrise; the band still has to paint
  // something rather than divide by zero
  it("survives a day with no daylight window", () => {
    expect(sunElevation(600, SUNRISE, SUNRISE)).toBe(0);
    expect(sunElevation(600, SUNSET, SUNRISE)).toBe(0);
  });
});

describe("twilightFactor", () => {
  it("is full strength right at sunrise and sunset", () => {
    expect(twilightFactor(SUNRISE, SUNRISE, SUNSET)).toBe(1);
    expect(twilightFactor(SUNSET, SUNRISE, SUNSET)).toBe(1);
  });

  it("fades to nothing an hour out from either edge", () => {
    expect(twilightFactor(SUNRISE - 60, SUNRISE, SUNSET)).toBe(0);
    expect(twilightFactor(SUNSET + 60, SUNRISE, SUNSET)).toBe(0);
    expect(twilightFactor(SUNRISE - 30, SUNRISE, SUNSET)).toBeCloseTo(0.5);
  });

  it("never goes negative in the dead of night", () => {
    expect(twilightFactor(0, SUNRISE, SUNSET)).toBe(0);
    expect(twilightFactor(180, SUNRISE, SUNSET)).toBe(0);
  });
});
