import * as fs from "fs";
import * as path from "path";
import { LOCATIONS } from "../Constants";
import type { CityType } from "./Cities";
import { LocationType } from "../Types";

const INDEX_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "weather",
  "index.json",
);

// The module caches the index for the session, which is the point of it - so each test gets its
// own copy of the module rather than the one the last test already resolved
async function freshCities() {
  jest.resetModules();
  return import("./Cities");
}

function respondWith(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

const REMOTE = {
  cities: {
    Nairobi: {
      id: "Nairobi",
      name: "Nairobi, Kenya",
      region: "Africa",
      lat: -1.2921,
      long: 36.8219,
      timeZone: "Africa/Nairobi",
    },
    Auckland: {
      id: "Auckland",
      name: "Auckland, New Zealand",
      region: "Oceania",
      lat: -36.8485,
      long: 174.7633,
      timeZone: "Pacific/Auckland",
    },
    Berlin: {
      id: "Berlin",
      name: "Berlin, Germany",
      region: "Europe",
      admin: "BE",
      lat: 52.52,
      long: 13.405,
      timeZone: "Europe/Berlin",
    },
  },
};

describe("getCities", () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    error.mockRestore();
  });

  it("offers the bundled locations before anything has been downloaded", async () => {
    const { getCities } = await freshCities();
    expect(
      getCities()
        .map((c: CityType) => c.id)
        .sort(),
    ).toEqual(Object.keys(LOCATIONS).sort());
  });

  it("adds the downloaded cities, grouped by region in reading order", async () => {
    respondWith(REMOTE);
    const { getCities, initCities, REGION_ORDER } = await freshCities();
    await initCities();

    const ids = getCities().map((c: CityType) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["PIT", "Nairobi", "Auckland"]));
    // Adjacent-region grouping is what the picker's headings rely on: regions come in the order
    // above, and cities are alphabetical inside each one
    const ranks = getCities().map((c: CityType) =>
      REGION_ORDER.indexOf(c.region),
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const africa = getCities().filter((c: CityType) => c.region === "Africa");
    expect(africa.map((c: CityType) => c.name)).toEqual(["Nairobi, Kenya"]);
    expect(getCities().find((c: CityType) => c.id === "Berlin")?.admin).toBe(
      "BE",
    );
  });

  it("downloads the index once however many screens ask for it", async () => {
    respondWith(REMOTE);
    const { initCities } = await freshCities();
    await Promise.all([initCities(), initCities()]);
    await initCities();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bundled locations rather than emptying the picker", async () => {
    respondWith({}, false);
    const { getCities, initCities } = await freshCities();
    await initCities();
    expect(getCities().length).toEqual(Object.keys(LOCATIONS).length);
    expect(error).toHaveBeenCalled();
  });

  it("drops entries that could not be played", async () => {
    // A location without coordinates would reach suncalc as undefined and come back with a
    // sunrise of NaN, which is a game where the sun never rises rather than an error
    respondWith({
      cities: {
        Nowhere: { id: "Nowhere", name: "Nowhere", region: "Europe" },
        Berlin: REMOTE.cities.Berlin,
      },
    });
    const { getCities, initCities } = await freshCities();
    await initCities();
    expect(getCities().map((c: CityType) => c.id)).not.toContain("Nowhere");
    expect(getCities().map((c: CityType) => c.id)).toContain("Berlin");
  });
});

// The bundled six exist so the authored scenarios can resolve their location before any download
// has happened. They are a copy of what the index says, and a copy that has drifted is a game
// whose sun rises at the wrong time until the index lands and quietly moves it.
describe("the bundled locations", () => {
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));

  it.each(Object.keys(LOCATIONS))("%s matches the shipped index", (id) => {
    const bundled = LOCATIONS[id] as LocationType;
    const shipped = index.cities[id];
    expect(shipped).toBeDefined();
    expect(shipped.name).toEqual(bundled.name);
    expect(shipped.admin).toEqual(
      (bundled as LocationType & { admin?: string }).admin,
    );
    expect(shipped.timeZone).toEqual(bundled.timeZone);
    expect(shipped.lat).toBeCloseTo(bundled.lat, 3);
    expect(shipped.long).toBeCloseTo(bundled.long, 3);
  });
});
