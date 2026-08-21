import * as fs from "fs";
import * as path from "path";
import { initFuelPricesFromCsv } from "../data/FuelPrices";
import { initWeatherFromCsv } from "../data/Weather";
import { LocationIdType } from "../Types";

// In the browser these CSVs are downloaded from /data; headless we read the same files off disk.
const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");

/**
 * Loads the weather and fuel price data the simulation needs, resetting whatever a previous
 * run left behind. Both modules loop or throw when asked for data they don't have, so this
 * has to run before any simulation is started.
 */
export function loadSimData(locationId: LocationIdType) {
  initWeatherFromCsv(
    locationId,
    fs.readFileSync(path.join(DATA_DIR, `WeatherRaw${locationId}.csv`), "utf8"),
  );
  initFuelPricesFromCsv(
    fs.readFileSync(path.join(DATA_DIR, "FuelPricesRaw.csv"), "utf8"),
  );
}
