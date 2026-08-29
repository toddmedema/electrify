import { LOCATIONS } from "../Constants";
import {
  getLocation,
  getScenarioLocation,
  isValidLocation,
  isValidLocationId,
} from "./Locations";
import { LocationType, ScenarioType } from "../Types";

const ELSEWHERE: LocationType = {
  id: "REY",
  name: "Reykjavik, Iceland",
  lat: 64.1466,
  long: -21.9426,
  timeZone: "Atlantic/Reykjavik",
};

function aScenario(overrides: Partial<ScenarioType> = {}): ScenarioType {
  return {
    id: 1,
    name: "Test",
    icon: "battery",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2020,
    cash: 1,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    feePerKgCO2e: 0,
    facilities: [],
    ...overrides,
  } as ScenarioType;
}

describe("getLocation", () => {
  it("resolves a shipped location", () => {
    expect(getLocation("PIT")).toBe(LOCATIONS.PIT);
  });

  it("returns undefined rather than a bogus object for an unknown id", () => {
    expect(getLocation("NOWHERE")).toBeUndefined();
    expect(getLocation(undefined)).toBeUndefined();
    expect(getLocation(null)).toBeUndefined();
  });

  it("ships the two locations whose data was already in the repo", () => {
    expect(getLocation("LA")?.name).toContain("Los Angeles");
    expect(getLocation("CAMountains")?.lat).toBeGreaterThan(30);
  });

  it("gives every shipped location an id matching its key and a valid position", () => {
    Object.keys(LOCATIONS).forEach((key: string) => {
      const location = LOCATIONS[key];
      expect(location.id).toBe(key);
      expect(isValidLocation(location)).toBe(true);
    });
  });
});

describe("getScenarioLocation", () => {
  it("looks an id up when that's all the scenario carries", () => {
    expect(getScenarioLocation(aScenario())).toBe(LOCATIONS.SF);
  });

  it("prefers a full location, so a custom game can be played somewhere unlisted", () => {
    const scenario = aScenario({ locationId: "SF", location: ELSEWHERE });
    expect(getScenarioLocation(scenario)).toBe(ELSEWHERE);
  });

  it("returns undefined for an unknown id and for no scenario at all", () => {
    expect(
      getScenarioLocation(aScenario({ locationId: "XXX" })),
    ).toBeUndefined();
    expect(getScenarioLocation(undefined)).toBeUndefined();
  });
});

describe("isValidLocationId", () => {
  it("accepts the ids the game ships", () => {
    Object.keys(LOCATIONS).forEach((id: string) =>
      expect(isValidLocationId(id)).toBe(true),
    );
  });

  it("rejects anything that could escape the weather data directory", () => {
    expect(isValidLocationId("../../../etc/passwd")).toBe(false);
    expect(isValidLocationId("SF/../PIT")).toBe(false);
    expect(isValidLocationId("SF?x=1")).toBe(false);
    expect(isValidLocationId("")).toBe(false);
    expect(isValidLocationId("x".repeat(33))).toBe(false);
    expect(isValidLocationId(7)).toBe(false);
  });
});

describe("isValidLocation", () => {
  it("accepts a well formed location", () => {
    expect(isValidLocation(ELSEWHERE)).toBe(true);
    expect(isValidLocation({ ...ELSEWHERE, timeZone: undefined })).toBe(true);
    expect(isValidLocation({ ...ELSEWHERE, offshore: true })).toBe(true);
  });

  it("rejects blobs that aren't one", () => {
    expect(isValidLocation(null)).toBe(false);
    expect(isValidLocation("SF")).toBe(false);
    expect(isValidLocation({ ...ELSEWHERE, id: "../SF" })).toBe(false);
    expect(isValidLocation({ ...ELSEWHERE, lat: 91 })).toBe(false);
    expect(isValidLocation({ ...ELSEWHERE, long: -181 })).toBe(false);
    expect(isValidLocation({ ...ELSEWHERE, lat: NaN })).toBe(false);
    expect(isValidLocation({ ...ELSEWHERE, timeZone: 5 })).toBe(false);
    expect(isValidLocation({ ...ELSEWHERE, offshore: "yes" })).toBe(false);
  });
});
