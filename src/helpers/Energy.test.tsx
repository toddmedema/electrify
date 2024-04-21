import {
  getSolarOutputFactor,
  getWindOutputFactor,
  getSolarCapacityFactor,
  getWindCapacityFactor,
} from "./Energy";

describe("getWindOutputFactor", () => {
  it("should return 0 for wind speeds less than 3 m/s", () => {
    const windKph = 2;
    const result = getWindOutputFactor(windKph);
    expect(result).toEqual(0);
  });

  it("should return 0 for wind speeds greater than 25 m/s", () => {
    const windKph = 100;
    const result = getWindOutputFactor(windKph);
    expect(result).toEqual(0);
  });

  it("should correctly calculate the wind output factor for wind speeds between 3 and 14 m/s", () => {
    const windKph = 20;
    const result = getWindOutputFactor(windKph);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
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
    const windSpeedsKph = [] as any;
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

describe("getSolarCapacityFactor", () => {
  it("should correctly handle empty case", () => {
    const irradiancesWM2 = [] as any;
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
