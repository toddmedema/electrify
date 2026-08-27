import {
  getStartingCustomers,
  hasGeothermalResource,
  hasHydroResource,
} from "./LocationProfiles";
import { LocationType } from "../Types";

const location = (
  country: string,
  region: string,
  resources?: LocationType["resources"],
): LocationType => ({
  id: country.replace(/\W/g, ""),
  name: country,
  lat: 0,
  long: 0,
  country,
  region,
  resources,
});

describe("location profiles", () => {
  it("starts grids at different regional scales", () => {
    expect(
      getStartingCustomers(location("Japan", "East Asia")),
    ).toBeGreaterThan(getStartingCustomers(location("Kenya", "Africa")));
  });

  it("recognises regional geothermal and hydro resources", () => {
    const iceland = location("Iceland", "Europe");
    expect(hasGeothermalResource(iceland)).toBe(true);
    expect(hasHydroResource(iceland)).toBe(true);
    expect(hasGeothermalResource(location("France", "Europe"))).toBe(false);
  });

  it("lets explicit local knowledge override the country profile", () => {
    const dry = location("Iceland", "Europe", {
      geothermal: false,
      hydro: false,
    });
    expect(hasGeothermalResource(dry)).toBe(false);
    expect(hasHydroResource(dry)).toBe(false);
  });
});
