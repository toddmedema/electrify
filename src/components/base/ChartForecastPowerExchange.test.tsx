import { render, screen } from "@testing-library/react";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { chartPalette } from "../../Theme";
import { TickPresentFutureType } from "../../Types";
import ChartForecastPowerExchange, {
  exchangePoints,
  monthlyExchange,
} from "./ChartForecastPowerExchange";
import UPlotChart from "./UPlotChart";
import * as helpers from "./UPlotHelpers";

jest.mock("./UPlotChart", () => jest.fn(() => null));

const MW = 1e6;
const HOUR = 60;

function tick(
  minute: number,
  importedMW: number,
  exportedMW: number,
  pricePerMWh = 50,
  capacityMW = 100,
): TickPresentFutureType {
  return {
    minute,
    importedW: importedMW * MW,
    exportedW: exportedMW * MW,
    marketPricePerMWh: pricePerMWh,
    transmissionCapacityW: capacityMW * MW,
  } as TickPresentFutureType;
}

const hourly = [
  tick(0, 20, 0, 40),
  tick(HOUR, 0, 0, 55),
  tick(2 * HOUR, 0, 30, 65, 80),
  tick(3 * HOUR, 0, 10),
];

const common = {
  startingYear: 2020,
  multiyear: false,
};
const week = { x: [0, 4 * HOUR] as [number, number] };

function chartProps() {
  return (UPlotChart as jest.Mock).mock.calls.at(-1)![0];
}

beforeEach(() => jest.clearAllMocks());

describe("ChartForecastPowerExchange", () => {
  it("plots imports above zero and exports below it, and reads both as sizes", () => {
    render(
      <ChartForecastPowerExchange
        {...common}
        domain={week}
        timeline={hourly}
      />,
    );
    const chart = chartProps();
    expect(chart.data).toEqual([
      [0, HOUR, 2 * HOUR, 3 * HOUR],
      [20 * MW, 0, 0, 0],
      [0, 0, -30 * MW, -10 * MW],
    ]);
    // Screen readers hear how much was exported, not a negative number
    expect(chart.summaryData[2]).toEqual([0, 0, 30 * MW, 10 * MW]);
    expect(chart.seriesLabels).toEqual(["Imports", "Exports"]);
    expect(chart.ariaLabel).toMatch(/imports plot above zero/i);
    expect(Object.is(chart.data[2][0], -0)).toBe(false);
  });

  it("names the sign convention and tells the two directions apart without colour", () => {
    const texture = jest.spyOn(helpers, "patternFill");
    const zeroRule = jest.spyOn(helpers, "zeroLinePlugin");
    try {
      render(
        <ChartForecastPowerExchange
          {...common}
          domain={week}
          timeline={hourly}
        />,
      );
      const options = chartProps().buildOptions({
        getState: () => chartProps().state,
        scale: 1,
      });
      const [, imports, exports] = options.series;
      const palette = chartPalette();
      // One colour for the interties; the texture and the side of zero carry the direction
      expect(imports.stroke).toBe(palette.intertie);
      expect(exports.stroke).toBe(palette.intertie);
      expect(texture.mock.calls.map(([kind]) => kind)).toEqual([
        "vertical",
        "hatch",
      ]);
      expect(zeroRule).toHaveBeenCalledWith(palette.axis);
    } finally {
      texture.mockRestore();
      zeroRule.mockRestore();
    }
    // The key says which is which, in the same textures the plot uses
    expect(screen.getByText("Imports above 0")).toContainHTML(
      "chartLegendSwatch-vertical",
    );
    expect(screen.getByText("Exports below 0")).toContainHTML(
      "chartLegendSwatch-hatch",
    );
  });

  it("keeps zero inside the range with room on the side that never fires", () => {
    render(
      <ChartForecastPowerExchange
        {...common}
        domain={week}
        timeline={[tick(0, 40, 0), tick(HOUR, 10, 0)]}
      />,
    );
    const { state, buildOptions } = chartProps();
    const [low, high] = buildOptions({
      getState: () => state,
      scale: 1,
    }).scales.y.range();
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(40 * MW);
    // Imports only: the empty export side is a sliver, not half the plot
    expect(-low).toBeLessThan(0.25 * high);
  });

  it("reports both directions, the price and the line capacity when inspected", () => {
    render(
      <ChartForecastPowerExchange
        {...common}
        domain={week}
        timeline={hourly}
      />,
    );
    const { tooltip, state } = chartProps();
    const text = tooltip(2, state);
    expect(text).toContain("Imports: 0W");
    expect(text).toContain("Exports: 30MW");
    expect(text).toContain("Neighbor price: $65/MWh");
    expect(text).toContain("Line capacity: 80MW");
    expect(text.split("\n")[0]).toMatch(/2020/);
  });

  it("marks where the forecast begins, but not on the chart's own edge", () => {
    const { rerender } = render(
      <ChartForecastPowerExchange
        {...common}
        domain={week}
        timeline={hourly}
        currentMinute={HOUR}
      />,
    );
    expect(chartProps().state.currentMinute).toBe(HOUR);
    rerender(
      <ChartForecastPowerExchange
        {...common}
        domain={week}
        timeline={hourly}
        currentMinute={0}
      />,
    );
    expect(chartProps().state.currentMinute).toBeNull();
  });

  it("explains an empty period instead of drawing a blank chart", () => {
    render(
      <ChartForecastPowerExchange
        {...common}
        domain={week}
        timeline={[tick(0, 0, 0), tick(HOUR, 0, 0)]}
      />,
    );
    expect(UPlotChart).not.toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent(
      "No imports or exports in this period.",
    );
    expect(screen.queryByText(/Imports above 0/)).toBeNull();
  });

  it("blames the trading rule when trading is closed", () => {
    render(
      <ChartForecastPowerExchange
        {...common}
        domain={week}
        timeline={[]}
        tradingPolicy="CLOSED"
      />,
    );
    expect(UPlotChart).not.toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent("trading is turned off");
  });

  it("plots a multi-year view as monthly averages", () => {
    const month = MINUTES_PER_MONTH;
    const timeline = [
      // A recorded month, already an average
      tick(0, 10, 0, 30),
      tick(month, 0, 0),
      tick(month + 12 * HOUR, 40, 0, 80),
      tick(2 * month, 0, 20, 20),
    ];
    render(
      <ChartForecastPowerExchange
        {...common}
        multiyear
        domain={{ x: [0, 14 * month] }}
        timeline={timeline}
      />,
    );
    const chart = chartProps();
    expect(chart.state.monthly).toBe(true);
    expect(chart.data[0]).toEqual([0, month, 2 * month]);
    expect(chart.data[1][0]).toBeCloseTo(10 * MW);
    // Half the month idle, half importing 40MW
    expect(chart.data[1][1]).toBeCloseTo(20 * MW);
    expect(chart.tooltip(1, chart.state)).toMatch(/^\w{3} 2020 average\n/);
  });
});

describe("monthlyExchange", () => {
  const month = MINUTES_PER_MONTH;

  it("averages imports and exports separately instead of netting them", () => {
    const [only] = monthlyExchange([
      tick(0, 30, 0),
      tick(month / 2, 0, 30),
      tick(month - 1, 0, 30),
    ]);
    expect(only.importedW).toBeGreaterThan(0);
    expect(only.exportedW).toBeGreaterThan(0);
    expect(only.importedW / MW).toBeCloseTo(15, 1);
    expect(only.exportedW / MW).toBeCloseTo(15, 1);
  });

  it("weights the price by the power that flowed at it", () => {
    const [only] = monthlyExchange([
      // Three quarters of the month idle at $200 must not drag down the $50 trades
      tick(0, 0, 0, 200),
      tick((3 * month) / 4, 40, 0, 50),
    ]);
    expect(only.pricePerMWh).toBeCloseTo(50);
  });

  it("falls back to the plain average price in a month with no flow", () => {
    const [only] = monthlyExchange([
      tick(0, 0, 0, 20),
      tick(month / 2, 0, 0, 60),
      tick(month, 0, 0),
    ]);
    expect(only.pricePerMWh).toBeCloseTo(40);
  });

  it("treats a timeline from before interties existed as zero", () => {
    const [only] = monthlyExchange([{ minute: 0 } as TickPresentFutureType]);
    expect(only).toEqual({
      minute: 0,
      importedW: 0,
      exportedW: 0,
      capacityW: 0,
      pricePerMWh: 0,
    });
  });
});

describe("exchangePoints", () => {
  it("drops the repeated first minute a sampled forecast carries", () => {
    const points = exchangePoints(
      [tick(0, 1, 0), tick(0, 1, 0), tick(HOUR, 2, 0)],
      false,
    );
    expect(points.map((point) => point.minute)).toEqual([0, HOUR]);
  });
});
