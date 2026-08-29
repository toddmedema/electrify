import { getPosition, getTimes } from "suncalc";
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

/** A game month, in minutes -- the unit the forecast charts step their x axis in. */
export const MINUTES_PER_MONTH = DAYS_PER_MONTH * 1440;

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
  netWorth: 0,
  interestRate: 0,
  inflationRate: 0,
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
  acc.expensesCarbonFee += t.expensesCarbonFee;
  acc.expensesInterest += t.expensesInterest;
  acc.cash = t.cash;
  acc.customers = t.customers;
  acc.netWorth = t.netWorth;
  // Rates are a level, not a flow: adding twelve months of them together would be nonsense, so
  // the period reports the one in force at its end
  acc.interestRate = t.interestRate;
  acc.inflationRate = t.inflationRate;
  acc.month = t.month;
  acc.year = t.year;
  return acc;
}

export function deriveExpandedSummary(
  s: MonthlyHistoryType,
): DerivedHistoryType {
  const expenses =
    s.expensesFuel + s.expensesOM + s.expensesCarbonFee + s.expensesInterest;
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

/**
 * Everything reduceHistories does for a single tick, without first building the copy of it that
 * used to be spread into a MonthlyHistoryType. A year-long forecast is over a thousand ticks and
 * a twenty-year one over twenty thousand, so that copy was the bulk of the work.
 */
function accumulateTick(
  summary: MonthlyHistoryType,
  t: TickPresentFutureType,
  startingYear: number,
) {
  const date = getMonthYearFromMinute(t.minute, startingYear);
  // Integrate instantaneous electricity (watts) to watt hours
  // Only electricity isn't multiplied by this during tick calculations (financials are)
  summary.supplyWh +=
    (Math.min(t.demandW, t.supplyW) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
  summary.demandWh += (t.demandW / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
  summary.kgco2e += t.kgco2e;
  summary.revenue += t.revenue;
  summary.expensesFuel += t.expensesFuel;
  summary.expensesOM += t.expensesOM;
  summary.expensesCarbonFee += t.expensesCarbonFee;
  summary.expensesInterest += t.expensesInterest;
  summary.cash = t.cash;
  summary.customers = t.customers;
  summary.netWorth = t.netWorth;
  // Levels rather than flows, carried the same way reduceHistories carries them
  summary.interestRate = t.interestRate;
  summary.inflationRate = t.inflationRate;
  summary.month = date.monthNumber;
  summary.year = date.year;
}

// start + end inclusive - can be used to summarize a month, but also any arbitrary timeline group
export function summarizeTimeline(
  timeline: TickPresentFutureType[],
  startingYear: number,
  filter?: (t: TickPresentFutureType) => boolean,
): MonthlyHistoryType {
  const summary = { ...EMPTY_HISTORY };
  // Ticks are ordered oldest first, so walk forwards: reduceHistories keeps the last value it
  // sees for the point-in-time fields, and the period should report the balances it ended on.
  // Note that summarizeHistory below walks the other way, because monthlyHistory is newest first.
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    if (!filter || filter(t)) {
      accumulateTick(summary, t, startingYear);
    }
  }
  return summary;
}

/**
 * Every month a timeline spans, oldest first, in a single pass.
 *
 * The same answer as calling summarizeTimeline once per month with a filter, which is what the
 * finances chart did while it only ever projected to the end of the current year. That approach
 * is O(months x ticks): twelve scans of a year-long forecast is merely wasteful, but 240 scans of
 * a twenty-year one takes over a second and a half -- more than ten times what simulating those
 * twenty years costs in the first place.
 */
export function summarizeTimelineByMonth(
  timeline: TickPresentFutureType[],
  startingYear: number,
): MonthlyHistoryType[] {
  const byMonth = new Map<number, MonthlyHistoryType>();
  // Forwards, with each tick overwriting the ending values, for the same reason summarizeTimeline
  // does it -- so a month summarized here reads the same way as one recorded during play, and
  // each one reports the balances it ended on rather than the ones it opened with
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    // DAYS_PER_MONTH is 1, so this is the same count getMonthYearFromMinute works from, and it
    // keeps counting past 12 rather than wrapping, which makes it unique across years
    const month = Math.floor(t.minute / MINUTES_PER_MONTH);
    let summary = byMonth.get(month);
    if (!summary) {
      summary = { ...EMPTY_HISTORY };
      byMonth.set(month, summary);
    }
    accumulateTick(summary, t, startingYear);
  }
  return [...byMonth.keys()]
    .sort((a, b) => a - b)
    .map((month) => byMonth.get(month) as MonthlyHistoryType);
}

export function summarizeHistory(
  timeline: MonthlyHistoryType[],
  filter?: (t: MonthlyHistoryType) => boolean,
): MonthlyHistoryType {
  const summary = { ...EMPTY_HISTORY };
  // Months are ordered newest first (state.monthlyHistory is built by unshifting), so walking
  // backwards is what ends on the most recent one - the opposite direction to summarizeTimeline
  // above, for the opposite array order.
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

/**
 * The month label for a point on a forecast chart, whose x is a minute of the game rather than
 * a month index. Every forecast chart's x axis wants this.
 */
export function formatMinuteAsMonthAxis(
  minute: number,
  startingYear: number,
  multiyear: boolean,
): string {
  return formatMonthChartAxis(
    getDateFromMinute(minute, startingYear).monthsEllapsed + 12 * startingYear,
    multiyear,
  );
}

export function formatHour(date: DateType): string {
  const time = new Date(
    `${date.year}-${date.monthNumber}-1 ${Math.floor(date.minuteOfDay / 60)}:00`,
  );
  return time.toLocaleString("en-US", { hour: "numeric", hour12: true });
}

/**
 * "Jan 2030, 4 PM" -- the header line every tooltip on a minute-based chart leads with, matching
 * the month/year/time the app bar shows for the current instant.
 */
export function formatMinuteAsTooltipHeader(
  minute: number,
  startingYear: number,
): string {
  const date = getDateFromMinute(minute, startingYear);
  return `${date.month} ${date.year}, ${formatHour(date)}`;
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

export interface SunriseSunsetType {
  sunrise: number;
  sunset: number;
  daylight: "normal" | "polar-day" | "polar-night";
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
function minuteOfDayIn(date: Date, location: LocationType): number {
  if (location.timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: location.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date);
      const value = (type: string) =>
        Number(
          parts.find((p: Intl.DateTimeFormatPart) => p.type === type)?.value,
        );
      return value("hour") * 60 + value("minute");
    } catch (_error) {
      // Hand-authored coordinates can carry a stale or misspelled zone. They are still playable:
      // fall through to the same solar-time approximation used when no zone was supplied.
    }
  }
  const offsetMinutes = Math.round(location.long / 15) * 60;
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + offsetMinutes + 1440) % 1440;
}

// returns minutes since midnight, in the location's own timezone
export function getSunriseSunset(
  date: DateType,
  location: LocationType,
): SunriseSunsetType {
  const key = `${date.monthNumber}|${date.year}|${location.id}|${location.lat}|${location.long}|${location.timeZone || "solar"}`;
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

  const valid = (d: Date | null): d is Date => !!d && !isNaN(d.getTime());
  let times: SunriseSunsetType;
  if (!valid(calc.sunrise) || !valid(calc.sunset)) {
    // There is no sunrise or sunset during a polar day/night. SunCalc's altitude tells which one
    // it is; sentinels keep every existing daylight calculation simple and truthful.
    const sunUp =
      getPosition(
        new Date(Date.UTC(date.year, date.monthNumber - 1, 1, 12)),
        location.lat,
        location.long,
      ).altitude > 0;
    times = sunUp
      ? { sunrise: 0, sunset: 1440, daylight: "polar-day" }
      : { sunrise: 0, sunset: 0, daylight: "polar-night" };
  } else {
    times = {
      sunrise: minuteOfDayIn(calc.sunrise, location),
      sunset: minuteOfDayIn(calc.sunset, location),
      daylight: "normal",
    };
  }
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
