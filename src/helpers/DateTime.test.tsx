import { formatMinuteOfDayChartAxis, getHourTicks } from "./DateTime";

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
