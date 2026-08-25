import * as fs from "fs";
import * as path from "path";
import { initEconomyFromCsv } from "../data/Economy";
import { initFuelPricesFromCsv } from "../data/FuelPrices";
import { initWeatherFromCsv } from "../data/Weather";
import { isValidLocationId } from "../helpers/Locations";
import { LocationIdType } from "../Types";

// In the browser these CSVs are downloaded from /data; headless we read the same files off disk.
const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");

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
  initWeatherFromCsv(
    locationId,
    fs.readFileSync(path.join(DATA_DIR, `WeatherRaw${locationId}.csv`), "utf8"),
  );
  initFuelPricesFromCsv(
    fs.readFileSync(path.join(DATA_DIR, "FuelPricesRaw.csv"), "utf8"),
  );
  initEconomyFromCsv(
    fs.readFileSync(path.join(DATA_DIR, "EconomyRaw.csv"), "utf8"),
  );
}
