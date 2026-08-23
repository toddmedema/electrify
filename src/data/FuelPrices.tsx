import Papa from "papaparse";
import { INFLATION } from "../Constants";
import { DateType, FuelPricesType } from "../Types";
import { getRandomRangeAt, RANDOM_STREAM } from "../helpers/Math";

// GOOGLE SHEET: https://docs.google.com/spreadsheets/d/1IFc_5NOuU-y0pJGml1IBd2HlKV8unhgIpnhZQmsMCs4/edit#gid=0
// Sources: (all prices real / in that year's $'s, per million BTU)

// Coal: lignite https://www.eia.gov/totalenergy/data/annual/xls/stb0709.xls
// ^^ 1949 - 2011, whole years only

// Natural gas: https://www.eia.gov/dnav/ng/hist/n3020us3M.htm
// ^^ 1983 - 2019, whole years only

// Uranium: https://www.eia.gov/uranium/marketing/html/summarytable1b.php
// 35Bbtu / lb - https://smartenergy.illinois.edu/energy-efficiency-basics/energy-concepts-and-terms

// Oil: imported crude oil prices https://www.eia.gov/outlooks/steo/realprices/

// The first year in FuelPricesRaw.csv. Asking for a year before this means the CSV was never
// loaded, rather than that the game is being played in the 1970s.
const EARLIEST_DATA_YEAR = 1975;

// Fixed so that each fuel always draws from the same slot of the fuel stream, whatever order
// the CSV's columns happen to arrive in
const FUEL_KEYS = ["Natural Gas", "Coal", "Uranium", "Oil"];

interface RawFuelPricesType {
  month: number;
  year: number;
  naturalgas: number;
  coal: number;
  uranium: number;
  oil: number;
}

// Holds both the CSV's historic prices and the randomly extrapolated future ones, so it has to be
// reset per game -- otherwise a second playthrough silently inherits the first one's future prices
// and the run stops being a function of its seed.
// year -> month (1-12) -> price per MBTU by fuel
const fuelPrices: Record<number, Record<number, FuelPricesType>> = {};

/**
 * Whether any prices have been loaded yet. The game screens all run after the loading screen has
 * read the CSV, but the new game screens don't - and asking for a price there is a question with
 * no answer rather than the programming error getFuelPricesPerMBTU otherwise throws over.
 */
export function hasFuelPrices(): boolean {
  return Object.keys(fuelPrices).length > 0;
}

// Emptied in place rather than reassigned so that the closure in projectYear keeps referring to
// a const, which no-loop-func requires
function resetFuelPrices() {
  Object.keys(fuelPrices).forEach((year: string) => {
    delete fuelPrices[+year];
  });
}

function collectFuelPriceRow(row: Papa.ParseStepResult<RawFuelPricesType>) {
  const data = row.data;
  fuelPrices[+data.year] = fuelPrices[+data.year] || {};
  fuelPrices[+data.year][+data.month] = {
    "Natural Gas": +data.naturalgas,
    Coal: +data.coal,
    Uranium: +data.uranium,
    Oil: +data.oil,
  };
}

export function initFuelPrices(callback?: () => void) {
  resetFuelPrices();
  Papa.parse<RawFuelPricesType>(`/data/FuelPricesRaw.csv`, {
    download: true,
    dynamicTyping: true,
    header: true,
    // worker: true,
    step: collectFuelPriceRow,
    complete() {
      if (callback) {
        callback();
      }
    },
  });
}

/**
 * Synchronous counterpart to initFuelPrices, for callers that already have the CSV contents
 * (the headless simulator reads them off disk; the browser has to download them).
 * Note that getFuelPricesPerMBTU throws if no prices are ever loaded, so any non-browser entry
 * point into the simulation has to call this first.
 */
export function initFuelPricesFromCsv(csv: string) {
  resetFuelPrices();
  Papa.parse<RawFuelPricesType>(csv, {
    dynamicTyping: true,
    header: true,
    step: collectFuelPriceRow,
  });
}

/**
 * Extrapolates one year of prices from the previous December, walking each fuel forward month by
 * month. Each fuel draws from its own slot in the year's slice of the fuel stream, so a year comes
 * out the same whenever it is generated and however many years were generated before it.
 */
function projectYear(
  seed: number,
  year: number,
  startingPrices: FuelPricesType,
) {
  fuelPrices[year] = {};
  let previous = startingPrices;
  for (let month = 1; month <= 12; month++) {
    const prices = { ...previous };
    const draw = (year * 12 + month) * FUEL_KEYS.length;
    FUEL_KEYS.forEach((fuel: string, fuelIndex: number) => {
      if (prices[fuel] === undefined) {
        return;
      }
      prices[fuel] *=
        1 +
        getRandomRangeAt(
          seed,
          RANDOM_STREAM.fuelPrices,
          draw + fuelIndex,
          -0.06,
          0.06 + INFLATION / 12,
        );
    });
    fuelPrices[year][month] = prices;
    previous = prices;
  }
}

export function getFuelPricesPerMBTU(
  date: DateType,
  seed: number,
): FuelPricesType {
  if (fuelPrices[date.year] === undefined) {
    // Prices only run from EARLIEST_DATA_YEAR, so anything before that means nothing was
    // loaded. Without the floor this walks backwards forever and hangs whatever called it.
    let referenceYear = date.year - 1;
    while (fuelPrices[referenceYear] === undefined) {
      referenceYear--;
      if (referenceYear < EARLIEST_DATA_YEAR) {
        throw new Error(
          `No fuel prices loaded, so none can be projected for ${date.year}. ` +
            "Call initFuelPrices (browser) or initFuelPricesFromCsv (headless) first.",
        );
      }
    }
    // Every intervening year gets projected, rather than jumping straight to the one asked for.
    // Prices compound, so skipping the chain lands somewhere entirely different -- which is what
    // a game loaded years past the end of the data used to do.
    for (let year = referenceYear + 1; year <= date.year; year++) {
      projectYear(seed, year, fuelPrices[year - 1][12]);
    }
  }
  return fuelPrices[date.year][date.monthNumber];
}
