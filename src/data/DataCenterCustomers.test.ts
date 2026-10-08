import { LOCATIONS } from "../Constants";
import { LocationType } from "../Types";
import { REGION_ORDER } from "./Cities";
import { loadDataCenterCustomerSources } from "../testing/SimData";
import {
  DATA_CENTER_CUSTOMERS_URL,
  getDataCenterCustomerProfile as getProfile,
  initDataCenterCustomers,
  parseDataCenterCustomerSources,
} from "./DataCenterCustomers";

const getDataCenterCustomerProfile = (location: LocationType) =>
  getProfile(location, loadDataCenterCustomerSources());

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
  const profiles = Object.values(cities).map((city) =>
    getDataCenterCustomerProfile(city),
  );
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

test("rejects malformed sources and a missing regional reference", () => {
  const sources = loadDataCenterCustomerSources();
  expect(() => parseDataCenterCustomerSources({})).toThrow("no sources");
  expect(() =>
    parseDataCenterCustomerSources({
      sources: { ...sources, PIT: { ...sources.PIT, customers: 1.5 } },
    }),
  ).toThrow("PIT");
  const { Sydney, ...withoutOceania } = sources;
  expect(Sydney).toBeDefined();
  expect(() =>
    parseDataCenterCustomerSources({ sources: withoutOceania }),
  ).toThrow("missing regional customer reference Sydney");
});

test("downloads the sources once and retries after a failed download", async () => {
  const data = { sources: loadDataCenterCustomerSources() };
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValue({ ok: true, json: () => Promise.resolve(data) });
  const originalFetch = global.fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  try {
    await expect(initDataCenterCustomers()).rejects.toThrow("503");
    await expect(initDataCenterCustomers()).resolves.toEqual(data.sources);
    await initDataCenterCustomers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(DATA_CENTER_CUSTOMERS_URL);
  } finally {
    global.fetch = originalFetch;
  }
});
