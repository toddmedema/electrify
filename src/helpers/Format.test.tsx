import {
  formatWattHours,
  formatMoneyConcise,
  formatMoneyStable,
  formatWattHoursAxis,
  formatWattHoursOfPeak,
  floorToTwoSignificantDigits,
  formatWatts,
  formatWattsAxis,
  formatWattsOfPeak,
  formatPercent,
  formatCount,
  formatCustomerCount,
  withoutNegativeZero,
  formatFixed,
  formatNumber,
  formatPricePerMWh,
  formatFacilitySize,
  formatBuildMonths,
  formatScore,
} from "./Format";

describe("formatPercent", () => {
  it("rounds a fraction to a whole percentage by default", () => {
    expect(formatPercent(0.456)).toBe("46%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("keeps the requested decimals", () => {
    expect(formatPercent(0.4567, 1)).toBe("45.7%");
  });
});

describe("formatCount", () => {
  it("rounds and separates thousands in every locale", () => {
    expect(formatCount(1234567.4)).toBe("1,234,567");
    expect(formatCount(7)).toBe("7");
  });
});

describe("formatPricePerMWh", () => {
  it("uses the concise money style", () => {
    expect(formatPricePerMWh(42.5)).toBe("$42.5/MWh");
    expect(formatPricePerMWh(Infinity)).toBe("—/MWh");
  });
});

describe("formatFacilitySize", () => {
  it("shows energy for storage and power for generators", () => {
    expect(formatFacilitySize({ peakW: 100e6, peakWh: 400e6 })).toBe("400MWh");
    expect(formatFacilitySize({ peakW: 100e6 })).toBe("100MW");
  });
});

describe("formatBuildMonths", () => {
  it("rounds to whole months in either style", () => {
    expect(formatBuildMonths(1.5)).toBe("18 mo");
    expect(formatBuildMonths(0.26, "long")).toBe("3 months");
  });
});

describe("formatScore", () => {
  it("rounds and separates thousands", () => {
    expect(formatScore(12345.6)).toBe("12,346");
  });
});

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

  it("rounds to whole numbers from 10 up even when more precision is requested", () => {
    expect(formatWatts(337.5e6, 3)).toEqual("338MW");
    expect(formatWatts(16.875e6, 6)).toEqual("17MW");
    expect(formatWattHours(12.4e6, 2)).toEqual("12MWh");
    expect(formatWatts(9.9996e6, 3)).toEqual("10MW");
    expect(formatWatts(7.5e6, 3)).toEqual("7.5MW");
  });
});

describe("formatWatts rounding", () => {
  it("rounds to whole numbers from 10 up and keeps a decimal below", () => {
    expect(formatWatts(540.5e6)).toEqual("541MW");
    expect(formatWatts(54.1e6)).toEqual("54MW");
    expect(formatWatts(9.8e9)).toEqual("9.8GW");
    expect(formatWatts(9.84e6)).toEqual("9.8MW");
  });
});

describe("floorToTwoSignificantDigits", () => {
  it("never rounds up past the value", () => {
    expect(floorToTwoSignificantDigits(1.29e9)).toEqual(1.2e9);
    expect(floorToTwoSignificantDigits(1.2e9)).toEqual(1.2e9);
    expect(floorToTwoSignificantDigits(987e6)).toEqual(980e6);
    expect(floorToTwoSignificantDigits(0)).toEqual(0);
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

  it("reads the magnitude of a reverse flow, leaving direction to the caller", () => {
    expect(formatWattsOfPeak(-100000000, 1000000000)).toEqual("100MW/1GW");
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

describe("formatCustomerCount", () => {
  it.each([
    [1234, "1.2K", "1.23K"],
    [123456, "120K", "123K"],
    [1234567, "1.2M", "1.23M"],
    [9876543, "9.9M", "9.88M"],
    [0, "0", "0"],
  ])(
    "keeps two digits on axes and three on inspection for %s customers",
    (value, axis, tooltip) => {
      expect(formatCustomerCount(Number(value), 2)).toBe(axis);
      expect(formatCustomerCount(Number(value))).toBe(tooltip);
    },
  );
});

describe("zero signs in UI numbers", () => {
  it("displays negative zero as zero in compact customer counts", () => {
    expect(formatCustomerCount(-0, 2)).toBe("0");
    expect(formatCustomerCount(-0)).toBe("0");
  });

  it("does not put a minus before counts or percentages rounded to zero", () => {
    expect(formatCount(-0.1)).toBe("0");
    expect(formatPercent(-0.00001, 1)).toBe("0.0%");
    expect(formatPercent(-0.01, 1)).toBe("-1.0%");
    expect(formatCustomerCount(-0.00123)).toBe("-0.00123");
  });
});

describe("displayed negative zero", () => {
  it.each([
    ["-0", "0"],
    ["−0.00%", "0.00%"],
    ["$-0.00", "$0.00"],
    ["-$0.00", "$0.00"],
    ["-0,000.00 kWh", "0,000.00 kWh"],
    ["-0.001", "-0.001"],
    ["-0.01%", "-0.01%"],
    ["-$0.01", "-$0.01"],
    ["-1,000", "-1,000"],
  ])("formats %s as %s", (input, output) => {
    expect(withoutNegativeZero(input)).toBe(output);
  });

  it("keeps fixed decimals while clearing only zero signs", () => {
    expect(formatFixed(-0.004, 2)).toBe("0.00");
    expect(formatFixed(-0.005, 2)).toBe("-0.01");
    expect(formatFixed(-0.4, 0)).toBe("0");
    expect(formatFixed(-0.5, 0)).toBe("-1");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.00001)).toBe("0");
    expect(formatNumber(-0.00001, { maximumSignificantDigits: 3 })).toBe(
      "-0.00001",
    );
    expect(formatMoneyConcise(-0.001)).toBe("$0");
    expect(formatMoneyConcise(-63800)).toBe("-$63.8k");
    expect(formatMoneyStable(-63800)).toBe("-$63.8k");
    expect(formatWatts(-0.001)).toBe("0W");
    expect(formatScore(-0.001)).toBe("0");
  });
});
