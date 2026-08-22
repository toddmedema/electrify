import Papa from "papaparse";
import { INFLATION } from "../Constants";
import { DateType, FuelPricesType } from "../Types";
import { getRandomRange } from "../helpers/Math";

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

// Emptied in place rather than reassigned so that the closure in getFuelPricesPerMBTU keeps
// referring to a const, which no-loop-func requires
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
 * Note that getFuelPricesPerMBTU loops forever if no prices are ever loaded, so any
 * non-browser entry point into the simulation has to call this first.
 */
export function initFuelPricesFromCsv(csv: string) {
  resetFuelPrices();
  Papa.parse<RawFuelPricesType>(csv, {
    dynamicTyping: true,
    header: true,
    step: collectFuelPriceRow,
  });
}

export function getFuelPricesPerMBTU(date: DateType): FuelPricesType {
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
    fuelPrices[date.year] = {};
    let previous = fuelPrices[referenceYear][12];
    for (let month = 1; month <= 12; month++) {
      fuelPrices[date.year][month] = { ...previous };
      Object.keys(fuelPrices[date.year][month]).forEach((fuel: string) => {
        fuelPrices[date.year][month][fuel] *=
          1 + getRandomRange(-0.06, 0.06 + INFLATION / 12);
      });
      previous = { ...fuelPrices[date.year][month] };
    }
  }
  return fuelPrices[date.year][date.monthNumber];
}
