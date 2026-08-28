import * as fs from "fs";
import * as path from "path";
import { LOCATIONS } from "../Constants";
import { initEconomyFromCsv } from "../data/Economy";
import { initFuelPricesFromCsv } from "../data/FuelPrices";
import { initWeatherFromBinary, weatherFilePath } from "../data/Weather";
import { getLocation, isValidLocationId } from "../helpers/Locations";
import { LocationIdType, LocationType } from "../Types";

// In the browser these files are downloaded from /data; headless we read the same ones off disk.
const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");
const WEATHER_DIR = path.join(DATA_DIR, "weather");

let downloaded: { [id: string]: LocationType } | undefined;

/**
 * The cities whose weather has been downloaded, read from the same index the picker uses.
 *
 * The browser fetches it; here it is one file read, cached for the process. Without it `--location
 * Reykjavik` would be refused by a headless run for a city the game itself offers, since LOCATIONS
 * only holds the six that ship in the bundle.
 */
function downloadedLocations(): { [id: string]: LocationType } {
  if (!downloaded) {
    const file = path.join(WEATHER_DIR, "index.json");
    downloaded = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8")).cities || {}
      : {};
  }
  return downloaded as { [id: string]: LocationType };
}

/**
 * Where a headless run may be played: anywhere in the bundle or in the downloaded index.
 */
export function getSimLocation(id: LocationIdType): LocationType | undefined {
  return getLocation(id) || downloadedLocations()[id];
}

export function simLocationIds(): string[] {
  return Object.keys({ ...LOCATIONS, ...downloadedLocations() });
}

/**
 * Loads the weather, fuel price and economic data the simulation needs, resetting whatever a previous
 * run left behind. Both modules loop or throw when asked for data they don't have, so this
 * has to run before any simulation is started.
 */
export function loadSimData(locationId: LocationIdType) {
  // Now that a location id is any string rather than a checked union, it can't go into a path
  // unexamined -- and "no such file" thrown from deep inside readFileSync is a worse error than
  // this one anyway
  if (!isValidLocationId(locationId)) {
    throw new Error(`Invalid location id "${locationId}"`);
  }
  const location = getSimLocation(locationId);
  const file = path.join(
    DATA_DIR,
    weatherFilePath(location || { id: locationId }).replace(/^\/data\//, ""),
  );
  if (!fs.existsSync(file)) {
    throw new Error(
      `No weather data for "${locationId}" - run: node scripts/fetch-weather.js ${locationId}`,
    );
  }
  // Node hands back a Buffer that may be a window onto a larger pool, so the exact byte range
  // has to be sliced out rather than the whole underlying ArrayBuffer handed over
  const bytes = fs.readFileSync(file);
  initWeatherFromBinary(
    locationId,
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  initFuelPricesFromCsv(
    fs.readFileSync(path.join(DATA_DIR, "FuelPricesRaw.csv"), "utf8"),
  );
  initEconomyFromCsv(
    fs.readFileSync(path.join(DATA_DIR, "EconomyRaw.csv"), "utf8"),
  );
}
