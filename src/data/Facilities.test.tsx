import { GENERATORS, STORAGE } from "./Facilities";
import { getDateFromMinute } from "../helpers/DateTime";
import { GameType, LocationType } from "../Types";

function stateAt(location: LocationType): GameType {
  return {
    date: getDateFromMinute(0, 2020),
    difficulty: "Employee",
    feePerKgCO2e: 0,
    seed: 1,
    facilities: [],
    location,
  } as unknown as GameType;
}

const iceland: LocationType = {
  id: "Reykjavik",
  name: "Reykjavik, Iceland",
  lat: 64.1466,
  long: -21.9426,
  region: "Europe",
  country: "Iceland",
};

const france: LocationType = {
  id: "Paris",
  name: "Paris, France",
  lat: 48.8566,
  long: 2.3522,
  region: "Europe",
  country: "France",
};

describe("location-aware facilities", () => {
  it("offers geothermal and hydro in a resource-rich region", () => {
    const state = stateAt(iceland);
    const fuels = GENERATORS(state, 100000000, [], []).map((g) => g.fuel);
    const storage = STORAGE(state, 500000000).map((s) => s.name);
    expect(fuels).toContain("Geothermal");
    expect(fuels).toContain("Hydro");
    expect(storage).toContain("Pumped Hydro");
  });

  it("does not offer site-dependent technologies without the resource", () => {
    const state = stateAt(france);
    const fuels = GENERATORS(state, 100000000, [], []).map((g) => g.fuel);
    const storage = STORAGE(state, 500000000).map((s) => s.name);
    expect(fuels).not.toContain("Geothermal");
    expect(fuels).not.toContain("Hydro");
    expect(storage).not.toContain("Pumped Hydro");
  });
});
