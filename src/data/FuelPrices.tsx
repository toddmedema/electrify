import Papa from "papaparse";
import { DateType, FuelPricesType } from "../Types";
import { normalAt, RANDOM_STREAM } from "../helpers/Math";

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

// The last year in it. Mirrored as a constant rather than read off the loaded table for the same
// reason EARLIEST_DATA_YEAR is: the new game screens have to price an era before any CSV has been
// downloaded. buildFuelTrends uses the real latest year from the data; this only has to agree
// with it closely enough to quote a retail rate in the right ballpark.
export const LATEST_DATA_YEAR = 2019;

// Fixed so that each fuel always draws from the same slot of the fuel stream, whatever order
// the CSV's columns happen to arrive in
const FUEL_KEYS = ["Natural Gas", "Coal", "Uranium", "Oil"];

// How fast the trend a projected price is tied to climbs, in that year's dollars. The recorded
// series run between 1.8%/yr (natural gas) and 3.6%/yr (oil) across 1975-2019, so this sits just
// above the top of the range the data supports: fuel gets steadily dearer in real terms against
// the ~2.5-3% the economy inflates build and O&M costs at, and a long game is a slow squeeze on
// anything that burns something rather than a coin flip about whether fuel ends up free.
export const TREND_ESCALATION_YEARLY = 0.04;

// How much of last month's departure from that trend carries into this month's, and how far it is
// allowed to sit from the trend. Both are measured off the record rather than written down here;
// these are the bounds that keep a pathological series (one that never moves, or one the linear
// fit describes badly) from producing a persistence of 1 -- which is the unbounded random walk
// this replaced -- or of 0, which would be white noise pinned to the trend.
const MIN_PERSISTENCE = 0.9;
const MAX_PERSISTENCE = 0.9995;
// Nothing may sit more than this many standard deviations from its trend. The departure is a
// normal draw, so it has no natural ceiling, and one draw in a few thousand is worth clamping
// when the run is two centuries long and the result is multiplied by the anchor.
const MAX_DEPARTURE_SDS = 3;

/**
 * What one fuel's recorded prices say about how it behaves: where its trend starts, how far from
 * that trend it wanders, and how long it takes to come back.
 *
 * Derived from the CSV at load rather than written per fuel, for the same reason the weather's
 * climatology is derived from each location's own forty years -- coal is a slow, smooth series
 * that sits within 20% of its trend for decades, while oil swings by a factor of two and mean
 * reverts within about four years, and nothing here has to know which is which.
 */
interface DepartureType {
  persistence: number; // Fraction of last month's log departure kept, 0 - 1
  departureSd: number; // Log space, the spread the record actually shows around its own trend
  shockSd: number; // Log space, the monthly draw that sustains exactly that spread
}
interface FuelTrendType extends DepartureType {
  baseline: number; // $/MBTU the trend passes through, in the anchor month
}

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

// One entry per fuel, rebuilt from the record on each load, and the absolute month its baseline
// is quoted at. Empty until a CSV has been read, which is also when the projection is first asked
// for anything.
const fuelTrends: Record<string, FuelTrendType> = {};
let anchorMonth = 0;

// A contiguous month index, so that December of one year and January of the next are one apart.
// Both the anchor and the projection walk in this space.
function absoluteMonth(year: number, month: number): number {
  return year * 12 + month;
}

// Emptied in place rather than reassigned so that the closure in projectYear keeps referring to
// a const, which no-loop-func requires
function resetFuelPrices() {
  Object.keys(fuelPrices).forEach((year: string) => {
    delete fuelPrices[+year];
  });
  Object.keys(fuelTrends).forEach((fuel: string) => {
    delete fuelTrends[fuel];
  });
  anchorMonth = 0;
}

/** Every recorded month for one fuel, oldest first. Only ever run over real rows. */
function recordedPrices(fuel: string, years: number[]): number[] {
  const prices: number[] = [];
  years.forEach((year: number) => {
    for (let month = 1; month <= 12; month++) {
      const price = fuelPrices[year][month]?.[fuel];
      if (price !== undefined && price > 0) {
        prices.push(price);
      }
    }
  });
  return prices;
}

// A fuel whose record gives the projection nothing to wander with: it rides its trend exactly.
// Not the same as having no trend at all -- the escalation applies to every fuel that was ever
// recorded, and only the departure from it is measured.
const NO_DEPARTURE = { persistence: 0, departureSd: 0, shockSd: 0 };

/**
 * Reduces one fuel's record to the three numbers that describe how it departs from its own trend.
 *
 * Everything is done on logs, because a fuel price is a multiplicative thing: $9 oil moving to
 * $18 and $2 gas moving to $4 are the same event, and only in log space does one set of constants
 * describe both. A straight line is fitted through those logs -- the fuel's own trend -- and what
 * is left over is the departure the projection has to reproduce: how wide it sits (its standard
 * deviation) and how quickly it closes (recovered from the size of a typical month to month step,
 * since for this process a step's variance is 2(1 - persistence) times the departure's).
 */
function measureDeparture(prices: number[]): DepartureType {
  const n = prices.length;
  if (n < 24) {
    return NO_DEPARTURE; // Too little to fit a trend through, let alone measure a spread around one
  }
  const logs = prices.map(Math.log);
  const meanIndex = (n - 1) / 2;
  const meanLog = logs.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (i - meanIndex) * (logs[i] - meanLog);
    variance += Math.pow(i - meanIndex, 2);
  }
  const slope = covariance / variance;

  let departureSquares = 0;
  for (let i = 0; i < n; i++) {
    departureSquares += Math.pow(
      logs[i] - (meanLog + slope * (i - meanIndex)),
      2,
    );
  }
  const departureSd = Math.sqrt(departureSquares / n);

  // The month to month step, with the trend's own slope taken out of it
  let stepSquares = 0;
  for (let i = 1; i < n; i++) {
    stepSquares += Math.pow(logs[i] - logs[i - 1] - slope, 2);
  }
  const stepSd = Math.sqrt(stepSquares / (n - 1));
  if (departureSd <= 0 || stepSd <= 0) {
    return NO_DEPARTURE; // A series that never moves has no spread to reproduce
  }

  const persistence = Math.min(
    MAX_PERSISTENCE,
    Math.max(
      MIN_PERSISTENCE,
      1 - Math.pow(stepSd, 2) / (2 * Math.pow(departureSd, 2)),
    ),
  );
  return {
    persistence,
    departureSd,
    // Sized so the departure settles at exactly the spread the record shows rather than growing
    // with the horizon -- the same relationship the weather's anomaly walk uses
    shockSd: departureSd * Math.sqrt(1 - Math.pow(persistence, 2)),
  };
}

/**
 * Builds the per fuel trends from whatever was just loaded. Has to run before anything is
 * projected, and while fuelPrices still holds only real rows.
 */
function buildFuelTrends() {
  const years = Object.keys(fuelPrices)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length === 0) {
    return;
  }
  const latestYear = years[years.length - 1];
  anchorMonth = absoluteMonth(latestYear, 12);

  FUEL_KEYS.forEach((fuel: string) => {
    const prices = recordedPrices(fuel, years);
    if (prices.length === 0) {
      return; // A fuel the CSV never carried. Nothing to escalate, nothing to project.
    }
    // The trend passes through the last recorded year's average price rather than through its
    // December, so a single volatile month doesn't set the level for the next two centuries
    const lastYear = recordedPrices(fuel, [latestYear]);
    fuelTrends[fuel] = {
      baseline:
        lastYear.length > 0
          ? lastYear.reduce((a, b) => a + b, 0) / lastYear.length
          : prices[prices.length - 1],
      ...measureDeparture(prices),
    };
  });
}

/**
 * How much dearer fuel is in a given year than at the end of the record, on the trend alone.
 *
 * Fuel is the one price in the game quoted in the year's own money: build costs and O&M are
 * anchored on whatever year a game starts in, so they open at exactly what the tables say, but a
 * game starting in 2080 opens against fuel that has escalated for sixty years. The retail rate it
 * is played at has to be quoted in that same money, or the run is bankrupt in its first quarter -
 * which is what the custom game screen uses this for.
 */
export function getFuelEscalation(year: number): number {
  return Math.pow(
    1 + TREND_ESCALATION_YEARLY,
    Math.max(0, year - LATEST_DATA_YEAR),
  );
}

/** What a fuel costs on its trend in a given month, before any departure from it. */
function anchorPrice(trend: FuelTrendType, month: number): number {
  return (
    trend.baseline *
    Math.pow(1 + TREND_ESCALATION_YEARLY, (month - anchorMonth) / 12)
  );
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
      // Has to run before anything is projected, and while the table holds only real rows
      buildFuelTrends();
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
  buildFuelTrends();
}

/**
 * Extrapolates one year of prices from the previous December, walking each fuel forward month by
 * month. Each fuel draws from its own slot in the year's slice of the fuel stream, so a year comes
 * out the same whenever it is generated and however many years were generated before it.
 *
 * Each fuel is tied to a trend rising at TREND_ESCALATION_YEARLY and wanders around it: last
 * month's departure is kept in part, shed in part, and shocked. What that buys is a spread that
 * settles rather than grows. The multiplicative random walk this replaced had no anchor at all,
 * so its spread widened with the square root of the horizon -- tolerable across the twenty years
 * a game used to be able to cover, and nonsense across two hundred, where it put natural gas at
 * three cents per MBTU and left the fuel free.
 *
 * The departure is read back off the previous month's price rather than carried alongside it, so
 * this stays what it always was: a pure function of the seed and the December it starts from.
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
    const thisMonth = absoluteMonth(year, month);
    const draw = thisMonth * FUEL_KEYS.length;
    FUEL_KEYS.forEach((fuel: string, fuelIndex: number) => {
      const trend = fuelTrends[fuel];
      if (prices[fuel] === undefined || !trend) {
        return; // A fuel the CSV never carried, or one with no measurable trend, is held flat
      }
      // A fuel the record shows sitting still has nothing to carry and nothing to shock, so it
      // rides the trend exactly rather than being frozen at its last recorded price
      const previousDeparture = trend.departureSd
        ? Math.log(prices[fuel] / anchorPrice(trend, thisMonth - 1))
        : 0;
      const departure =
        trend.persistence * previousDeparture +
        trend.shockSd *
          normalAt(seed, RANDOM_STREAM.fuelPrices, draw + fuelIndex);
      const limit = MAX_DEPARTURE_SDS * trend.departureSd;
      prices[fuel] =
        anchorPrice(trend, thisMonth) *
        Math.exp(Math.min(limit, Math.max(-limit, departure)));
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
