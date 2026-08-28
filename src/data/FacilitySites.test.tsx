import { FacilityOperatingType, LocationType } from "../Types";
import {
  getViableLocationCount,
  getViableLocationsRemaining,
  PUMPED_HYDRO_SITES_BY_LOCATION,
} from "./FacilitySites";

const location = (id: string, resources?: LocationType["resources"]) =>
  ({ id, name: id, lat: 0, long: 0, resources }) as LocationType;

describe("finite facility sites", () => {
  it("has a researched pumped-hydro count for every currently playable location", () => {
    expect(Object.keys(PUMPED_HYDRO_SITES_BY_LOCATION)).toHaveLength(41);
    expect(getViableLocationCount(location("Memphis"), "Pumped Hydro")).toBe(1);
    expect(getViableLocationCount(location("Chicago"), "Pumped Hydro")).toBe(0);
    expect(getViableLocationCount(location("Reykjavik"), "Pumped Hydro")).toBe(
      648,
    );
  });

  it("keeps pumped hydro separate from conventional hydro geography", () => {
    expect(getViableLocationCount(location("Berlin"), "Pumped Hydro")).toBe(2);
    expect(getViableLocationCount(location("Berlin"), "Hydro")).toBe(0);
    expect(
      getViableLocationCount(location("Chicago", { hydro: true }), "Hydro"),
    ).toBe(3);
    expect(
      getViableLocationCount(
        location("Chicago", { hydro: true }),
        "Pumped Hydro",
      ),
    ).toBe(0);
  });

  it("counts owned and under-construction projects as claimed sites", () => {
    const facilities = [
      { name: "Geothermal" },
      { name: "Enhanced Geothermal" },
      { name: "Geothermal", yearsToBuildLeft: 2 },
    ] as FacilityOperatingType[];

    expect(
      getViableLocationsRemaining(
        location("Local", { geothermal: true }),
        facilities,
        "Geothermal",
      ),
    ).toBe(2);
  });

  it("does not impose a site count on ordinary or enhanced technologies", () => {
    expect(
      getViableLocationCount(location("Paris"), "Battery"),
    ).toBeUndefined();
    expect(
      getViableLocationCount(location("Paris"), "Enhanced Geothermal"),
    ).toBeUndefined();
  });
});
