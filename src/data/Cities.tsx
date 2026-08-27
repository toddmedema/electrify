import { LOCATIONS } from "../Constants";
import { LocationType } from "../Types";
import { isValidLocation } from "../helpers/Locations";

/**
 * Every place the game can be played, read from public/data/weather/index.json.
 *
 * That file is written by scripts/fetch-weather.js and lists exactly the cities whose weather has
 * actually been downloaded, which is the only definition of "playable" that can't go stale: a
 * picker built from a hardcoded list would offer somewhere the loading screen then 404s on.
 * Fetched rather than bundled for the same reason - the catalogue grows every time someone runs
 * the fetch script, and a rebuild shouldn't be what publishes that.
 *
 * LOCATIONS is the floor. The authored scenarios name their locations by id and have to resolve
 * before anything is downloaded, so those six are always offered, and the index adds the rest.
 */

export interface CityType extends LocationType {
  region: string;
  country?: string;
  admin?: string;
  elevation?: number;
}

// Roughly west to east, then south, which is the order a list of the world reads most naturally.
// A region the index mentions that isn't named here still shows, at the end.
export const REGION_ORDER = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Middle East",
  "South Asia",
  "East Asia",
  "Southeast Asia",
  "Oceania",
];

// The six that ship in the bundle, as cities. Their region is the one the catalogue gives them,
// and they are replaced wholesale by their index entry once that arrives.
const BUILT_IN: CityType[] = Object.values(LOCATIONS).map(
  (location: LocationType) => ({ ...location, region: "North America" }),
);

let cities: CityType[] = BUILT_IN;
let loading: Promise<CityType[]> | undefined;

function regionRank(region: string): number {
  const at = REGION_ORDER.indexOf(region);
  return at === -1 ? REGION_ORDER.length : at;
}

/**
 * Sorted for a grouped list: by region in the order above, then alphabetically inside each one.
 * MUI's Autocomplete groups adjacent options rather than gathering them, so an unsorted list
 * would render the same region several times over.
 */
function sortCities(list: CityType[]): CityType[] {
  return [...list].sort(
    (a: CityType, b: CityType) =>
      regionRank(a.region) - regionRank(b.region) ||
      a.region.localeCompare(b.region) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Whatever is known right now, without waiting: the six built-ins before the index has arrived,
 * everything afterwards. Rendering can't block on a download, and a list that starts short and
 * grows is better than a list that starts empty.
 */
export function getCities(): CityType[] {
  return cities;
}

function isCity(value: unknown): value is CityType {
  return (
    isValidLocation(value) &&
    typeof (value as CityType).region === "string" &&
    (value as CityType).region.length > 0
  );
}

/**
 * Downloads the index once per session and caches it. Rejects nothing: a missing or malformed
 * index leaves the built-in six, which is a smaller game rather than a broken one.
 */
export function initCities(): Promise<CityType[]> {
  if (!loading) {
    loading = fetch("/data/weather/index.json")
      .then((response: Response) => {
        if (!response.ok) {
          throw new Error(`${response.status} fetching the city index`);
        }
        return response.json();
      })
      .then((index: { cities?: { [id: string]: unknown } }) => {
        const listed = Object.values(index.cities || {}).filter(isCity);
        if (listed.length === 0) {
          throw new Error("the city index lists no usable cities");
        }
        // The index wins for fetched metadata, while a built-in resource override survives. The
        // weather catalogue cannot infer whether a city is connected to a usable river or field.
        const byId = new Map<string, CityType>(
          BUILT_IN.map((city: CityType) => [city.id, city]),
        );
        listed.forEach((city: CityType) => {
          const builtIn = byId.get(city.id);
          byId.set(city.id, {
            ...builtIn,
            ...city,
            resources: city.resources || builtIn?.resources,
          });
        });
        cities = sortCities(Array.from(byId.values()));
        return cities;
      })
      .catch((e: Error) => {
        console.error(`Could not load the city index: ${e.message}`);
        return cities;
      });
  }
  return loading;
}
