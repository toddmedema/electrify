import { validBuildFacility, validRetrofitFacility } from "./BuildValidation";

function generator(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test",
    description: "A test plant",
    available: true,
    buildCost: 1_000_000,
    annualOperatingCost: 10_000,
    peakW: 1_000_000,
    lifespanYears: 30,
    yearsToBuild: 1,
    fuel: "Natural Gas",
    maxPeakW: 10_000_000,
    capacityFactor: 0.5,
    spinMinutes: 10,
    btuPerWh: 7,
    ...overrides,
  };
}

const valid = (facility: Record<string, unknown>) =>
  validBuildFacility({ facility, financed: false });

describe("validBuildFacility weather resilience", () => {
  it("accepts quotes with and without resilience", () => {
    expect(valid(generator())).toBe(true);
    expect(
      valid(
        generator({
          resilience: { coldWeatherPackage: true, designMinTempC: -30 },
          resilienceExtraBuildCost: 20_000,
        }),
      ),
    ).toBe(true);
    expect(
      valid(generator({ fuel: "Sun", resilience: { hailResistant: true } })),
    ).toBe(true);
  });

  it("rejects hardening on the wrong technology", () => {
    expect(valid(generator({ resilience: { hailResistant: true } }))).toBe(
      false,
    );
    expect(
      valid(
        generator({ fuel: "Sun", resilience: { coldWeatherPackage: true } }),
      ),
    ).toBe(false);
    expect(
      valid(generator({ fuel: "Sun", resilience: { designMinTempC: -20 } })),
    ).toBe(false);
    expect(
      valid(generator({ fuel: "Wind", resilience: { hailResistant: false } })),
    ).toBe(false);
  });

  it("rejects malformed values", () => {
    expect(valid(generator({ resilience: "yes" }))).toBe(false);
    expect(valid(generator({ resilience: null }))).toBe(false);
    expect(valid(generator({ resilience: { coldWeatherPackage: 1 } }))).toBe(
      false,
    );
    [-61, 1, Number.NaN, "cold"].forEach((designMinTempC) => {
      expect(valid(generator({ resilience: { designMinTempC } }))).toBe(false);
    });
    expect(valid(generator({ resilience: { extra: true } }))).toBe(false);
    expect(valid(generator({ resilienceExtraBuildCost: -1 }))).toBe(false);
    expect(valid(generator({ resilienceExtraBuildCost: 2_000_000 }))).toBe(
      false,
    );
  });
});

describe("validRetrofitFacility", () => {
  it("accepts a facility id and a known upgrade", () => {
    expect(
      validRetrofitFacility({ facilityId: 3, upgrade: "hailResistant" }),
    ).toBe(true);
    expect(
      validRetrofitFacility({ facilityId: 0, upgrade: "coldWeatherPackage" }),
    ).toBe(true);
  });

  it("rejects anything else", () => {
    [
      undefined,
      null,
      "hailResistant",
      { facilityId: 3 },
      { facilityId: -1, upgrade: "hailResistant" },
      { facilityId: 1.5, upgrade: "hailResistant" },
      { facilityId: "3", upgrade: "hailResistant" },
      { facilityId: 3, upgrade: "floodWall" },
    ].forEach((payload) => {
      expect(validRetrofitFacility(payload)).toBe(false);
    });
  });
});
