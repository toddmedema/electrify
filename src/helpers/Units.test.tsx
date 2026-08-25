import {
  formatLargeMass,
  formatLargeMassApprox,
  formatMass,
  formatPricePerLargeMass,
  formatSpeed,
  formatTemperature,
  toDisplayLargeMass,
  toDisplayMass,
  toDisplaySpeed,
  toDisplayTemperature,
} from "./Units";

describe("Units", () => {
  describe("metric", () => {
    // Metric is what everything upstream is already in, so it has to come back untouched -
    // a rounding factor of 1.0000001 here would drift every number in the game
    it("hands metric values back unchanged", () => {
      expect(toDisplayTemperature(21.5, "metric")).toBe(21.5);
      expect(toDisplaySpeed(30, "metric")).toBe(30);
      expect(toDisplayMass(450, "metric")).toBe(450);
      expect(toDisplayLargeMass(2500, "metric")).toBe(2.5);
    });

    it("labels them in metric", () => {
      expect(formatTemperature(21.5, "metric")).toBe("22°C");
      expect(formatSpeed(30, "metric")).toBe("30 km/h");
      expect(formatMass(450, "metric")).toBe("450kg");
      expect(formatLargeMass(2500000, "metric")).toBe("2,500 tonnes");
    });
  });

  describe("imperial", () => {
    it("converts temperature, including below freezing", () => {
      expect(formatTemperature(0, "imperial")).toBe("32°F");
      expect(formatTemperature(100, "imperial")).toBe("212°F");
      expect(formatTemperature(-40, "imperial")).toBe("-40°F");
    });

    it("converts wind speed", () => {
      expect(toDisplaySpeed(160.9344, "imperial")).toBeCloseTo(100, 6);
      expect(formatSpeed(50, "imperial")).toBe("31 mph");
    });

    it("converts mass and quotes it in pounds", () => {
      expect(toDisplayMass(0.45359237, "imperial")).toBeCloseTo(1, 9);
      expect(formatMass(450, "imperial")).toBe("992lb");
    });

    // Short tons, not tonnes: 10% apart, which is why the metric one is spelled "tonnes"
    it("converts large mass into short tons", () => {
      expect(toDisplayLargeMass(907.18474, "imperial")).toBeCloseTo(1, 9);
      expect(formatLargeMass(907184.74, "imperial")).toBe("1,000 tons");
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
