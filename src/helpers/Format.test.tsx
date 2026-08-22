import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWattHoursAxis,
  formatWattHoursOfPeak,
  formatWatts,
  formatWattsAxis,
  formatWattsOfPeak,
} from "./Format";

describe("formatWatts", () => {
  it("should correctly format numbers in the tens", () => {
    const result = formatWatts(10);
    expect(result).toEqual("10W");
  });

  it("should correctly format numbers in the thousands", () => {
    const result = formatWatts(1500);
    expect(result).toEqual("1.5kW");
  });

  it("should correctly format numbers in the millions", () => {
    const result = formatWatts(1500000);
    expect(result).toEqual("1.5MW");
  });

  it("should correctly format numbers in the billions", () => {
    const result = formatWatts(1500000000);
    expect(result).toEqual("1.5GW");
  });

  it("should correctly format numbers in the trillions", () => {
    const result = formatWatts(1500000000000);
    expect(result).toEqual("1.5TW");
  });

  it("should correctly handle the mantissa parameter when 0", () => {
    const result = formatWatts(1001, 0);
    expect(result).toEqual("1kW");
  });

  it("should correctly handle the mantissa parameter when 2", () => {
    const result = formatWatts(1521, 0);
    expect(result).toEqual("1.5kW");
  });

  it("should correctly handle the mantissa parameter when 3", () => {
    const result = formatWatts(1521, 3);
    expect(result).toEqual("1.52kW");
  });

  it("should correctly handle the mantissa parameter when 4", () => {
    const result = formatWatts(1521, 4);
    expect(result).toEqual("1.521kW");
  });
});

describe("formatWattsAxis", () => {
  it("should render every tick in the unit of the largest one", () => {
    const ticks = [0, 1e8, 2e8, 3e8, 4e8, 5e8];
    expect(ticks.map((t) => formatWattsAxis(t, ticks))).toEqual([
      "0MW",
      "100MW",
      "200MW",
      "300MW",
      "400MW",
      "500MW",
    ]);
  });

  it("should promote the whole axis once the largest tick crosses a unit", () => {
    const ticks = [0, 3e8, 6e8, 9e8, 1.2e9];
    expect(ticks.map((t) => formatWattsAxis(t, ticks))).toEqual([
      "0GW",
      "0.3GW",
      "0.6GW",
      "0.9GW",
      "1.2GW",
    ]);
  });
});

describe("formatWattHoursAxis", () => {
  it("should append h to the shared unit", () => {
    const ticks = [0, 5e8, 1e9];
    expect(ticks.map((t) => formatWattHoursAxis(t, ticks))).toEqual([
      "0GWh",
      "0.5GWh",
      "1GWh",
    ]);
  });
});

describe("formatWattsOfPeak", () => {
  it("should report the current output in the peak's unit", () => {
    expect(formatWattsOfPeak(356000000, 500000000)).toEqual("356/500MW");
  });

  it("should keep an extra digit when the current output is below the peak's unit", () => {
    expect(formatWattsOfPeak(100000000, 1000000000)).toEqual("0.1/1GW");
  });

  it("should handle an idle facility", () => {
    expect(formatWattsOfPeak(0, 500000000)).toEqual("0/500MW");
  });
});

describe("formatWattHoursOfPeak", () => {
  it("should share a unit across the pair", () => {
    expect(formatWattHoursOfPeak(100000000, 1000000000)).toEqual("0.1/1GWh");
  });
});

// A cost per unit is a division, so a zero denominator arrives here as Infinity or NaN. numbro
// renders those literally, which is how "$INFINITY/MWh" reached the build screen.
describe("money formatting of values that are not numbers", () => {
  const NO_ESTIMATE = "\u2014";

  it("still formats ordinary amounts", () => {
    expect(formatMoneyConcise(1500000)).toEqual("$1.5M");
    expect(formatMoneyStable(1500000)).toEqual("$1.50M");
  });

  it("shows a dash rather than a word for a value it cannot express", () => {
    [Infinity, -Infinity, NaN].forEach((value) => {
      expect(formatMoneyConcise(value)).toEqual(NO_ESTIMATE);
      expect(formatMoneyStable(value)).toEqual(NO_ESTIMATE);
    });
  });
});
