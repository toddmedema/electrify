import {
  formatLargeMass,
  formatLargeMassApprox,
  formatLargeMassSignificant,
  formatLargeMassValue,
  formatLargeMassValueConcise,
  formatMass,
  formatPricePerLargeMass,
  formatTemperature,
  formatForecastTemperature,
  toDisplayLargeMass,
  toDisplayMass,
  toDisplayTemperature,
} from "./Units";

describe("Units", () => {
  it.each<[number, "metric" | "imperial", string]>([
    [40.4, "imperial", "100°F"],
    [21.49, "metric", "21°C"],
    [2.49, "metric", "2°C"],
    [2.5, "metric", "3°C"],
    [-2.5, "metric", "-2°C"],
    [0, "metric", "0°C"],
    [0, "imperial", "32°F"],
  ])("rounds forecast %s°C once in %s units", (value, units, expected) => {
    expect(formatForecastTemperature(value, units)).toBe(expected);
  });

  describe("metric", () => {
    // Metric is what everything upstream is already in, so it has to come back untouched -
    // a rounding factor of 1.0000001 here would drift every number in the game
    it("hands metric values back unchanged and labels them", () => {
      expect(toDisplayTemperature(21.5, "metric")).toBe(21.5);
      expect(toDisplayMass(450, "metric")).toBe(450);
      expect(toDisplayLargeMass(2500, "metric")).toBe(2.5);
      expect(formatTemperature(21.5, "metric")).toBe("22°C");
      expect(formatMass(450, "metric")).toBe("450kg");
      expect(formatLargeMass(2500000, "metric")).toBe("2.5k tonnes");
    });
  });

  describe("imperial", () => {
    it("converts and labels temperature and mass", () => {
      expect(formatTemperature(0, "imperial")).toBe("32°F");
      expect(formatTemperature(100, "imperial")).toBe("212°F");
      expect(formatTemperature(-40, "imperial")).toBe("-40°F");
      expect(toDisplayMass(0.45359237, "imperial")).toBeCloseTo(1, 9);
      expect(formatMass(450, "imperial")).toBe("992lb");
      // Short tons, not tonnes: 10% apart, which is why the metric one is spelled "tonnes"
      expect(toDisplayLargeMass(907.18474, "imperial")).toBeCloseTo(1, 9);
      expect(formatLargeMass(907184.74, "imperial")).toBe("1k tons");
    });
  });

  // A round number of one is a lopsided number of the other, and the score's megatonne is
  // exactly that: a yardstick, not a measurement
  it("rounds a yardstick quantity to something readable", () => {
    expect(formatLargeMassApprox(1000000000, "metric")).toBe("1M tonnes");
    expect(formatLargeMassApprox(1000000000, "imperial")).toBe("1.1M tons");
  });

  // The scenario stores a fee per kilogram whichever system it's quoted in, so only the
  // quoted number moves
  it("restates a per-ton price without touching the stored one", () => {
    expect(formatPricePerLargeMass(0.05, "metric")).toBe("$50/tonne");
    expect(formatPricePerLargeMass(0.05, "imperial")).toBe("$45/ton");
    expect(formatPricePerLargeMass(0, "metric")).toBe("$0/tonne");
    expect(formatPricePerLargeMass(0, "imperial")).toBe("$0/ton");
  });
});

it("does not show negative zero for a per-ton price rounded to zero", () => {
  expect(formatPricePerLargeMass(-0.00001, "metric")).toBe("$0/tonne");
  expect(formatPricePerLargeMass(-0.001, "metric")).toBe("$-1/tonne");
});

it("rounds a headline mass to three significant digits with k/M/B", () => {
  expect(formatLargeMassSignificant(0, "metric")).toBe("0 tonnes");
  expect(formatLargeMassSignificant(523000, "metric")).toBe("523 tonnes");
  expect(formatLargeMassSignificant(5234000, "metric")).toBe("5.23k tonnes");
  expect(formatLargeMassSignificant(12345000, "metric")).toBe("12.3k tonnes");
  expect(formatLargeMassSignificant(123456000, "metric")).toBe("123k tonnes");
  expect(formatLargeMassSignificant(1234567000, "metric")).toBe("1.23M tonnes");
  expect(formatLargeMassSignificant(1200000000, "metric")).toBe("1.2M tonnes");
  expect(formatLargeMassSignificant(1.234e12, "metric")).toBe("1.23B tonnes");
  // Rounding up past a prefix boundary promotes it instead of printing 1000k
  expect(formatLargeMassSignificant(999600000, "metric")).toBe("1M tonnes");
  expect(formatLargeMassSignificant(907184740, "imperial")).toBe("1M tons");
  expect(formatLargeMassSignificant(1.5e15, "metric")).toBe("1.5T tonnes");
});

it("preserves mass precision and compact unit thresholds in both systems", () => {
  expect(formatLargeMassValue(1234500, "metric", 2)).toBe("1.23k");
  expect(formatLargeMassValue(-1005, "metric", 2)).toBe("-1.01");
  expect(formatLargeMassValueConcise(499000, "metric")).toBe("499");
  expect(formatLargeMassValueConcise(500000, "metric")).toBe("500");
  expect(formatLargeMassValueConcise(1111111111, "imperial")).toBe("1.22M");
});
