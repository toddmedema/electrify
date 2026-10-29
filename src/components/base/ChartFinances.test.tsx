import { render } from "@testing-library/react";
import UPlotChart from "./UPlotChart";
import { formatCustomerCount } from "../../helpers/Format";
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

it("uses the axis formatter only for ticks and preserves inspection precision", () => {
  render(
    <ChartFinances
      title="Customers"
      timeline={[{ month: 1, year: 2020, value: 123456, projected: false }]}
      format={formatCustomerCount}
      formatAxis={(value) => formatCustomerCount(value, 2)}
    />,
  );
  const chart = (UPlotChart as jest.Mock).mock.calls[0][0];
  const options = chart.buildOptions({ getState: () => chart.state, scale: 1 });
  expect(options.axes[1].values(null, [123456])).toEqual(["120K"]);
  expect(chart.tooltip(0, chart.state)).toBe("Jan 2020\n123K");
  expect(chart.formatSummaryValue(123456)).toBe("123K");
});
