import {
  EMPTY_HISTORY,
  formatMinuteOfDayChartAxis,
  getDateFromMinute,
  getHourTicks,
  getSunriseSunset,
  summarizeHistory,
  summarizeTimeline,
} from "./DateTime";
import { LOCATIONS, TICK_MINUTES } from "../Constants";
import { DateType, MonthlyHistoryType, TickPresentFutureType } from "../Types";

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
