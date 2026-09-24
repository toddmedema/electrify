import {
  formatWattHours,
  formatMoneyConcise,
  formatMoneyStable,
  formatWattHoursAxis,
  formatWattHoursOfPeak,
  formatWatts,
  formatWattsAxis,
  formatSignedWattsOfPeak,
  formatWattsOfPeak,
} from "./Format";

describe("formatWatts", () => {
  it("chooses the appropriate SI unit", () => {
    [
      [10, "10W"],
      [1500, "1.5kW"],
      [1500000, "1.5MW"],
      [500e6, "500MW"],
      [-500e6, "-500MW"],
      [999e6, "999MW"],
      [1e9, "1GW"],
      [1500000000, "1.5GW"],
      [1500000000000, "1.5TW"],
    ].forEach(([watts, formatted]) => {
      expect(formatWatts(watts as number)).toEqual(formatted);
    });
  });

  it("honours the requested precision", () => {
    expect(formatWatts(1001, 0)).toEqual("1kW");
    expect(formatWatts(1521, 3)).toEqual("1.521kW");
    expect(formatWatts(1521, 4)).toEqual("1.521kW");
  });
});

describe("formatWattsAxis", () => {
  it("uses the same magnitude thresholds on axes", () => {
    const ticks = [0, 3e8, 6e8, 9e8, 1.2e9];
    expect(ticks.map((t) => formatWattsAxis(t, ticks))).toEqual([
      "0W",
      "300MW",
      "600MW",
      "900MW",
      "1.2GW",
    ]);
  });
});

describe("formatWattHoursAxis", () => {
  it("uses the energy helper for axis values", () => {
    const ticks = [0, 5e8, 1e9];
    expect(ticks.map((t) => formatWattHoursAxis(t, ticks))).toEqual([
      "0Wh",
      "500MWh",
      "1GWh",
    ]);
  });
});

describe("formatWattsOfPeak", () => {
  it("keeps MW below a GW peak", () => {
    expect(formatWattsOfPeak(100000000, 1000000000)).toEqual("100MW/1GW");
  });

  it("should handle an idle facility", () => {
    expect(formatWattsOfPeak(0, 500000000)).toEqual("0/500MW");
  });
});

describe("formatSignedWattsOfPeak", () => {
  it("reads like the unsigned pair when power flows the normal way", () => {
    expect(formatSignedWattsOfPeak(100000000, 1000000000)).toEqual("100MW/1GW");
  });

  it("keeps the sign that formatWattsOfPeak strips", () => {
    expect(formatWattsOfPeak(-100000000, 1000000000)).toEqual("100MW/1GW");
    expect(formatSignedWattsOfPeak(-100000000, 1000000000)).toEqual(
      "-100MW/1GW",
    );
  });

  it("preserves small signed flows and leaves zero unsigned", () => {
    expect(formatSignedWattsOfPeak(-1000, 500000000)).toEqual("-1kW/500MW");
    expect(formatSignedWattsOfPeak(0, 500000000)).toEqual("0/500MW");
  });
});

describe("formatWattHoursOfPeak", () => {
  it("labels both units when their magnitudes differ", () => {
    expect(formatWattHoursOfPeak(100000000, 1000000000)).toEqual("100MWh/1GWh");
  });
});

// A cost per unit is a division, so a zero denominator arrives here as Infinity or NaN. numbro
// renders those literally, which is how "$INFINITY/MWh" reached the build screen.
describe("money formatting of values that are not numbers", () => {
  const NO_ESTIMATE = "\u2014";

  it("does not promote an amount before it reaches the next tier", () => {
    expect(formatMoneyConcise(700000000)).toEqual("$700M");
    expect(formatMoneyStable(700000000)).toEqual("$700M");
    expect(formatMoneyConcise(999000000)).toEqual("$999M");
    expect(formatMoneyConcise(999999999)).toEqual("$999M");
    expect(formatMoneyConcise(1000000000)).toEqual("$1B");
  });

  it("shows a dash rather than a word for a value it cannot express", () => {
    [Infinity, -Infinity, NaN].forEach((value) => {
      expect(formatMoneyConcise(value)).toEqual(NO_ESTIMATE);
      expect(formatMoneyStable(value)).toEqual(NO_ESTIMATE);
    });
  });
});

test("energy uses the same magnitude thresholds as power", () => {
  expect(formatWattHours(500e6)).toBe("500MWh");
  expect(formatWattHours(1e9)).toBe("1GWh");
});
