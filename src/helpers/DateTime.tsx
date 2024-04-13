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
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../Types";
const SunCalc = require("suncalc");

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
  t: MonthlyHistoryType
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
  s: MonthlyHistoryType
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
  filter?: (t: TickPresentFutureType) => boolean
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
  filter?: (t: MonthlyHistoryType) => boolean
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
  timeline: TickPresentFutureType[]
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
    `${date.year}-${date.monthNumber}-1 ${Math.floor(date.minuteOfDay / 60)}:00`
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

// returns minutes since midnight
export function getSunriseSunset(date: DateType, lat: number, long: number) {
  const calc = SunCalc.getTimes(
    new Date(`${date.month} 1, ${date.year}`),
    lat,
    long
  );

  return {
    sunrise: calc.sunrise.getHours() * 60 + calc.sunrise.getMinutes(),
    sunset: calc.sunset.getHours() * 60 + calc.sunset.getMinutes(),
  };
}

export function getDateFromMinute(
  minute: number,
  startingYear: number
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
