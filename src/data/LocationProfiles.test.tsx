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
  admin?: string,
): LocationType => ({
  id: country.replace(/\W/g, ""),
  name: country,
  lat: 0,
  long: 0,
  country,
  region,
  resources,
  admin,
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

  it("profiles US resources by state instead of treating the whole country alike", () => {
    const california = location(
      "United States",
      "North America",
      undefined,
      "CA",
    );
    const ohio = location("United States", "North America", undefined, "OH");
    expect(hasHydroResource(california)).toBe(true);
    expect(hasGeothermalResource(california)).toBe(true);
    expect(hasHydroResource(ohio)).toBe(false);
    expect(hasGeothermalResource(ohio)).toBe(false);
  });

  it("still lets a city override its US state profile", () => {
    const local = location(
      "United States",
      "North America",
      { geothermal: true, hydro: false },
      "NY",
    );
    expect(hasGeothermalResource(local)).toBe(true);
    expect(hasHydroResource(local)).toBe(false);
  });
});
