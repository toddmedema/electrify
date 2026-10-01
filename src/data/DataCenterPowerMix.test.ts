import { LOCATIONS } from "../Constants";
import { LocationType } from "../Types";
import { getDataCenterPowerMix } from "./DataCenterPowerMix";

test("California uses actual state capacity including distributed solar", () => {
  const mix = getDataCenterPowerMix(LOCATIONS.SF, 2026);
  expect(mix).toMatchObject({
    geography: "California",
    scope: "state",
    year: 2024,
    basis: "capacity",
  });
  expect(mix.shares.Sun).toBeGreaterThan(mix.shares["Natural Gas"]!);
  expect(mix.shares.Hydro).toBeGreaterThan(0);
  expect(mix.shares.Uranium).toBeGreaterThan(0);
});

test("historical starts use historical observations and future starts freeze latest data", () => {
  const old = getDataCenterPowerMix(LOCATIONS.SF, 2010);
  const current = getDataCenterPowerMix(LOCATIONS.SF, 2050);
  expect(old.year).toBe(2010);
  expect(current.year).toBe(2024);
  expect(old.shares.Sun).toBeLessThan(current.shares.Sun!);
});

test("IRENA restores omitted geothermal capacity without relabeling other fuels", () => {
  const iceland = getDataCenterPowerMix(
    { ...LOCATIONS.SF, country: "Iceland" },
    2026,
  );
  const kenya = getDataCenterPowerMix(
    { ...LOCATIONS.SF, country: "Kenya" },
    2026,
  );
  expect(iceland.shares.Geothermal).toBeCloseTo(788 / (2210 + 788));
  expect(kenya.shares.Geothermal).toBeCloseTo(940 / (2620 + 940));
  expect(iceland.geothermalSourceUrl).toContain("2025");
  expect(
    getDataCenterPowerMix({ ...LOCATIONS.SF, country: "Iceland" }, 2010)
      .geothermalSourceUrl,
  ).toContain("2020");
  expect(
    getDataCenterPowerMix(LOCATIONS.SF).geothermalSourceUrl,
  ).toBeUndefined();
});

test("possible overlap with Other Renewables never double-counts geothermal", () => {
  const austria = getDataCenterPowerMix(
    { ...LOCATIONS.SF, country: "Austria" },
    2010,
  );
  // Source observations: 21,960 MW Ember total including 240 MW Other
  // Renewables; IRENA geothermal is 1 MW. Reconciliation keeps 239 MW unknown.
  expect(austria.reconciledGeothermal).toBe(true);
  expect(austria.shares.Geothermal).toBeCloseTo(1 / 21960, 10);
  expect(austria.unsupportedShare).toBeCloseTo(239 / 21960, 10);
  expect(
    getDataCenterPowerMix(LOCATIONS.SF).reconciledGeothermal,
  ).toBeUndefined();
});

test("all bundled countries have nonempty normalized observations with explicit scope", () => {
  const cities: {
    cities: Record<string, LocationType>;
  } = require("../../public/data/weather/index.json");
  Object.values(cities.cities).forEach((location) => {
    for (let year = 2010; year <= 2050; year++) {
      const mix = getDataCenterPowerMix(location, year);
      expect(mix.scope).not.toBe("world");
      expect(
        Object.values(mix.shares).reduce((sum, value) => sum + value, 0) +
          mix.unsupportedShare,
      ).toBeCloseTo(1, 10);
      expect(mix.year).toBeGreaterThanOrEqual(2010);
      expect(mix.year).toBeLessThanOrEqual(Math.min(year, 2024));
    }
  });
});

test("unknown places are explicitly world scope, and Puerto Rico has its own mix", () => {
  expect(
    getDataCenterPowerMix({ ...LOCATIONS.SF, country: "Unknown" }).scope,
  ).toBe("world");
  expect(getDataCenterPowerMix(LOCATIONS.SJU).geography).toBe("Puerto Rico");
});
