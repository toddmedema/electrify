import { fetchCsv, parseCsv } from "../helpers/Csv";
import { getRandomRangeAt, RANDOM_STREAM } from "../helpers/Math";

// Rates only move with the calendar month, so this asks for just that rather than a whole
// DateType. A DateType satisfies it, so callers holding one pass it straight through - and the
// per tick caller in the reducer can use the cheap month-only helper instead of building a full
// date for every tick of a forecast.
export interface MonthRefType {
  year: number;
  monthNumber: number; // 1-12
}

// GOOGLE SHEET: none - built by scripts from the two sources below
// Sources:

// Prime rate: every WSJ prime rate change since 1975, forward filled to the rate in effect on the
// last day of each month - https://www.jpmorganchase.com/about/our-business/historical-prime-rate
// (which only reaches back to 1983) and https://fedprimerate.com/wall_street_journal_prime_rate_history.htm
// for the years before that. The December 1980 peak of 21.5% is real, not a typo.

// Inflation: annual average change in CPI-U, held flat across the year's twelve rows -
// https://www.usinflationcalculator.com/inflation/historical-inflation-rates/
// Month to month CPI precision buys nothing here: the simulation reads inflation once a month and
// spends it on cost escalation, where the annual figure is the honest resolution anyway.

// The first year in EconomyRaw.csv. Asking for a year before this means the CSV was never loaded,
// rather than that the game is being played in the 1960s.
const EARLIEST_DATA_YEAR = 1975;

// Where the projection rests, and how far it is allowed to travel. The floor is the real one:
// prime sat at 3.25% from the end of 2008 to the end of 2015 and never went below it.
const BASE_PRIME = 0.05;
const MIN_PRIME = 0.0325;
const MAX_PRIME = 0.15;
const BASE_INFLATION = 0.025;
const MIN_INFLATION = -0.01;
const MAX_INFLATION = 0.14;

// Rates and inflation move together on a cycle of years, not a random walk of months: a decade
// of cheap money, a climb, a plateau, a fall. Eight to twelve years per full turn.
const CYCLE_MIN_MONTHS = 8 * 12;
const CYCLE_MAX_MONTHS = 12 * 12;

// A sine scaled past 1 and clipped, which is the shape the cycle actually has: it climbs, sits
// near the top for a while, falls, and sits near the bottom, rather than turning around the
// instant it arrives. Scaled gently on purpose - at 1.8 the clip swallows nearly two thirds of
// each half cycle and a decade reads as a step function rather than a rate cycle.
const PLATEAU_SHARPNESS = 1.3;

// Rates do not sit perfectly still even on a plateau, and a dead flat line for a year and a half
// looks like a broken chart rather than a calm economy. A quarter point either way, which is the
// increment prime actually moves in.
const PRIME_NOISE = 0.0025;
const INFLATION_NOISE = 0.004;

// Monthly noise is addressed by absolute month, which runs to ~24,000 for a modern year. Cycle
// draws are addressed by cycle index and stay under a few hundred. Offsetting past both keeps the
// two index spaces from ever naming the same draw.
const NOISE_INDEX_OFFSET = 1000000;

// Inflation leads, the rate response follows. This is the whole causal story: prices run away,
// rates are raised to chase them, the economy cools, and rates come back down.
const INFLATION_LEAD_MONTHS = 18;

// How much of a cycle's excursion in prime is matched by one in inflation. Below 1 because the
// rate response overshoots what it is chasing, which is why real rates go positive at the top.
const INFLATION_COUPLING = 0.8;

// The projection is not allowed to jump off the last real observation. Its first months are
// pulled toward that value and released over two years.
const BLEND_MONTHS = 24;

// Each cycle draws its length, its peak and its trough. Fixed, for the same reason the stream ids
// are: changing it changes what every existing seed produces.
const DRAWS_PER_CYCLE = 3;

// The CSV's columns, as the text they are written as. Everything is coerced with unary + on the
// way into the table below, so the reader is left with no opinion about which columns are numbers.
type RawEconomyType = {
  month: string;
  year: string;
  prime: string; // percent, eg 4.75
  inflation: string; // fraction, eg 0.018
};

export interface MonthEconomyType {
  prime: number; // fraction, eg 0.0475
  inflation: number; // annualised fraction
}

// Holds both the CSV's historic rates and the projected future ones, so it has to be reset per
// game -- otherwise a second playthrough silently inherits the first one's future and the run
// stops being a function of its seed.
// year -> month (1-12)
const economy: Record<number, Record<number, MonthEconomyType>> = {};

// The last month the CSV actually had, as an absolute month index. Everything after it is
// projected, and the blend that keeps the seam smooth is measured from here.
let seamMonth = 0;
let seamRates: MonthEconomyType = {
  prime: BASE_PRIME,
  inflation: BASE_INFLATION,
};

// The chain of projected cycles, extended lazily. Cycle k starts where cycle k-1 ended, so this
// has to be walked from the seam rather than indexed into directly.
interface CycleType {
  start: number; // absolute month index
  months: number;
  primePeak: number;
  primeTrough: number;
}
let cycles: CycleType[] = [];

// Cumulative inflation since the start of a game, which is what facility costs escalate by.
// Anchored per game, so it is thrown away when the anchor moves.
let inflationIndex: Record<number, Record<number, number>> = {};
let inflationIndexAnchor = 0;

function absoluteMonth(year: number, monthNumber: number): number {
  return year * 12 + (monthNumber - 1);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Whether any rates have been loaded yet. The game screens all run after the loading screen has
 * read the CSV, but the new game screens don't - and asking for a rate there is a question with
 * no answer rather than the programming error getEconomy otherwise throws over.
 */
export function hasEconomy(): boolean {
  return Object.keys(economy).length > 0;
}

function resetEconomy() {
  Object.keys(economy).forEach((year: string) => {
    delete economy[+year];
  });
  cycles = [];
  seamMonth = 0;
  seamRates = { prime: BASE_PRIME, inflation: BASE_INFLATION };
  inflationIndex = {};
  inflationIndexAnchor = 0;
}

function collectEconomyRow(data: RawEconomyType) {
  // A column left empty by a hand edit. Reading it as year 0 would file the row under a date no
  // game can reach, which is a row quietly missing from the record rather than a loud failure.
  if (!data.year || !data.month) {
    return;
  }
  economy[+data.year] = economy[+data.year] || {};
  economy[+data.year][+data.month] = {
    prime: +data.prime / 100,
    inflation: +data.inflation,
  };
  const month = absoluteMonth(+data.year, +data.month);
  if (month > seamMonth) {
    seamMonth = month;
    seamRates = economy[+data.year][+data.month];
  }
}

export function initEconomy(callback?: () => void) {
  resetEconomy();
  fetchCsv<RawEconomyType>(`/data/EconomyRaw.csv`)
    .then((rows: RawEconomyType[]) => {
      rows.forEach(collectEconomyRow);
      if (callback) {
        callback();
      }
    })
    .catch((e: Error) => {
      // The callback is deliberately not fired: it starts the game, and getEconomy throws for a
      // game with no rates, so hanging the loading screen is the more legible of the two failures
      console.error(`Could not load the economic record: ${e.message}`);
    });
}

/**
 * Synchronous counterpart to initEconomy, for callers that already have the CSV contents
 * (the headless simulator reads them off disk; the browser has to download them).
 * Note that getEconomy throws if no rates are ever loaded, so any non-browser entry point into
 * the simulation has to call this first.
 */
export function initEconomyFromCsv(csv: string) {
  resetEconomy();
  parseCsv<RawEconomyType>(csv).forEach(collectEconomyRow);
}

/**
 * The cycle covering an absolute month, extending the chain until one does. Cycles are addressed
 * by their position in the chain rather than by date, so every draw a cycle makes is a pure
 * function of (seed, cycle index) and the same month comes out the same however it is reached.
 */
function getCycle(month: number, seed: number): CycleType {
  while (
    cycles.length === 0 ||
    cycles[cycles.length - 1].start + cycles[cycles.length - 1].months <= month
  ) {
    const index = cycles.length;
    const draw = index * DRAWS_PER_CYCLE;
    const previous = cycles[index - 1];
    // Amplitude is cubed rather than uniform so that most cycles are mild and only the rare one
    // reaches for the ceiling. Without it a series that rests at its extremes would spend half
    // its life at 15%, which is neither realistic nor the "biased towards 5%" asked for. Cubed
    // rather than squared because squaring still puts the median cycle's peak at 7.5%, which is
    // a hot decade to hand out every other cycle.
    const peakDraw = getRandomRangeAt(
      seed,
      RANDOM_STREAM.economy,
      draw + 1,
      0,
      1,
    );
    const troughDraw = getRandomRangeAt(
      seed,
      RANDOM_STREAM.economy,
      draw + 2,
      0,
      1,
    );
    cycles.push({
      start: previous ? previous.start + previous.months : seamMonth,
      months: Math.round(
        getRandomRangeAt(
          seed,
          RANDOM_STREAM.economy,
          draw,
          CYCLE_MIN_MONTHS,
          CYCLE_MAX_MONTHS,
        ),
      ),
      primePeak: BASE_PRIME + (MAX_PRIME - BASE_PRIME) * Math.pow(peakDraw, 3),
      primeTrough:
        BASE_PRIME - (BASE_PRIME - MIN_PRIME) * Math.pow(troughDraw, 2),
    });
  }
  for (let i = cycles.length - 1; i >= 0; i--) {
    if (cycles[i].start <= month) {
      return cycles[i];
    }
  }
  return cycles[0];
}

// Climbs, rests near the top, falls, rests near the bottom. Phase 0 sits at the resting value on
// the way up, so a cycle always begins where the one before it ended.
function plateauWave(phase: number): number {
  return clamp(Math.sin(2 * Math.PI * phase) * PLATEAU_SHARPNESS, -1, 1);
}

// Maps a -1..1 wave onto a range that is deliberately lopsided: there is a lot more room above
// 5% than below it, so the same wave has to travel further up than down.
function spread(wave: number, base: number, peak: number, trough: number) {
  return wave >= 0
    ? base + wave * (peak - base)
    : base + wave * (base - trough);
}

function projectMonth(month: number, seed: number): MonthEconomyType {
  const cycle = getCycle(month, seed);
  const phase = (month - cycle.start) / cycle.months;
  const prime = spread(
    plateauWave(phase),
    BASE_PRIME,
    cycle.primePeak,
    cycle.primeTrough,
  );
  // Inflation today is what prime will be answering for in a year and a half, so it is read off
  // the cycle that actually contains that future month rather than off this one. Reading it off
  // this one instead wraps the phase back around at a cycle boundary and invents an inflation
  // spike, scaled by the amplitude of the cycle that is ending, that no rate ever responds to.
  const leadMonth = month + INFLATION_LEAD_MONTHS;
  const leadCycle = getCycle(leadMonth, seed);
  const inflation = spread(
    plateauWave((leadMonth - leadCycle.start) / leadCycle.months),
    BASE_INFLATION,
    BASE_INFLATION + (leadCycle.primePeak - BASE_PRIME) * INFLATION_COUPLING,
    BASE_INFLATION - (BASE_PRIME - leadCycle.primeTrough) * INFLATION_COUPLING,
  );
  // Applied before the blend, so the seam damps the wobble along with everything else
  const noiseIndex = NOISE_INDEX_OFFSET + month * 2;
  const primeNoise = getRandomRangeAt(
    seed,
    RANDOM_STREAM.economy,
    noiseIndex,
    -PRIME_NOISE,
    PRIME_NOISE,
  );
  const inflationNoise = getRandomRangeAt(
    seed,
    RANDOM_STREAM.economy,
    noiseIndex + 1,
    -INFLATION_NOISE,
    INFLATION_NOISE,
  );
  // The first projected months are pulled towards the last real observation, so that a game
  // starting in 2019 doesn't watch prime teleport in January 2020
  const blend = Math.min(1, (month - seamMonth) / BLEND_MONTHS);
  return {
    prime: clamp(
      (prime + primeNoise) * blend + seamRates.prime * (1 - blend),
      MIN_PRIME,
      MAX_PRIME,
    ),
    inflation: clamp(
      (inflation + inflationNoise) * blend + seamRates.inflation * (1 - blend),
      MIN_INFLATION,
      MAX_INFLATION,
    ),
  };
}

function getEconomy(date: MonthRefType, seed: number): MonthEconomyType {
  if (!hasEconomy()) {
    throw new Error(
      `No economic data loaded, so no rate can be given for ${date.year}. ` +
        "Call initEconomy (browser) or initEconomyFromCsv (headless) first.",
    );
  }
  // Anything before the data starts is the data's first month. No scenario begins there -- the
  // earliest is 1980 -- and inventing a projection backwards would be worse than saying so.
  const year = Math.max(date.year, EARLIEST_DATA_YEAR);
  if (economy[year] === undefined) {
    economy[year] = {};
  }
  if (economy[year][date.monthNumber] === undefined) {
    economy[year][date.monthNumber] = projectMonth(
      absoluteMonth(year, date.monthNumber),
      seed,
    );
  }
  return economy[year][date.monthNumber];
}

export function getPrimeRate(date: MonthRefType, seed: number): number {
  return getEconomy(date, seed).prime;
}

export function getInflationRate(date: MonthRefType, seed: number): number {
  return getEconomy(date, seed).inflation;
}

/**
 * Cumulative inflation since January of the game's starting year, as a multiplier on costs quoted
 * in that year's dollars. Exactly 1 on the opening day of every run, whichever year it starts in:
 * anchoring on the game rather than on a fixed year is what keeps a 1980 scenario's build costs
 * matching its authored table instead of being deflated into triviality against a nominal
 * retail rate.
 */
export function getInflationIndex(
  date: MonthRefType,
  startingYear: number,
  seed: number,
): number {
  if (inflationIndexAnchor !== startingYear) {
    inflationIndex = {};
    inflationIndexAnchor = startingYear;
  }
  const year = Math.max(date.year, startingYear);
  if (inflationIndex[year]?.[date.monthNumber] !== undefined) {
    return inflationIndex[year][date.monthNumber];
  }
  // Walked from the anchor rather than jumping, both because the product needs every month and
  // because filling the cache on the way costs nothing
  let index = 1;
  const target = absoluteMonth(year, date.monthNumber);
  for (let m = absoluteMonth(startingYear, 1); m <= target; m++) {
    const y = Math.floor(m / 12);
    const monthNumber = (m % 12) + 1;
    inflationIndex[y] = inflationIndex[y] || {};
    inflationIndex[y][monthNumber] = index;
    // Next month's index compounds this month's inflation
    index *= 1 + getInflationRate({ year: y, monthNumber }, seed) / 12;
  }
  return inflationIndex[year][date.monthNumber];
}
