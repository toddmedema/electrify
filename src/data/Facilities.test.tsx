import {
  airborneWindCostPerW,
  airborneWindMaxPeakW,
  GENERATORS,
  STORAGE,
} from "./Facilities";
import { getDateFromMinute } from "../helpers/DateTime";
import { FacilityOperatingType, GameType, LocationType } from "../Types";

function stateAt(
  location: LocationType,
  year = 2020,
  facilities: FacilityOperatingType[] = [],
): GameType {
  return {
    date: getDateFromMinute(0, year),
    startingYear: year,
    difficulty: "CEO",
    feePerKgCO2e: 0,
    seed: 1,
    facilities,
    location,
  } as unknown as GameType;
}

function geothermalFacility(name: string): FacilityOperatingType {
  return { name, fuel: "Geothermal" } as FacilityOperatingType;
}

const iceland: LocationType = {
  id: "Reykjavik",
  name: "Reykjavik, Iceland",
  lat: 64.1466,
  long: -21.9426,
  region: "Europe",
  country: "Iceland",
};

const france: LocationType = {
  id: "Paris",
  name: "Paris, France",
  lat: 48.8566,
  long: 2.3522,
  region: "Europe",
  country: "France",
};

const newYork: LocationType = {
  id: "NewYork",
  name: "New York, NY",
  lat: 40.7128,
  long: -74.006,
  region: "North America",
  country: "United States",
  offshore: true,
};

function generatorAt(
  year: number,
  name: string,
  peakW: number,
  location: LocationType = france,
) {
  return GENERATORS(stateAt(location, year), peakW, [], []).find(
    (generator) => generator.name === name,
  );
}

describe("current facility economics", () => {
  it.each([
    ["Coal", 2023, 650000000, 4.103],
    ["Nuclear", 2023, 2156000000, 7.861],
    ["Natural Gas", 2023, 419000000, 0.836],
    ["Oil", 2023, 3000000, 1.248],
    ["Wind", 2024, 200000000, 1.041],
    ["Solar", 2024, 150000000, 0.691],
    ["Hydro", 2024, 100000000, 2.267],
    ["Geothermal", 2024, 50000000, 4.015],
  ])(
    "prices a reference-sized %s plant at its published benchmark",
    (name, year, peakW, dollarsPerW) => {
      const location =
        name === "Hydro" || name === "Geothermal" ? iceland : france;
      expect(
        generatorAt(year as number, name as string, peakW as number, location)
          ?.buildCost,
      ).toBeCloseTo((peakW as number) * (dollarsPerW as number), -2);
    },
  );

  it("uses the latest battery cost, duration, life, and augmentation O&M", () => {
    const battery = STORAGE(stateAt(france, 2024), 600000000).find(
      (facility) => facility.name === "Battery",
    );

    expect(battery).toMatchObject({
      peakW: 150000000,
      lifespanYears: 20,
      annualOperatingCost: 6000000,
      roundTripEfficiency: 0.85,
    });
    expect(battery?.buildCost).toBeCloseTo(115210000, -2);
    expect(battery?.yearsToBuild).toBeCloseTo(1.5, 2);
  });

  it("uses the 2024 ATB midpoint for ten-hour pumped hydro", () => {
    const pumpedHydro = STORAGE(stateAt(iceland, 2024), 1000000000).find(
      (facility) => facility.name === "Pumped Hydro",
    );

    expect(pumpedHydro).toMatchObject({
      peakW: 100000000,
      annualOperatingCost: 1900000,
      roundTripEfficiency: 0.8,
      viableLocationsRemaining: 648,
    });
    expect(pumpedHydro?.buildCost).toBeCloseTo(333900000, -2);
  });
});

describe("real technology cost trends", () => {
  it.each(["Wind", "Solar"])(
    "models the observed 2020-2024 decline for %s",
    (name) => {
      const peakW = name === "Wind" ? 200000000 : 150000000;
      expect(generatorAt(2024, name, peakW)?.buildCost).toBeLessThan(
        generatorAt(2020, name, peakW)?.buildCost as number,
      );
    },
  );

  it("models falling battery costs and rising nuclear costs", () => {
    const battery2020 = STORAGE(stateAt(france, 2020), 600000000).find(
      (facility) => facility.name === "Battery",
    );
    const battery2024 = STORAGE(stateAt(france, 2024), 600000000).find(
      (facility) => facility.name === "Battery",
    );

    expect(battery2024?.buildCost).toBeLessThan(
      battery2020?.buildCost as number,
    );
    expect(generatorAt(2023, "Nuclear", 2156000000)?.buildCost).toBeGreaterThan(
      generatorAt(2019, "Nuclear", 2156000000)?.buildCost as number,
    );
  });

  it("floors wind and solar at the end of the published 2029 outlook", () => {
    for (const [name, peakW] of [
      ["Wind", 200000000],
      ["Solar", 150000000],
    ] as const) {
      expect(generatorAt(2050, name, peakW)?.buildCost).toBe(
        generatorAt(2029, name, peakW)?.buildCost,
      );
    }
  });
});

describe("location-aware facilities", () => {
  it("offers geothermal and hydro in a resource-rich region", () => {
    const state = stateAt(iceland);
    const fuels = GENERATORS(state, 100000000, [], []).map((g) => g.fuel);
    const storage = STORAGE(state, 500000000).map((s) => s.name);
    expect(fuels).toContain("Geothermal");
    expect(fuels).toContain("Hydro");
    expect(storage).toContain("Pumped Hydro");
  });

  it("does not offer site-dependent technologies without the resource", () => {
    const state = stateAt(france);
    const fuels = GENERATORS(state, 100000000, [], []).map((g) => g.fuel);
    const storage = STORAGE(state, 500000000).map((s) => s.name);
    expect(fuels).not.toContain("Geothermal");
    expect(fuels).not.toContain("Hydro");
    expect(storage).not.toContain("Pumped Hydro");
  });

  it("uses an explicit conventional hydro site limit without changing its benchmark cost", () => {
    const baseline = GENERATORS(stateAt(iceland, 2024), 100000000, [], []).find(
      (generator) => generator.name === "Hydro",
    );
    const withExisting = GENERATORS(
      stateAt(iceland, 2024, [
        { name: "Hydro", fuel: "Hydro" } as FacilityOperatingType,
      ]),
      100000000,
      [],
      [],
    ).find((generator) => generator.name === "Hydro");

    expect(baseline?.viableLocationsRemaining).toBe(3);
    expect(withExisting?.viableLocationsRemaining).toBe(2);
    expect(withExisting?.buildCost).toBeCloseTo(
      baseline?.buildCost as number,
      -2,
    );
  });
});

describe("enhanced geothermal", () => {
  const generatorAt = (
    location: LocationType,
    year: number,
    name: string,
    facilities: FacilityOperatingType[] = [],
  ) =>
    GENERATORS(stateAt(location, year, facilities), 100000000, [], []).find(
      (generator) => generator.name === name,
    );

  it("unlocks in 2030 in locations without conventional geothermal", () => {
    expect(generatorAt(france, 2029, "Enhanced Geothermal")).toBeUndefined();
    expect(generatorAt(france, 2030, "Geothermal")).toBeUndefined();
    expect(generatorAt(france, 2030, "Enhanced Geothermal")).toBeDefined();
  });

  it("offers both geothermal technologies in resource-rich locations", () => {
    const names = GENERATORS(stateAt(iceland, 2030), 100000000, [], []).map(
      (generator) => generator.name,
    );

    expect(names).toContain("Geothermal");
    expect(names).toContain("Enhanced Geothermal");
  });

  it("does not make enhanced geothermal more expensive as its fleet grows", () => {
    const baseline = generatorAt(france, 2030, "Enhanced Geothermal");
    const withExistingEnhanced = generatorAt(
      france,
      2030,
      "Enhanced Geothermal",
      [
        geothermalFacility("Enhanced Geothermal"),
        geothermalFacility("Enhanced Geothermal"),
      ],
    );

    expect(withExistingEnhanced?.buildCost).toBe(baseline?.buildCost);
  });

  it("only counts conventional plants against conventional geothermal sites", () => {
    const baseline = generatorAt(iceland, 2030, "Geothermal");
    const withEnhanced = generatorAt(iceland, 2030, "Geothermal", [
      geothermalFacility("Enhanced Geothermal"),
    ]);
    const withConventional = generatorAt(iceland, 2030, "Geothermal", [
      geothermalFacility("Geothermal"),
    ]);

    expect(withEnhanced?.buildCost).toBe(baseline?.buildCost);
    expect(withConventional?.buildCost).toBe(baseline?.buildCost);
    expect(baseline?.viableLocationsRemaining).toBe(4);
    expect(withEnhanced?.viableLocationsRemaining).toBe(4);
    expect(withConventional?.viableLocationsRemaining).toBe(3);
  });

  it("uses the 2030 cost and performance assumptions", () => {
    const generator = generatorAt(france, 2030, "Enhanced Geothermal");

    expect(generator).toMatchObject({
      fuel: "Geothermal",
      annualOperatingCost: 16000000,
      capacityFactor: 0.83,
      maxPeakW: 500000000,
      yearsToBuild: 3.5,
      lifespanYears: 30,
    });
    expect(generator?.buildCost).toBeCloseTo(463000000, -6);
  });
});

describe("offshore wind", () => {
  const generatorAt = (
    location: LocationType,
    year: number,
    peakW = 900000000,
  ) =>
    GENERATORS(stateAt(location, year), peakW, [], [], [27]).find(
      (generator) => generator.name === "Offshore Wind",
    );

  it("unlocks after Vindeby only where offshore weather exists", () => {
    expect(generatorAt(newYork, 1991)).toBeUndefined();
    expect(generatorAt(newYork, 2000)).toBeDefined();
    expect(generatorAt(france, 2023)).toBeUndefined();
  });

  it("matches the 2023 EIA reference plant assumptions", () => {
    const generator = generatorAt(newYork, 2023);
    expect(generator).toMatchObject({
      fuel: "Offshore Wind",
      annualOperatingCost: 138600000,
      maxPeakW: 1500000000,
      lifespanYears: 25,
    });
    expect((generator?.buildCost as number) / 900000).toBeCloseTo(3689, -1);
    expect(generator?.capacityFactor).toBeGreaterThan(0.4);
  });

  it("peaks in cost around 2010 instead of rising monotonically backwards", () => {
    const cost2000 = generatorAt(newYork, 2000)?.buildCost as number;
    const cost2010 = generatorAt(newYork, 2010)?.buildCost as number;
    const cost2023 = generatorAt(newYork, 2023)?.buildCost as number;
    expect(cost2010).toBeGreaterThan(cost2000);
    expect(cost2010).toBeGreaterThan(cost2023);
  });
});

describe("airborne wind", () => {
  const generatorAt = (year: number, peakW = 1200000) =>
    GENERATORS(stateAt(france, year), peakW, [], [], [], [11 * 3.6]).find(
      (generator) => generator.name === "Airborne Wind",
    );

  it("stays locked through 2029 and unlocks in 2030", () => {
    expect(generatorAt(2029)).toBeUndefined();
    expect(generatorAt(2030)).toBeDefined();
  });

  it("anchors source-sized construction cost in 2028 and 2035", () => {
    expect(airborneWindCostPerW(2028) * 1200000).toBeCloseTo(8400000, -2);
    expect(generatorAt(2035)?.buildCost).toBeCloseTo(4920000, -2);
    expect(airborneWindCostPerW(2050)).toBe(airborneWindCostPerW(2035));
  });

  it("uses early-commercial operating and build assumptions", () => {
    const generator = generatorAt(2030);
    expect(generator).toMatchObject({
      fuel: "Airborne Wind",
      annualOperatingCost: 61680,
      btuPerWh: 0,
      lifespanYears: 25,
      spinMinutes: 1,
    });
    expect(generator?.capacityFactor).toBeCloseTo(0.888, 3);
    expect(generator?.yearsToBuild).toBeCloseTo(2.026, 3);
  });

  it("grows modular arrays from the 1.2MW anchor to a 500MW cap", () => {
    expect(airborneWindMaxPeakW(2028)).toBe(1200000);
    expect(airborneWindMaxPeakW(2030)).toBe(2400000);
    expect(airborneWindMaxPeakW(2032)).toBe(4800000);
    expect(airborneWindMaxPeakW(2050)).toBe(500000000);
  });
});

describe("biomass", () => {
  it("offers a priced, dispatchable 50 MW reference plant", () => {
    const generator = GENERATORS(stateAt(france, 2019), 50000000, [], []).find(
      (candidate) => candidate.name === "Biomass",
    );

    expect(generator).toMatchObject({
      fuel: "Biomass",
      annualOperatingCost: 7235500,
      btuPerWh: 13.3,
      capacityFactor: 0.602,
      maxPeakW: 50000000,
      spinMinutes: 240,
      yearsToBuild: 5,
      lifespanYears: 30,
    });
    expect(generator?.buildCost).toBe(188870594);
  });

  it("is available in every location", () => {
    [iceland, france].forEach((location) => {
      expect(
        GENERATORS(stateAt(location, 1980), 10000000, [], []).some(
          (generator) => generator.name === "Biomass",
        ),
      ).toBe(true);
    });
  });
});
