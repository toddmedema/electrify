import { LOCATIONS } from "../Constants";
import { LocationIdType, LocationType, ScenarioType } from "../Types";

/**
 * Turning a location id into a location, in one place.
 *
 * LocationIdType used to be a four-string union, so `LOCATIONS[id]` was total and every caller
 * indexed it directly. Now that a location can be anything - including one a custom game carries
 * that no table has ever heard of - a bare index is a lie about what came back, and there are
 * two different questions being asked: "which of the places we ship is this?" (getLocation) and
 * "where is this scenario played?" (getScenarioLocation), which are no longer the same question.
 */
export function getLocation(
  id: LocationIdType | undefined | null,
): LocationType | undefined {
  return id ? LOCATIONS[id] : undefined;
}

/**
 * Where a scenario is played. A scenario that carries a full location wins over one that only
 * names an id, so a custom game can hold somewhere LOCATIONS doesn't list.
 */
export function getScenarioLocation(
  scenario: ScenarioType | undefined | null,
): LocationType | undefined {
  if (!scenario) {
    return undefined;
  }
  return scenario.location || getLocation(scenario.locationId);
}

/**
 * Whether an id is safe to build a weather file path out of.
 *
 * The id goes straight into `/data/weather/<id>.bin` (and into a filesystem path headless), and
 * it now arrives from a saved game, a replay document or local storage rather than from a union
 * the compiler checked - so `../` has to be ruled out before it gets there.
 */
export function isValidLocationId(id: unknown): id is LocationIdType {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(id);
}

/**
 * Whether a blob is a usable location. Used on the way in from anywhere untrusted - a replay
 * document, most of all, which is a stranger's JSON driving the real simulation.
 */
export function isValidLocation(value: unknown): value is LocationType {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const location = value as Partial<LocationType>;
  return (
    isValidLocationId(location.id) &&
    typeof location.name === "string" &&
    typeof location.lat === "number" &&
    Number.isFinite(location.lat) &&
    Math.abs(location.lat) <= 90 &&
    typeof location.long === "number" &&
    Number.isFinite(location.long) &&
    Math.abs(location.long) <= 180 &&
    typeof location.timeZone === "string"
  );
}
