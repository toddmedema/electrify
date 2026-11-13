import { render, screen } from "@testing-library/react";
import { LOCATIONS } from "../../Constants";
import { TickPresentFutureType } from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import ChartForecastFuelPrices from "./ChartForecastFuelPrices";
import ChartForecastSupplyDemand from "./ChartForecastSupplyDemand";
import ChartForecastSupplyByFuel from "./ChartForecastSupplyByFuel";
import ChartForecastPowerExchange from "./ChartForecastPowerExchange";
import ChartSupplyDemand from "./ChartSupplyDemand";
import ChartSupplyDemandRanges, {
  supplyDemandMonthlyRanges,
} from "./ChartSupplyDemandRanges";
import UPlotChart from "./UPlotChart";

jest.mock("./UPlotChart", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

const timeline = [0, MINUTES_PER_MONTH, 2 * MINUTES_PER_MONTH].map(
  (minute, index) => ({
    minute,
    supplyW: 123e6,
    demandW: 123e6,
    reserveW: 123e6,
    supplyByFuel: { Coal: 123e6 },
    importedW: 123e6,
    exportedW: 123e6,
    transmissionCapacityW: 123e6,
    marketPricePerMWh: 123,
    temperatureC: 40.4,
    windKph: 123,
    Coal: index === 0 ? 10 : 10.1,
  }),
) as TickPresentFutureType[];
const common = {
  timeline,
  currentMinute: MINUTES_PER_MONTH,
  domain: {
    x: [0, 2 * MINUTES_PER_MONTH] as [number, number],
    y: [0, 150e6] as [number, number],
  },
  startingYear: 2020,
  multiyear: false,
};
const chartProps = () => jest.mocked(UPlotChart).mock.calls.at(-1)![0];

beforeEach(() => jest.mocked(UPlotChart).mockClear());

it.each([
  [
    "supply and demand",
    <ChartForecastSupplyDemand {...common} blackouts={[]} />,
    "Supply",
  ],
  [
    "supply by fuel",
    <ChartForecastSupplyByFuel {...common} fuels={["Coal"]} />,
    "Coal",
  ],
  ["power exchange", <ChartForecastPowerExchange {...common} />, "Imports"],
  [
    "daily production",
    <ChartSupplyDemand {...common} location={LOCATIONS.SF} />,
    "Dispatchable",
  ],
])(
  "keeps historical and projected %s tooltips at their own precision",
  (_name, component, label) => {
    render(component);
    const chart = chartProps();
    expect(chart.tooltip!(0, chart.state)).toContain(`${label}: 123MW`);
    expect(chart.tooltip!(1, chart.state)).toContain(`${label}: 120MW`);
    expect(chart.tooltip!(2, chart.state)).toContain(`${label}: 120MW`);
  },
);

it("uses each point's meaning for mixed stacked and exchange summaries", () => {
  for (const component of [
    <ChartForecastSupplyByFuel {...common} fuels={["Coal"]} />,
    <ChartForecastPowerExchange {...common} />,
    <ChartSupplyDemand {...common} location={LOCATIONS.SF} />,
  ]) {
    render(component);
    const chart = chartProps();
    // The shell supplies the point index for latest, minimum and maximum independently.
    const format = chart.formatSummaryValue as (
      value: number,
      series: number,
      point: number,
    ) => string;
    expect(format(123e6, 0, 0)).toBe("123MW");
    expect(format(123e6, 0, 1)).toBe("120MW");
  }
});

it.each([false, true])(
  "separates stacked fuel and exchange ranges across the forecast boundary (monthly=%s)",
  (monthly) => {
    const mixed = timeline.map((tick, index) => ({
      ...tick,
      supplyByFuel: { Coal: (123 + index) * 1e6 },
      importedW: (127 - index) * 1e6,
    }));
    const props = {
      ...common,
      timeline: mixed,
      domain: {
        x: [0, (monthly ? 24 : 2) * MINUTES_PER_MONTH] as [number, number],
      },
    };
    const ActualUPlotChart =
      jest.requireActual<typeof import("./UPlotChart")>("./UPlotChart").default;
    for (const [component, label] of [
      [
        <ChartForecastSupplyByFuel {...props} fuels={["Coal"]} />,
        "Coal cumulative supply: latest 130MW, recorded range 123MW to 123MW, forecast range 120MW to 130MW, trend up",
      ],
      [
        <ChartForecastPowerExchange {...props} />,
        "Imports: latest 130MW, recorded range 127MW to 127MW, forecast range 130MW to 130MW, trend down",
      ],
    ] as const) {
      const view = render(component);
      const utils = render(<ActualUPlotChart {...chartProps()} />);
      expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
        label,
      );
      utils.unmount();
      view.unmount();
    }
  },
);

it("keeps the split historical and forecast summary series at their own precision", () => {
  for (const component of [
    <ChartForecastSupplyDemand {...common} blackouts={[]} />,
    <ChartSupplyDemandRanges
      {...common}
      ranges={supplyDemandMonthlyRanges(timeline, MINUTES_PER_MONTH)}
    />,
  ]) {
    render(component);
    const chart = chartProps();
    expect(chart.tooltip!(0, chart.state)).toContain("Supply: 123MW");
    expect(chart.tooltip!(1, chart.state)).toContain("Supply: 120MW");
    for (let series = 0; series < chart.data.length - 1; series++) {
      expect(chart.formatSummaryValue!(123e6, series, 0)).toBe(
        series % 2 === 0 ? "123MW" : "120MW",
      );
    }
  }
});

it.each([false, true])(
  "keeps exchange price/capacity precision and current-point forecast meaning (monthly=%s)",
  (monthly) => {
    render(
      <ChartForecastPowerExchange
        {...common}
        domain={{ x: [0, (monthly ? 24 : 2) * MINUTES_PER_MONTH] }}
      />,
    );
    const chart = chartProps();
    expect(chart.tooltip!(0, chart.state)).toContain(
      "Neighbor price: $123/MWh",
    );
    expect(chart.tooltip!(0, chart.state)).toContain("Line capacity: 123MW");
    expect(chart.tooltip!(1, chart.state)).toContain(
      "Neighbor price: $120/MWh",
    );
    expect(chart.tooltip!(1, chart.state)).toContain("Line capacity: 120MW");
    expect(chart.tooltip!(1, chart.state).includes("forecast average")).toBe(
      monthly,
    );
  },
);

it("keeps recorded daily weather and forecast weather at their own precision", () => {
  render(<ChartSupplyDemand {...common} location={LOCATIONS.SF} />);
  const chart = chartProps();
  expect(chart.tooltip!(0, chart.state)).toContain("Windy 123 km/h");
  expect(chart.tooltip!(1, chart.state)).toContain("Windy 120 km/h");
});

it("keeps the current monthly fuel average at forecast precision", () => {
  render(
    <ChartForecastSupplyByFuel
      {...common}
      fuels={["Coal"]}
      domain={{ x: [0, 24 * MINUTES_PER_MONTH] }}
    />,
  );
  const chart = chartProps();
  expect(chart.tooltip!(1, chart.state)).toContain("forecast average");
  expect(chart.tooltip!(1, chart.state)).toContain("Coal: 120MW");
});

it("preserves recorded meaning when a chart has no forecast boundary", () => {
  render(
    <ChartForecastSupplyDemand
      {...common}
      currentMinute={undefined}
      blackouts={[]}
    />,
  );
  const chart = chartProps();
  expect(chart.tooltip!(1, chart.state)).toContain("Supply: 123MW");
});

it.each([10, 123, 0.1])(
  "spaces fuel-price ticks so a flat $%s forecast has distinct two-digit labels",
  (price) => {
    render(
      <ChartForecastFuelPrices
        {...common}
        selectedFuel="Coal"
        timeline={timeline.map((tick) => ({ ...tick, Coal: price }))}
      />,
    );
    const chart = chartProps();
    const options = chart.buildOptions({
      getState: () => chart.state,
      scale: 1,
    });
    // Exercise the range/split/value callbacks actually passed to uPlot.
    const range = options.scales!.y!.range as (
      plot: unknown,
      min: number,
      max: number,
    ) => [number, number];
    const [min, max] = range(null, price, price);
    const axis = options.axes![1];
    const splits = (
      axis.splits as (
        plot: unknown,
        axis: number,
        min: number,
        max: number,
      ) => number[]
    )(null, 1, min, max);
    const labels = (
      axis.values as (plot: unknown, splits: number[]) => string[]
    )(null, splits);
    expect(splits.length).toBeGreaterThanOrEqual(2);
    expect(new Set(labels).size).toBe(labels.length);
    labels.forEach((label, index) => {
      expect(Number(label.replace("$", ""))).toBeCloseTo(splits[index], 8);
      expect(Number(label.replace("$", ""))).toBe(
        Number(splits[index].toPrecision(2)),
      );
    });
    expect(min).toBeLessThan(price);
    expect(max).toBeGreaterThan(price);
  },
);
