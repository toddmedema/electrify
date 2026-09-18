import { getBuildAvailability, siteCountLabel } from "./BuildAvailability";
import { LocationType } from "../../Types";

const withHydro: LocationType = {
  id: "Madrid",
  name: "Madrid, Spain",
  lat: 40.4,
  long: -3.7,
  region: "Europe",
  country: "Spain",
  resources: { hydro: true, geothermal: false },
};

const withoutHydro: LocationType = {
  ...withHydro,
  id: "Houston",
  name: "Houston, TX",
  resources: { hydro: false, geothermal: false },
};

const hydroOption = {
  name: "Hydro",
  description: "Hydro description",
  available: true,
  sizeBuildable: true,
  maxSizeLabel: "10GW",
};

describe("getBuildAvailability", () => {
  test("explains that a location without rivers has no dam sites", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      available: false,
      location: withoutHydro,
      viableLocationsRemaining: 0,
    });
    expect(result.buildable).toBe(false);
    expect(result.secondaryText).toBe(
      "No river near Houston is suited to a new dam.",
    );
  });

  test("explains that every site has been claimed", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      location: withHydro,
      viableLocationsRemaining: 0,
    });
    expect(result.buildable).toBe(false);
    expect(result.secondaryText).toBe(
      "All 3 sites near Madrid are in use by your projects.",
    );
  });

  test("pumped hydro names the terrain it needs", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      name: "Pumped Hydro",
      available: false,
      location: withHydro,
      viableLocationsRemaining: 0,
    });
    expect(result.secondaryText).toMatch(/height difference/);
  });

  test("a buildable option shows its description", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      location: withHydro,
      viableLocationsRemaining: 2,
    });
    expect(result).toEqual({
      buildable: true,
      secondaryText: "Hydro description",
    });
  });
});

test("site counts read as remaining of total", () => {
  expect(siteCountLabel({ remaining: 2, total: 3 })).toBe("2 of 3 sites left");
  expect(siteCountLabel({ remaining: 1, total: 1 })).toBe("1 of 1 site left");
});
