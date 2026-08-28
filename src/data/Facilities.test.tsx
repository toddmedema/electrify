import { GENERATORS, STORAGE } from "./Facilities";
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

  it("only counts conventional plants for conventional geothermal scarcity", () => {
    const baseline = generatorAt(iceland, 2030, "Geothermal");
    const withEnhanced = generatorAt(iceland, 2030, "Geothermal", [
      geothermalFacility("Enhanced Geothermal"),
    ]);
    const withConventional = generatorAt(iceland, 2030, "Geothermal", [
      geothermalFacility("Geothermal"),
    ]);

    expect(withEnhanced?.buildCost).toBe(baseline?.buildCost);
    expect(withConventional?.buildCost).toBe(
      (baseline?.buildCost as number) * 1.25,
    );
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
