import {
  EMPTY_HISTORY,
  formatMinuteOfDayChartAxis,
  getDateFromMinute,
  getHourTicks,
  getSunriseSunset,
  MINUTES_PER_MONTH,
  summarizeHistory,
  summarizeTimeline,
  summarizeTimelineByMonth,
} from "./DateTime";
import { LOCATIONS, TICK_MINUTES, TICKS_PER_MONTH } from "../Constants";
import {
  DateType,
  LocationType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../Types";
import { SCENARIOS } from "../data/Scenarios";
import { generateNewTimeline } from "../reducers/Game";
import { createGame } from "../testing/Simulator";

describe("formatMinuteOfDayChartAxis", () => {
  it("should render midnight as 12am", () => {
    expect(formatMinuteOfDayChartAxis(0)).toEqual("12am");
  });

  it("should render noon as 12pm", () => {
    expect(formatMinuteOfDayChartAxis(12 * 60)).toEqual("12pm");
  });

  it("should render the evening peak in 12 hour time", () => {
    expect(formatMinuteOfDayChartAxis(19 * 60)).toEqual("7pm");
  });

  it("should ignore whole days, since the axis only shows a clock", () => {
    expect(formatMinuteOfDayChartAxis(5 * 1440 + 6 * 60)).toEqual("6am");
  });
});

describe("getHourTicks", () => {
  it("should space a day's worth of ticks 4 hours apart", () => {
    const ticks = getHourTicks(0, 1440);
    expect(ticks).toEqual([0, 240, 480, 720, 960, 1200, 1440]);
  });

  it("should snap to whole hours when the range starts mid-hour", () => {
    const ticks = getHourTicks(125, 125 + 1440);
    expect(ticks[0] % 60).toEqual(0);
    expect(ticks.every((t) => t % 60 === 0)).toEqual(true);
  });

  it("should stay inside the range", () => {
    const ticks = getHourTicks(600, 1000);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(600);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(1000);
  });
});

describe("getSunriseSunset", () => {
  const january = getDateFromMinute(0, 2020);
  const july = getDateFromMinute(6 * 1440, 2020);

  it("puts sunrise in the morning and sunset in the evening", () => {
    const { sunrise, sunset } = getSunriseSunset(january, LOCATIONS.SF);
    // Roughly 7:25am and 5:00pm in San Francisco in January
    expect(sunrise).toBeGreaterThan(6 * 60);
    expect(sunrise).toBeLessThan(9 * 60);
    expect(sunset).toBeGreaterThan(16 * 60);
    expect(sunset).toBeLessThan(19 * 60);
    expect(sunset).toBeGreaterThan(sunrise);
  });

  it("gives every location a daylit day in both seasons", () => {
    Object.values(LOCATIONS).forEach((location) => {
      [january, july].forEach((date) => {
        const { sunrise, sunset } = getSunriseSunset(date, location);
        expect(sunset).toBeGreaterThan(sunrise);
        // Nowhere the game ships is anywhere near the polar circles
        expect(sunset - sunrise).toBeGreaterThan(8 * 60);
        expect(sunset - sunrise).toBeLessThan(16 * 60);
      });
    });
  });

  it("has longer days in July than in January", () => {
    const daylight = (date: DateType) => {
      const { sunrise, sunset } = getSunriseSunset(date, LOCATIONS.PIT);
      return sunset - sunrise;
    };
    expect(daylight(july)).toBeGreaterThan(daylight(january));
  });

  /**
   * These used to be read off the Date with getHours(), which answers in the timezone of whatever
   * machine is running. A player east of the scenario's own timezone got a sunrise after its
   * sunset, and since irradiance is only non-zero between the two, the sun never came up: solar
   * panels generated nothing all game and their cost per MWh came out as infinity.
   */
  it("answers in the location's timezone, not the machine's", () => {
    const machineOffsetMinutes = new Date(2020, 0, 1).getTimezoneOffset();
    const { sunrise, sunset } = getSunriseSunset(january, LOCATIONS.SF);
    // The reference values a Los Angeles clock shows, whatever this process is set to
    expect(sunrise).toEqual(445);
    expect(sunset).toEqual(1021);
    // Guards the assertion above from passing only because the runner happens to sit in the
    // location's own zone
    expect(typeof machineOffsetMinutes).toEqual("number");
  });

  it("derives local time from longitude when an arbitrary point has no timezone", () => {
    const arbitrary = {
      id: "arbitrary",
      name: "30 degrees east",
      lat: 0,
      long: 30,
    } as LocationType;
    const { sunrise, sunset } = getSunriseSunset(january, arbitrary);
    expect(sunrise).toBeGreaterThan(5 * 60);
    expect(sunrise).toBeLessThan(7 * 60);
    expect(sunset).toBeGreaterThan(17 * 60);
    expect(sunset).toBeLessThan(19 * 60);
  });

  it("models polar day and night instead of inventing a 6am to 6pm day", () => {
    const tromso = {
      id: "tromso",
      name: "Tromsø, Norway",
      lat: 69.6492,
      long: 18.9553,
      timeZone: "Europe/Oslo",
    } as LocationType;
    expect(getSunriseSunset(january, tromso)).toEqual({
      sunrise: 0,
      sunset: 0,
      daylight: "polar-night",
    });
    expect(getSunriseSunset(july, tromso)).toEqual({
      sunrise: 0,
      sunset: 1440,
      daylight: "polar-day",
    });
  });
});

// The two summarize helpers walk arrays that are ordered opposite ways, and reduceHistories keeps
// the LAST value it sees for point-in-time fields (cash, customers, net worth, the rates). Which
// end of each array is "last" is the whole of what these cover.
describe("summarizeTimeline", () => {
  // Ticks are oldest first, the way generateNewTimeline builds them
  function ticks(values: number[]): TickPresentFutureType[] {
    return values.map(
      (cash: number, i: number) =>
        ({
          minute: i * TICK_MINUTES,
          supplyW: 0,
          demandW: 0,
          cash,
          customers: 1000 + i,
          netWorth: cash * 2,
          revenue: 10,
          expensesFuel: 1,
          expensesOM: 0,
          expensesCarbonFee: 0,
          expensesInterest: 0,
          expensesMarketing: 0,
          kgco2e: 0,
          interestRate: 0.04 + i / 1000,
          inflationRate: 0.02,
        }) as TickPresentFutureType,
    );
  }

  it("reports the balances the period ended on, not the ones it opened with", () => {
    const summary = summarizeTimeline(ticks([100, 200, 300]), 2020);
    expect(summary.cash).toEqual(300);
    expect(summary.netWorth).toEqual(600);
    expect(summary.customers).toEqual(1002);
  });

  it("reports the rate in force at the end of the period", () => {
    const summary = summarizeTimeline(ticks([100, 200, 300]), 2020);
    expect(summary.interestRate).toBeCloseTo(0.042, 10);
  });

  it("still totals the flows across every tick", () => {
    const summary = summarizeTimeline(ticks([100, 200, 300]), 2020);
    expect(summary.revenue).toEqual(30);
    expect(summary.expensesFuel).toEqual(3);
  });

  it("ends on the last tick the filter kept, not the last one in the array", () => {
    const summary = summarizeTimeline(
      ticks([100, 200, 300, 400]),
      2020,
      (t) => t.cash <= 300,
    );
    expect(summary.cash).toEqual(300);
    expect(summary.revenue).toEqual(30);
  });
});

describe("summarizeHistory", () => {
  // Months are newest first, the way state.monthlyHistory is built by unshifting
  function months(values: number[]): MonthlyHistoryType[] {
    return values.map(
      (cash: number) =>
        ({
          ...EMPTY_HISTORY,
          cash,
          netWorth: cash * 2,
          revenue: 10,
        }) as MonthlyHistoryType,
    );
  }

  it("reports the balances of the most recent month", () => {
    // Newest first, so 300 is the newest month and 100 the oldest
    const summary = summarizeHistory(months([300, 200, 100]));
    expect(summary.cash).toEqual(300);
    expect(summary.netWorth).toEqual(600);
  });

  it("still totals the flows across every month", () => {
    expect(summarizeHistory(months([300, 200, 100])).revenue).toEqual(30);
  });
});

describe("summarizeTimelineByMonth", () => {
  const startingYear = SCENARIOS[0].startingYear;

  /**
   * The finances chart used to build its projection by calling summarizeTimeline once per month
   * with a filter. This has to be the same answer, or a projected month would stop reading the
   * way a recorded one does at the point the two meet on the chart.
   */
  it("should match summarizing each month separately", () => {
    const game = createGame({ scenarioId: 103 });
    const timeline = generateNewTimeline(
      game,
      game.timeline[0].cash,
      game.timeline[0].customers,
      TICKS_PER_MONTH * 5,
    );

    const byMonth = summarizeTimelineByMonth(timeline, startingYear);

    const months = new Set(
      timeline.map((t) => Math.floor(t.minute / MINUTES_PER_MONTH)),
    );
    expect(byMonth.length).toEqual(months.size);
    [...months]
      .sort((a, b) => a - b)
      .forEach((month: number, i: number) => {
        expect(byMonth[i]).toEqual(
          summarizeTimeline(
            timeline,
            startingYear,
            (t) => Math.floor(t.minute / MINUTES_PER_MONTH) === month,
          ),
        );
      });
  });

  it("should return the months oldest first", () => {
    const game = createGame({ scenarioId: 103 });
    const timeline = generateNewTimeline(
      game,
      game.timeline[0].cash,
      game.timeline[0].customers,
      TICKS_PER_MONTH * 14,
    );

    const byMonth = summarizeTimelineByMonth(timeline, startingYear);

    const asMonthIndex = (m: MonthlyHistoryType) => m.year * 12 + m.month;
    const indexes = byMonth.map(asMonthIndex);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(new Set(indexes).size).toEqual(indexes.length);
    // Long enough to roll over a year, which the month numbers wrap on but the ordering must not
    expect(byMonth[byMonth.length - 1].year).toBeGreaterThan(byMonth[0].year);
  });

  it("should total the same as summarizing the whole span at once", () => {
    const game = createGame({ scenarioId: 103 });
    const timeline = generateNewTimeline(
      game,
      game.timeline[0].cash,
      game.timeline[0].customers,
      TICKS_PER_MONTH * 6,
    );

    const byMonth = summarizeTimelineByMonth(timeline, startingYear);
    const whole = summarizeTimeline(timeline, startingYear);

    const totalRevenue = byMonth.reduce(
      (sum: number, m: MonthlyHistoryType) => sum + m.revenue,
      0,
    );
    expect(totalRevenue).toBeCloseTo(whole.revenue, 4);
    // Ending values are carried rather than added, so the whole timeline's are the last
    // month's - not the first month's, which is where they landed while both helpers walked
    // their ticks backwards
    expect(byMonth[byMonth.length - 1].cash).toEqual(whole.cash);
    expect(byMonth[0].cash).not.toEqual(whole.cash);
  });
});
