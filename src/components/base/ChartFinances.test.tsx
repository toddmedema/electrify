import { render } from "@testing-library/react";
import UPlotChart from "./UPlotChart";
import {
  formatCustomerCount,
  formatForecastNumber,
} from "../../helpers/Format";
import ChartFinances from "./ChartFinances";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { financeXTicks, financeXValue } from "./ChartFinances";

describe("finance chart x values", () => {
  it("converts its absolute month index to Insights' game-minute scale", () => {
    expect(financeXValue({ month: 2020 * 12 + 3 }, 2020)).toBe(
      2 * MINUTES_PER_MONTH,
    );
    expect(financeXValue({ month: 2025 * 12 + 3 }, 2020)).toBe(
      62 * MINUTES_PER_MONTH,
    );
  });
});

describe("finance chart x ticks", () => {
  it("uses month-sized units when Insights plots on the game-minute scale", () => {
    const ticks = financeXTicks([0, 20 * 12 * MINUTES_PER_MONTH], true);

    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.every((tick) => tick % MINUTES_PER_MONTH === 0)).toBe(true);
  });
});

jest.mock("./UPlotChart", () => jest.fn(() => null));

beforeEach(() => jest.clearAllMocks());

it("aligns January year labels and loss bands on Insights' minute axis", () => {
  render(
    <ChartFinances
      title="score"
      startingYear={2022}
      domain={[0, 59 * MINUTES_PER_MONTH]}
      timeline={[
        { month: 2022 * 12 + 1, year: 2022, value: 0, projected: false },
        { month: 2025 * 12 + 1, year: 2025, value: 10, projected: true },
      ]}
      formatProjected={String}
      format={String}
      warningSpans={[[36 * MINUTES_PER_MONTH, 60 * MINUTES_PER_MONTH]]}
      warningNote="Projected loss"
    />,
  );
  const chart = (UPlotChart as jest.Mock).mock.calls[0][0];
  const options = chart.buildOptions({ getState: () => chart.state, scale: 1 });
  expect(chart.data[0]).toEqual([0, 36 * MINUTES_PER_MONTH]);
  expect(options.axes[0].values(null, [0, 36 * MINUTES_PER_MONTH])).toEqual([
    "2022",
    "2025",
  ]);
  expect(chart.tooltip(1, chart.state)).toContain("Jan 2025");
  expect(chart.tooltip(1, chart.state)).toContain("Projected loss");
});

it("shades projected failure periods even when the score is positive and explains them on inspection", () => {
  render(
    <ChartFinances
      title="score"
      timeline={[
        { month: 1, year: 2020, value: 100, projected: false },
        { month: 2, year: 2020, value: 200, projected: true },
        { month: 3, year: 2020, value: 300, projected: true },
      ]}
      formatProjected={String}
      format={String}
      warningSpans={[[2, 3]]}
      warningNote="Projected loss"
    />,
  );
  const chart = (UPlotChart as jest.Mock).mock.calls[0][0];
  const options = chart.buildOptions({ getState: () => chart.state, scale: 1 });
  const ctx = {
    save: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    fillRect: jest.fn(),
    restore: jest.fn(),
  };
  options.plugins.at(-1).hooks.draw({
    ctx,
    bbox: { left: 0, top: 10, width: 300, height: 100 },
    valToPos: (value: number) => value * 100,
  });
  expect(ctx.fillRect).toHaveBeenCalledWith(200, 10, 100, 100);
  expect(chart.tooltip(0, chart.state)).not.toContain("Projected loss");
  expect(chart.tooltip(1, chart.state)).toContain("Projected loss");
});

it("uses the axis formatter only for ticks and preserves inspection precision", () => {
  render(
    <ChartFinances
      title="Customers"
      timeline={[{ month: 1, year: 2020, value: 123456, projected: false }]}
      formatProjected={String}
      format={formatCustomerCount}
      formatAxis={(value) => formatCustomerCount(value, 2)}
    />,
  );
  const chart = (UPlotChart as jest.Mock).mock.calls[0][0];
  const options = chart.buildOptions({ getState: () => chart.state, scale: 1 });
  expect(options.axes[1].values(null, [123456])).toEqual(["120k"]);
  expect(chart.tooltip(0, chart.state)).toBe("Jan 2020\n123k");
  expect(chart.formatSummaryValue(123456)).toBe("123k");
});

it("uses three digits for recorded values and two for projected tooltips and summaries", () => {
  render(
    <ChartFinances
      title="Customers"
      timeline={[
        { month: 1, year: 2020, value: 561952, projected: false },
        { month: 2, year: 2020, value: 561952, projected: true },
      ]}
      format={formatCustomerCount}
      formatProjected={formatForecastNumber}
    />,
  );
  const chart = (UPlotChart as jest.Mock).mock.calls[0][0];
  expect(chart.tooltip(0, chart.state)).toBe("Jan 2020\n562k");
  expect(chart.tooltip(1, chart.state)).toBe("Feb 2020\n560k");
  expect(chart.formatSummaryValue(561952, 0)).toBe("562k");
  expect(chart.formatSummaryValue(561952, 1)).toBe("560k");
  expect(chart.data[1][0]).toBe(561952);
});
