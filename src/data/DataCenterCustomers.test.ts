import { LOCATIONS } from "../Constants";
import { LocationType } from "../Types";
import { REGION_ORDER } from "./Cities";
import { getDataCenterCustomerProfile } from "./DataCenterCustomers";

describe("data-center customer source boundaries", () => {
  it("uses electricity accounts instead of population or combined utility accounts", () => {
    expect(getDataCenterCustomerProfile(LOCATIONS.HNL)).toMatchObject({
      customers: 309839,
      sourceYear: 2024,
      basis: "local-utility",
      serviceArea: "Hawaiian Electric, Oahu",
    });
    expect(
      getDataCenterCustomerProfile({ ...LOCATIONS.PIT, id: "Dubai" }).customers,
    ).toBe(1225639);
  });

  it("does not apply a city's utility count to another city in the same state", () => {
    const sanFrancisco = getDataCenterCustomerProfile(LOCATIONS.SF);
    const otherCalifornia = getDataCenterCustomerProfile({
      ...LOCATIONS.SF,
      id: "UnresearchedCaliforniaCity",
      name: "Another California city",
    });
    expect(sanFrancisco.basis).toBe("local-utility");
    expect(otherCalifornia.basis).toBe("reference-utility");
    expect(otherCalifornia.note).toContain(
      "not an estimate for Another California city",
    );
    expect(otherCalifornia.customers).not.toBe(sanFrancisco.customers);
  });

  it.each(REGION_ORDER)(
    "identifies a sourced reference for %s without claiming local research",
    (region) => {
      const profile = getDataCenterCustomerProfile({
        ...LOCATIONS.PIT,
        id: "UnresearchedCity",
        name: "Unresearched city",
        region,
      });
      expect(profile.basis).toBe("reference-utility");
      expect(profile.customers).toBeGreaterThan(0);
      expect(Number.isInteger(profile.customers)).toBe(true);
      expect(profile.sourceUrl).toMatch(/^https:\/\//);
      expect(profile.note).toContain(profile.serviceArea);
      expect(profile.note).toContain("No verified local account count");
    },
  );
});

test("Las Vegas uses its own utility instead of the North America example", () => {
  expect(
    getDataCenterCustomerProfile({
      ...LOCATIONS.PIT,
      id: "LasVegas",
      name: "Las Vegas, NV",
    }),
  ).toMatchObject({
    basis: "local-utility",
    serviceArea: "NV Energy (Nevada Power), southern Nevada",
    customers: 1035139,
    sourceYear: 2024,
  });
});

test("every catalog location has a well-formed customer profile", () => {
  const {
    cities,
  }: {
    cities: Record<string, LocationType & { region: string }>;
  } = require("../../public/data/weather/index.json");
  const profiles = Object.values(cities).map(getDataCenterCustomerProfile);
  profiles.forEach((profile) => {
    expect(Number.isInteger(profile.customers)).toBe(true);
    expect(profile.customers).toBeGreaterThan(0);
    expect(profile.sourceUrl).toMatch(/^https?:\/\//);
    expect(profile.serviceArea).not.toMatch(/[^\x20-\x7e]|\.$/);
  });
  const local = profiles.filter(({ basis }) => basis === "local-utility");
  expect(local.length).toBeGreaterThan(profiles.length / 2);
  local.forEach(({ note }) => expect(note.length).toBeLessThanOrEqual(140));
  local
    .filter(({ annualMWh }) => annualMWh)
    .forEach(({ annualMWh, customers, energySourceYear }) => {
      expect(energySourceYear).toBeDefined();
      // Retail sales per account stay between a few hundred kWh and a few hundred MWh.
      expect(annualMWh! / customers).toBeGreaterThan(0.3);
      expect(annualMWh! / customers).toBeLessThan(200);
    });
});
