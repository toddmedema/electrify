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
      "No hydro sites near Houston in this game.",
    );
  });

  test("explains that every site has been claimed", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      location: withHydro,
      viableLocationsRemaining: 0,
    });
    expect(result.buildable).toBe(false);
    expect(result.secondaryText).toBe("You've used all 3 sites near Madrid.");
  });

  test("pumped hydro names itself in the reason", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      name: "Pumped Hydro",
      available: false,
      location: withHydro,
      viableLocationsRemaining: 0,
    });
    expect(result.secondaryText).toBe(
      "No pumped hydro sites near Madrid in this game.",
    );
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
  expect(siteCountLabel({ remaining: 1, total: 3 })).toBe("Last site left");
});
