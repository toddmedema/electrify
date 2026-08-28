import {
  getDispatchOrderedFuels,
  getOffshoreWindCapacityFactor,
  getOffshoreWindOutputFactor,
  getSolarOutputFactor,
  getWindOutputFactor,
  getSolarCapacityFactor,
  getWindCapacityFactor,
} from "./Energy";

// The argument is the wind at the site in kph, and the turbine sees a fraction of it - so the
// speeds that matter to the power curve are several times the ones quoted in m/s below
describe("getWindOutputFactor", () => {
  it("should return 0 below the turbine's cut-in speed", () => {
    const windKph = 2;
    const result = getWindOutputFactor(windKph);
    expect(result).toEqual(0);
  });

  it("should return 0 above the turbine's cut-out speed", () => {
    const windKph = 150;
    const result = getWindOutputFactor(windKph);
    expect(result).toEqual(0);
  });

  it("should slope between cut-in and rated speed", () => {
    // 20kph at the site is 5.6m/s, which the gradient and derate together turn into 4.9m/s at the
    // hub: not quite two metres a second above cut-in, of the eleven that reach rated output
    const result = getWindOutputFactor(20);
    expect(result).toBeCloseTo(0.169, 3);
    // Doubling the wind more than doubles what comes out, until it flattens off at rated
    expect(getWindOutputFactor(40)).toBeGreaterThan(2 * result);
    expect(getWindOutputFactor(80)).toEqual(1);
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
  it("should correctly calculate the solar output factor", () => {
    const irradianceWM2 = 500;
    const temperatureC = 20;
    const result = getSolarOutputFactor(irradianceWM2, temperatureC);
    expect(result).toEqual(0.45);
  });

  it("should not go below 1 for the temperature factor", () => {
    const irradianceWM2 = 500;
    const temperatureC = 5;
    const result = getSolarOutputFactor(irradianceWM2, temperatureC);
    expect(result).toEqual(0.5);
  });

  it("should correctly handle negative temperatures", () => {
    const irradianceWM2 = 500;
    const temperatureC = -10;
    const result = getSolarOutputFactor(irradianceWM2, temperatureC);
    expect(result).toEqual(0.5);
  });
});

describe("getWindCapacityFactor", () => {
  it("should correctly handle empty case", () => {
    const windSpeedsKph: number[] = [];
    const result = getWindCapacityFactor(windSpeedsKph);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
  it("should correctly calculate the average wind capacity factor", () => {
    const windSpeedsKph = [5, 10, 15, 20, 25];
    const result = getWindCapacityFactor(windSpeedsKph);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
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
  it("should correctly handle empty case", () => {
    const irradiancesWM2: number[] = [];
    const result = getSolarCapacityFactor(irradiancesWM2);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
  it("should correctly calculate the average solar capacity factor", () => {
    const irradiancesWM2 = [500, 1000, 1000, 500, 0];
    const result = getSolarCapacityFactor(irradiancesWM2);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
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
      { fuel: "Natural Gas" },
      { fuel: "Sun" },
    ]);
    expect(result).toEqual([
      "Sun",
      "Wind",
      "Offshore Wind",
      "Coal",
      "Natural Gas",
    ]);
  });

  it("should skip storage, which has no fuel", () => {
    const result = getDispatchOrderedFuels([{}, { fuel: "Coal" }, {}]);
    expect(result).toEqual(["Coal"]);
  });

  it("should handle an empty fleet", () => {
    expect(getDispatchOrderedFuels([])).toEqual([]);
  });
});
