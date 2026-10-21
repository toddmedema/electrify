import { LOCATIONS } from "../Constants";
import { FuelNameType, LocationType } from "../Types";
import { getDataCenterPowerMix } from "./DataCenterPowerMix";
import { getStartingFacilityAge } from "./StartingFacilityAges";

const catalogue: {
  cities: Record<string, LocationType>;
} = require("../../public/data/weather/index.json");

test("every supported location and opening era has deterministic inherited technology ages", () => {
  for (const location of Object.values(catalogue.cities)) {
    for (let year = 2010; year < 2050; year++) {
      for (const fuel of Object.keys(
        getDataCenterPowerMix(location, year).shares,
      ) as FuelNameType[]) {
        const age = getStartingFacilityAge(location, fuel, year);
        expect(Number.isInteger(age.ageYears)).toBe(true);
        expect(age.ageYears).toBeGreaterThan(0);
        expect(age.ageYears).toBeLessThan(year - 1850);
        expect(age.geography).toBeTruthy();
        expect(age.knownCapacityShare ?? 1).toBeGreaterThan(0);
        expect(age.knownCapacityShare ?? 1).toBeLessThanOrEqual(1.000001);
        expect(getStartingFacilityAge(location, fuel, year)).toEqual(age);
      }
    }
  }
});

test("US state observations distinguish gas technologies and newer renewables", () => {
  const age = (
    fuel: FuelNameType,
    name?: "Natural Gas CC" | "Natural Gas Peaker",
  ) => getStartingFacilityAge(LOCATIONS.SF, fuel, 2026, name);
  expect(age("Natural Gas", "Natural Gas CC")).toMatchObject({
    scope: "state",
    geography: "CA",
    sourceYear: 2024,
  });
  expect(age("Natural Gas", "Natural Gas CC").ageYears).not.toBe(
    age("Natural Gas", "Natural Gas Peaker").ageYears,
  );
  expect(age("Sun").ageYears).toBeLessThan(age("Wind").ageYears);
  expect(age("Wind").ageYears).toBeLessThan(
    age("Natural Gas", "Natural Gas CC").ageYears,
  );
  expect(age("Hydro").ageYears).toBeGreaterThan(50);
});

test("sparse local commissioning records disclose broader estimates", () => {
  const uk = {
    ...LOCATIONS.SF,
    country: "United Kingdom",
    region: "Europe" as const,
  };
  expect(getStartingFacilityAge(uk, "Coal", 2026)).toMatchObject({
    scope: "region",
    geography: "Europe",
  });
  const unknown = {
    ...LOCATIONS.SF,
    country: "Unknown",
    region: "Unknown",
  } as LocationType;
  expect(getStartingFacilityAge(unknown, "Coal", 2026)).toMatchObject({
    scope: "world",
    geography: "World",
  });
  const solar = getStartingFacilityAge(uk, "Sun", 2026);
  expect(solar).toMatchObject({
    method: "capacity-history",
    scope: "country",
    geography: "United Kingdom",
    sourceYear: 2024,
  });
  expect(solar.knownCapacityShare).toBeUndefined();
});

test("historical cohorts exclude future plants while future starts keep the observed age profile", () => {
  expect(getStartingFacilityAge(LOCATIONS.SF, "Wind", 2010).ageYears).not.toBe(
    getStartingFacilityAge(LOCATIONS.SF, "Wind", 2026).ageYears,
  );
  for (const fuel of ["Coal", "Natural Gas", "Hydro", "Wind", "Sun"] as const) {
    expect(getStartingFacilityAge(LOCATIONS.SF, fuel, 2049)).toEqual(
      getStartingFacilityAge(LOCATIONS.SF, fuel, 2026),
    );
  }
});
