import { getTimes } from "suncalc";
import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  GAME_TO_REAL_YEARS,
  MONTHS,
  TICK_MINUTES,
  TICKS_PER_HOUR,
} from "../Constants";
import {
  DateType,
  DerivedHistoryType,
  LocationType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../Types";

export const EMPTY_HISTORY = {
  month: 0,
  year: 0,
  supplyWh: 0,
  demandWh: 0,
  customers: 0,
  cash: 0,
  kgco2e: 0,
  revenue: 0,
  expensesFuel: 0,
  expensesOM: 0,
  expensesCarbonFee: 0,
  expensesInterest: 0,
  expensesMarketing: 0,
  netWorth: 0,
} as MonthlyHistoryType;

// edits acc in place to avoid making tons of extra objects
export function reduceHistories(
  acc: MonthlyHistoryType,
  t: MonthlyHistoryType,
): MonthlyHistoryType {
  acc.supplyWh += t.supplyWh;
  acc.demandWh += t.demandWh;
  acc.kgco2e += t.kgco2e;
  acc.revenue += t.revenue;
  acc.expensesFuel += t.expensesFuel;
  acc.expensesOM += t.expensesOM;
  acc.expensesMarketing += t.expensesMarketing;
  acc.expensesCarbonFee += t.expensesCarbonFee;
  acc.expensesInterest += t.expensesInterest;
  acc.cash = t.cash;
  acc.customers = t.customers;
  acc.netWorth = t.netWorth;
  acc.month = t.month;
  acc.year = t.year;
  return acc;
}

export function deriveExpandedSummary(
  s: MonthlyHistoryType,
): DerivedHistoryType {
  const expenses =
    s.expensesFuel +
    s.expensesOM +
    s.expensesMarketing +
    s.expensesCarbonFee +
    s.expensesInterest;
  const supplykWh = (s.supplyWh || 1) / 1000;
  return {
    ...s,
    profit: s.revenue - expenses,
    profitPerkWh: (s.revenue - expenses) / supplykWh,
    revenuePerkWh: s.revenue / supplykWh,
    expenses,
    kgco2ePerMWh: s.kgco2e / (supplykWh / 1000),
  };
}

// start + end inclusive - can be used to summarize a month, but also any arbitrary timeline group
export function summarizeTimeline(
  timeline: TickPresentFutureType[],
  startingYear: number,
  filter?: (t: TickPresentFutureType) => boolean,
): MonthlyHistoryType {
  const summary = { ...EMPTY_HISTORY };
  // Go in reverse so that the last values for ending values (like net worth are used)
  for (let i = timeline.length - 1; i >= 0; i--) {
    const t = timeline[i];
    if (!filter || filter(t)) {
      // TODO perf this gets called a lot, but only need
      const date = getMonthYearFromMinute(t.minute, startingYear);
      // Integrate instantaneous electricity (watts) to watt hours
      // Only electricity isn't multiplied by this during tick calculations (financials are)
      const supplyWh =
        (Math.min(t.demandW, t.supplyW) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
      const demandWh = (t.demandW / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
      reduceHistories(summary, {
        ...t,
        supplyWh,
        demandWh,
        month: date.monthNumber,
        year: date.year,
      });
    }
  }
  return summary;
}

export function summarizeHistory(
  timeline: MonthlyHistoryType[],
  filter?: (t: MonthlyHistoryType) => boolean,
): MonthlyHistoryType {
  const summary = { ...EMPTY_HISTORY };
  // Go in reverse so that the last values for ending values (like net worth are used)
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (!filter || filter(timeline[i])) {
      reduceHistories(summary, timeline[i]);
    }
  }
  return summary;
}

export function getTimeFromTimeline(
  minute: number,
  timeline: TickPresentFutureType[],
): null | TickPresentFutureType {
  if (!timeline[0]) {
    return null;
  }
  const startingTime = timeline[0].minute;
  const deltaTicks = Math.floor((minute - startingTime) / TICK_MINUTES);
  if (deltaTicks >= timeline.length || timeline[deltaTicks] === undefined) {
    return timeline[timeline.length - 1];
  }
  return timeline[deltaTicks];
}

export function formatMonthChartAxis(t: number, multiyear: boolean) {
  t--;
  if (multiyear) {
    return (
      (t % 12) +
      1 +
      "/" +
      Math.floor(t / 12)
        .toString()
        .slice(-2)
    );
  }
  return MONTHS[t % 12];
}

export function formatHour(date: DateType): string {
  const time = new Date(
    `${date.year}-${date.monthNumber}-1 ${Math.floor(date.minuteOfDay / 60)}:00`,
  );
  return time.toLocaleString("en-US", { hour: "numeric", hour12: true });
}

// Faster subset of getDateFromMinute
export function getMonthYearFromMinute(minute: number, startingYear: number) {
  const dayOfGame = Math.floor(minute / 1440);
  const dayOfYear = dayOfGame % DAYS_PER_YEAR;
  const monthNumber = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
  const yearsEllapsed = Math.floor(dayOfGame / DAYS_PER_YEAR);
  const year = yearsEllapsed + startingYear;

  return {
    monthNumber,
    year,
  };
}

interface SunriseSunsetType {
  sunrise: number;
  sunset: number;
}

/**
 * Sun times only move with the month, the year and the location, so a whole game month's worth
 * of ticks all get the same answer. Working it out from scratch each time was the single most
 * expensive thing in the simulation: parsing a date out of a string and running suncalc's full
 * solar model costs ~17us a call, and a year-long forecast asks for one per tick -- twice, once
 * for irradiance and once for demand. Caching turns tens of milliseconds per forecast into a
 * map lookup. One entry per month played (plus however far the forecasts look ahead), so the
 * map stays in the hundreds of entries for even a very long game.
 */
const sunriseSunsetCache = new Map<string, SunriseSunsetType>();

/**
 * Minutes since midnight at `timeZone` for an instant, read out of the tz database rather than
 * off the clock of whatever machine happens to be running. Date's own getHours() answers in the
 * runner's zone, which for a player outside the scenario's own timezone put sunrise after sunset
 * and left the sun switched off for the whole game.
 */
function minuteOfDayIn(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((p: Intl.DateTimeFormatPart) => p.type === type)?.value);
  return value("hour") * 60 + value("minute");
}

// returns minutes since midnight, in the location's own timezone
export function getSunriseSunset(
  date: DateType,
  location: LocationType,
): SunriseSunsetType {
  const key = `${date.monthNumber}|${date.year}|${location.id}`;
  const cached = sunriseSunsetCache.get(key);
  if (cached) {
    return cached;
  }

  // Built in UTC rather than parsed from a string, which Date reads in the runner's zone -- the
  // instant handed to suncalc would otherwise shift with the machine too. Midday keeps the
  // instant well inside the day being asked about whatever the location's offset is.
  const calc = getTimes(
    new Date(Date.UTC(date.year, date.monthNumber - 1, 1, 12)),
    location.lat,
    location.long,
  );

  // suncalc returns null above the polar circles, where the sun may never rise or never set
  // on a given day. None of the four locations the game ships get anywhere near that, so
  // these fallbacks are only here to keep a hypothetical high-latitude location from
  // crashing the simulation
  const minuteOfDay = (d: Date | null, fallback: number) =>
    d && !isNaN(d.getTime()) ? minuteOfDayIn(d, location.timeZone) : fallback;

  const times = {
    sunrise: minuteOfDay(calc.sunrise, 6 * 60),
    sunset: minuteOfDay(calc.sunset, 18 * 60),
  };
  sunriseSunsetCache.set(key, times);
  return times;
}

export function getDateFromMinute(
  minute: number,
  startingYear: number,
): DateType {
  const minuteOfDay = minute % 1440;
  const hourOfDay = Math.floor(minuteOfDay / 60);
  const dayOfGame = Math.floor(minute / 1440);
  const dayOfYear = dayOfGame % DAYS_PER_YEAR;
  const monthsEllapsed = Math.floor(dayOfGame / DAYS_PER_MONTH);
  const yearsEllapsed = Math.floor(dayOfGame / DAYS_PER_YEAR);
  const year = yearsEllapsed + startingYear;
  const monthNumber = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
  const month = MONTHS[monthNumber - 1];
  const percentOfMonth = minuteOfDay / 1440;
  const minuteOfYear = minute - yearsEllapsed * DAYS_PER_YEAR * 1440;
  const percentOfYear = minuteOfYear / (DAYS_PER_YEAR * 1440);
  const hourOfFullYear = Math.floor(monthNumber * 30 * 24 + hourOfDay);

  return {
    minute,
    minuteOfDay,
    hourOfDay,
    hourOfFullYear,
    percentOfMonth: percentOfMonth || 0.00001,
    percentOfYear: percentOfYear || 0.00001,
    month,
    monthNumber,
    monthsEllapsed,
    year,
  };
}

// eg "4am", "12pm" - a bare clock time for chart axes, where the day and month are already known
export function formatMinuteOfDayChartAxis(minute: number): string {
  const hourOfDay = Math.floor((minute % 1440) / 60);
  return (
    (hourOfDay % 12 === 0 ? 12 : hourOfDay % 12) +
    (hourOfDay < 12 ? "am" : "pm")
  );
}

/**
 * Clock ticks across a span of minutes, snapped to a whole number of hours and spaced so that
 * at most `maxTicks` of them land in the span.
 */
export function getHourTicks(
  rangeMin: number,
  rangeMax: number,
  maxTicks = 6,
): number[] {
  const hoursSpanned = (rangeMax - rangeMin) / 60;
  const step =
    ([1, 2, 3, 4, 6, 8, 12] as number[]).find(
      (h) => hoursSpanned / h <= maxTicks,
    ) || 24;
  const stepMinutes = step * 60;
  const ticks = [];
  for (
    let m = Math.ceil(rangeMin / stepMinutes) * stepMinutes;
    m <= rangeMax;
    m += stepMinutes
  ) {
    ticks.push(m);
  }
  return ticks;
}
