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

  it("averages the same output helper used by live dispatch", () => {
    const speeds = [5, 8.5, 11].map((windMS) => windMS * 3.6);
    expect(getAirborneWindCapacityFactor([])).toBe(0);
    expect(getAirborneWindCapacityFactor(speeds)).toBeCloseTo(
      speeds.reduce(
        (total, speed) => total + getAirborneWindOutputFactor(speed),
        0,
      ) / speeds.length,
    );
  });
});

// The argument is the wind at the site in kph, and the turbine sees a fraction of it - so the
// speeds that matter to the power curve are several times the ones quoted in m/s below
describe("getWindOutputFactor", () => {
  it("follows the turbine curve from cut-in through cut-out", () => {
    expect(getWindOutputFactor(2)).toEqual(0);
    // 20kph at the site is 5.6m/s, which the gradient and derate together turn into 4.9m/s at the
    // hub: not quite two metres a second above cut-in, of the eleven that reach rated output
    const result = getWindOutputFactor(20);
    expect(result).toBeCloseTo(0.169, 3);
    // Doubling the wind more than doubles what comes out, until it flattens off at rated
    expect(getWindOutputFactor(40)).toBeGreaterThan(2 * result);
    expect(getWindOutputFactor(80)).toEqual(1);
    expect(getWindOutputFactor(150)).toEqual(0);
  });
});

describe("getOffshoreWindOutputFactor", () => {
  it("uses the shared cut-in and cut-out curve", () => {
    expect(getOffshoreWindOutputFactor(2)).toEqual(0);
    expect(getOffshoreWindOutputFactor(100)).toEqual(0);
  });

  it("turns a real offshore surface reading into stronger output", () => {
    expect(getOffshoreWindOutputFactor(20)).toBeGreaterThan(
      getWindOutputFactor(20),
    );
    expect(getOffshoreWindOutputFactor(40)).toBeCloseTo(0.85);
  });
});

describe("getSolarOutputFactor", () => {
  it("derates hot panels without boosting cool ones", () => {
    expect(getSolarOutputFactor(500, 20)).toEqual(0.45);
    expect(getSolarOutputFactor(500, 5)).toEqual(0.5);
    expect(getSolarOutputFactor(500, -10)).toEqual(0.5);
  });
});

describe("getWindCapacityFactor", () => {
  it("returns a bounded average, including for an empty sample", () => {
    [[], [5, 10, 15, 20, 25]].forEach((windSpeedsKph) => {
      const result = getWindCapacityFactor(windSpeedsKph);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });
});

describe("getOffshoreWindCapacityFactor", () => {
  it("averages the offshore output curve", () => {
    expect(getOffshoreWindCapacityFactor([])).toEqual(0);
    expect(getOffshoreWindCapacityFactor([20, 40])).toBeCloseTo(
      (getOffshoreWindOutputFactor(20) + getOffshoreWindOutputFactor(40)) / 2,
    );
  });
});

describe("getSolarCapacityFactor", () => {
  it("returns a bounded average, including for an empty sample", () => {
    [[], [500, 1000, 1000, 500, 0]].forEach((irradiancesWM2) => {
      const result = getSolarCapacityFactor(irradiancesWM2);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });
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
