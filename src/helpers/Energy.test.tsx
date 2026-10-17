import {
  getAirborneWindCapacityFactor,
  getAirborneWindOutputFactor,
  getAirborneWindReferenceKph,
  getDispatchOrderedFuels,
  getOffshoreWindCapacityFactor,
  getOffshoreWindOutputFactor,
  getSolarOutputFactor,
  getWindOutputFactor,
  getSolarCapacityFactor,
  getWindCapacityFactor,
} from "./Energy";
import { pow } from "./Pow";

it("preserves exact wind output at and around every curve boundary", () => {
  const offshoreHeight = pow(150 / 10, 0.11);
  const speeds = [
    0,
    ...[3, 14, 25].flatMap((speed) =>
      [-1e-10, 0, 1e-10].map(
        (offset) => ((speed + offset) * 3.6) / offshoreHeight,
      ),
    ),
    ...Array.from({ length: 201 }, (_, i) => i / 2),
  ];
  speeds.forEach((speed) => {
    const turbineWind = (speed / 3.6) * pow(150 / 10, 0.11);
    const expected =
      (turbineWind < 3 || turbineWind > 25
        ? 0
        : Math.max(0, Math.min(1, (turbineWind - 3) / 11))) * 0.85;
    expect(getOffshoreWindOutputFactor(speed)).toBe(expected);
    expect(getAirborneWindReferenceKph(speed)).toBe(speed * pow(100 / 10, 0.2));
  });
});

describe("Airborne Wind", () => {
  it("derives the 100m reference speed directly from raw 10m wind", () => {
    expect(getAirborneWindReferenceKph(36)).toBeCloseTo(57.056, 3);
  });

  it("uses its own cut-in, rated, and severe-weather cut-out curve", () => {
    const kph = (metresPerSecond: number) => metresPerSecond * 3.6;
    expect(getAirborneWindOutputFactor(kph(5.9))).toBe(0);
    expect(getAirborneWindOutputFactor(kph(6))).toBe(0);
    expect(getAirborneWindOutputFactor(kph(8.5))).toBeCloseTo(0.444, 3);
    expect(getAirborneWindOutputFactor(kph(11))).toBeCloseTo(0.888, 3);
    expect(getAirborneWindOutputFactor(kph(20))).toBeCloseTo(0.888, 3);
    expect(getAirborneWindOutputFactor(kph(20.1))).toBe(0);
    expect(getAirborneWindOutputFactor(kph(100))).toBe(0);
  });
});

// Onshore input is raw 10m weather, with one explicit farm reference multiplier.
describe("getWindOutputFactor", () => {
  it("follows the turbine curve from cut-in through cut-out", () => {
    expect(getWindOutputFactor(2)).toEqual(0);
    // 10kph becomes 4.86m/s at the representative farm.
    const result = getWindOutputFactor(10);
    expect(result).toBeCloseTo(0.169, 3);
    // Doubling the wind more than doubles what comes out, until it flattens off at rated
    expect(getWindOutputFactor(20)).toBeGreaterThan(2 * result);
    expect(getWindOutputFactor(40)).toEqual(1);
    expect(getWindOutputFactor(75)).toEqual(0);
  });
});

describe("getOffshoreWindOutputFactor", () => {
  it("uses the shared cut-in and cut-out curve", () => {
    expect(getOffshoreWindOutputFactor(2)).toEqual(0);
    expect(getOffshoreWindOutputFactor(100)).toEqual(0);
  });

  it("uses a sea gradient and array losses without a city siting multiplier", () => {
    expect(getOffshoreWindOutputFactor(20)).toBeGreaterThan(0);
    expect(getOffshoreWindOutputFactor(40)).toBeCloseTo(0.85);
  });
});

describe("getSolarOutputFactor", () => {
  it("uses cell heating and a modest temperature coefficient", () => {
    expect(getSolarOutputFactor(500, 20)).toBeCloseTo(0.48);
    expect(getSolarOutputFactor(500, 5)).toBeCloseTo(0.51);
    expect(getSolarOutputFactor(1000, 25)).toBeCloseTo(0.88);
  });
  it("clips extremes to zero and nameplate", () => {
    expect(getSolarOutputFactor(-50, 20)).toBe(0);
    expect(getSolarOutputFactor(0, -20)).toBe(0);
    expect(getSolarOutputFactor(1500, -30)).toBe(1);
    expect(getSolarOutputFactor(1000, 300)).toBe(0);
  });
});

describe("renewable capacity factors", () => {
  it.each([
    {
      technology: "onshore wind",
      capacityFactor: getWindCapacityFactor,
      samples: [0, 40, 75],
      expected: 1 / 3,
    },
    {
      technology: "offshore wind",
      capacityFactor: getOffshoreWindCapacityFactor,
      samples: [0, 40, 100],
      expected: 0.85 / 3,
    },
    {
      technology: "airborne wind",
      capacityFactor: getAirborneWindCapacityFactor,
      samples: [0, 11 * 3.6, 21 * 3.6],
      expected: 0.888 / 3,
    },
    {
      technology: "solar",
      capacityFactor: getSolarCapacityFactor,
      samples: [0, 500, 1000],
      expected: 0.46,
    },
  ])(
    "averages $technology output and accepts an empty sample",
    ({ capacityFactor, samples, expected }) => {
      expect(capacityFactor([])).toBe(0);
      expect(capacityFactor(samples)).toBeCloseTo(expected, 10);
    },
  );
});

describe("getDispatchOrderedFuels", () => {
  it("should return unique fuels in facility list order", () => {
    const result = getDispatchOrderedFuels([
      { fuel: "Coal" },
      { fuel: "Natural Gas" },
      { fuel: "Coal" },
    ]);
    expect(result).toEqual(["Coal", "Natural Gas"]);
  });

  it("should put must-run renewables below the dispatchable fuels", () => {
    const result = getDispatchOrderedFuels([
      { fuel: "Coal" },
      { fuel: "Wind" },
      { fuel: "Offshore Wind" },
      { fuel: "Airborne Wind" },
      { fuel: "Natural Gas" },
      { fuel: "Sun" },
    ]);
    expect(result).toEqual([
      "Sun",
      "Wind",
      "Offshore Wind",
      "Airborne Wind",
      "Coal",
      "Natural Gas",
    ]);
  });

  it("should skip facilities that have no fuel", () => {
    expect(getDispatchOrderedFuels([{}, { fuel: "Coal" }, {}])).toEqual([
      "Coal",
    ]);
    expect(getDispatchOrderedFuels([])).toEqual([]);
  });
});
