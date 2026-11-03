import * as React from "react";
import { render, screen } from "@testing-library/react";
import uPlot from "uplot";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { setThemeMode } from "../../Theme";
import { GENERATORS } from "../../data/Facilities";
import {
  GameType,
  GeneratorShoppingType,
  TickPresentFutureType,
} from "../../Types";
import { ChartPresentationContext } from "./ChartPresentationContext";
import ChartFinances from "./ChartFinances";
import ChartForecastDemandByType from "./ChartForecastDemandByType";
import ChartForecastFuelPrices from "./ChartForecastFuelPrices";
import ChartForecastRenewableCapacityFactor from "./ChartForecastRenewableCapacityFactor";
import ChartForecastStorage from "./ChartForecastStorage";
import ChartForecastSupplyByFuel from "./ChartForecastSupplyByFuel";
import ChartForecastSupplyDemand from "./ChartForecastSupplyDemand";
import ChartForecastWater from "./ChartForecastWater";
import ChartForecastWeather from "./ChartForecastWeather";

jest.mock("uplot", () => {
  const MockUPlot = jest.fn();
  MockUPlot.prototype.cursor = {};
  MockUPlot.prototype.setData = jest.fn();
  MockUPlot.prototype.setSize = jest.fn();
  MockUPlot.prototype.setScale = jest.fn();
  MockUPlot.prototype.redraw = jest.fn();
  MockUPlot.prototype.destroy = jest.fn();
  // UPlotHelpers reads the spline path builder at module load
  (MockUPlot as unknown as { paths: { spline: () => unknown } }).paths = {
    spline: jest.fn(() => jest.fn()),
  };
  return { __esModule: true, default: MockUPlot };
});

// The renewable chart asks the build tables for what the fleet can run; one solar plant is
// enough to give it a series without pulling the whole authored data set into this test
jest.mock("../../data/Facilities", () => ({
  GENERATORS: jest.fn(),
}));

// A tick carrying every field the forecast charts read, so each one renders on its own.
// The fuel-price index signature on the tick type fights a full literal, so it is cast
function makeTick(minute: number): TickPresentFutureType {
  return {
    minute,
    supplyW: 100_000,
    demandW: 90_000,
    cash: 1_000,
    customers: 100,
    netWorth: 5_000,
    revenue: 9_000,
    expensesFuel: 4_000,
    expensesOM: 1_000,
    expensesCarbonFee: 500,
    expensesInterest: 100,
    kgco2e: 5_000,
    interestRate: 0.1,
    inflationRate: 0.02,
    demandByType: {
      Residential: 30_000,
      Commercial: 25_000,
      Industrial: 20_000,
      Transportation: 8_000,
      "Data Centers": 4_000,
      Mining: 3_000,
    },
    solarIrradianceWM2: 400,
    windKph: 10,
    windAirborneKph: 12,
    temperatureC: 10,
    storedWh: 5_000_000,
    precipitationMm: 8,
    snowpackMm: 2,
    hydroRunoffMm: 3,
    hydroReservoirWh: 20_000_000,
    hydroReservoirCapacityWh: 40_000_000,
    hydroSpillWh: 0,
    hydroMandatedReleaseW: 0,
    storageLossWh: 100_000,
    customerRate: 0.12,
    supplyByFuel: { Coal: 50_000, "Natural Gas": 40_000 },
    renewableCapacityFactors: { Solar: 0.5 },
    Biomass: 1.5,
    "Natural Gas": 3,
    Coal: 90,
    Uranium: 25,
    Oil: 60,
  } as unknown as TickPresentFutureType;
}

const STARTING_YEAR = 2026;
const timeline = [
  makeTick(0),
  makeTick(MINUTES_PER_MONTH),
  makeTick(2 * MINUTES_PER_MONTH),
];
const domain = { x: [0, 2 * MINUTES_PER_MONTH] as [number, number] };

// Render a chart at exactly the design width (scale 1) and hand back the options uPlot was
// built with, so a test can check what the plot will actually reserve on each side
function buildOptions(element: React.ReactElement): uPlot.Options {
  const { unmount } = render(element);
  try {
    const call = (uPlot as unknown as jest.Mock).mock.calls.at(-1)!;
    return call[0] as uPlot.Options;
  } finally {
    unmount();
  }
}

describe("insight forecast charts", () => {
  beforeEach(() => {
    // react-scripts runs Jest with resetMocks, which wipes implementations set at module
    // scope before every test; the mock itself survives, so give it its behaviour here
    (GENERATORS as unknown as jest.Mock).mockImplementation(() => [
      { name: "Solar", fuel: "Sun", available: true } as GeneratorShoppingType,
    ]);
    setThemeMode("light");
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // 350 is the design width, so chartScale is exactly one and every length in the options
    // comes out in design units
    jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          width: 350,
          height: 200,
          top: 0,
          right: 350,
          bottom: 200,
          left: 0,
          x: 0,
          y: 0,
          toJSON: () => undefined,
        }) as DOMRect,
    );
    window.ResizeObserver = class {
      public observe() {
        return undefined;
      }
      public unobserve() {
        return undefined;
      }
      public disconnect() {
        return undefined;
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders larger canvas fonts, measured gutters, height and strokes only in expanded presentation", () => {
    const chart = (
      <ChartForecastWater
        timeline={timeline}
        domain={domain}
        startingYear={STARTING_YEAR}
        multiyear={false}
        height={140}
      />
    );
    const view = render(chart);
    const compact = (uPlot as unknown as jest.Mock).mock.calls.at(
      -1,
    )[0] as uPlot.Options;
    expect(compact.axes![1].font).toMatch(/^12px /);
    view.rerender(
      <ChartPresentationContext.Provider
        value={{ height: 500, fontScale: 4 / 3 }}
      >
        {chart}
      </ChartPresentationContext.Provider>,
    );
    const expanded = (uPlot as unknown as jest.Mock).mock.calls.at(
      -1,
    )[0] as uPlot.Options;
    expect(expanded.height).toBe(500);
    expect(expanded.axes![1].font).toMatch(/^16px /);
    expect(expanded.axes![2].labelFont).toMatch(/^16px /);
    const size = expanded.axes![2].size as uPlot.Axis.Size;
    const reserve =
      typeof size === "function"
        ? size({} as uPlot, ["100000000GWh"], 2, 0)
        : size;
    expect(reserve).toBeGreaterThan(100);
    expect(expanded.series[1].width).toBeGreaterThan(
      compact.series[1].width as number,
    );
    expect(expanded.series[3].dash).toEqual(compact.series[3].dash);
  });

  it("thins enlarged date ticks to fit the actual plot width, retaining both endpoints", () => {
    render(
      <ChartPresentationContext.Provider
        value={{ height: 500, fontScale: 4 / 3 }}
      >
        <ChartForecastWater
          timeline={timeline}
          domain={{ x: [0, 24 * MINUTES_PER_MONTH] }}
          startingYear={2024}
          multiyear
        />
      </ChartPresentationContext.Provider>,
    );
    const options = (uPlot as unknown as jest.Mock).mock.calls.at(
      -1,
    )[0] as uPlot.Options;
    const splits = options.axes![0].splits as Exclude<
      uPlot.Axis.Splits,
      number[]
    >;
    const ticks = (width: number) =>
      splits(
        { width, bbox: { width } } as uPlot,
        0,
        0,
        24 * MINUTES_PER_MONTH,
        0,
        0,
      );
    for (const width of [180, 220, 260]) {
      const narrow = ticks(width);
      expect(narrow.length).toBeLessThanOrEqual(4);
      expect(narrow[0]).toBe(0);
      expect(narrow.at(-1)).toBe(24 * MINUTES_PER_MONTH);
      for (let index = 1; index < narrow.length; index++) {
        const gap =
          ((narrow[index] - narrow[index - 1]) / (24 * MINUTES_PER_MONTH)) *
          width;
        expect(gap).toBeGreaterThanOrEqual(48);
      }
    }
    expect(ticks(1000)).toHaveLength(7);
  });

  it("isolates fuel data, inspected values and accessible series then restores all fuels", () => {
    const props = {
      timeline,
      domain,
      startingYear: STARTING_YEAR,
      multiyear: false,
    };
    const view = render(<ChartForecastFuelPrices {...props} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /Biomass.*Coal.*Natural Gas.*Oil.*Uranium/,
    );
    view.rerender(<ChartForecastFuelPrices {...props} selectedFuel="Coal" />);
    const plot = screen.getByRole("img");
    expect(plot).toHaveAccessibleName(/Coal/);
    expect(plot).not.toHaveAccessibleName(/Biomass|Natural Gas|Oil|Uranium/);
    const args = (uPlot as unknown as jest.Mock).mock.calls.at(-1);
    expect(args[1]).toEqual([
      timeline.map((tick) => tick.minute),
      timeline.map((tick) => tick.Coal),
    ]);
    expect(args[0].series).toHaveLength(2);
    view.rerender(<ChartForecastFuelPrices {...props} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /Biomass.*Coal.*Natural Gas.*Oil.*Uranium/,
    );
    expect(
      (uPlot as unknown as jest.Mock).mock.calls.at(-1)[0].series,
    ).toHaveLength(6);
  });

  // The stacked charts read as one picture under a shared x axis, which only works if every
  // plot ends at the same place. A chart that reserves more trailing room than its neighbours
  // leaves a blank strip on the right; one that reserves less clips its last month label.
  it.each([
    [
      "supply by fuel",
      () => (
        <ChartForecastSupplyByFuel
          timeline={timeline}
          domain={domain}
          startingYear={STARTING_YEAR}
          multiyear={false}
          fuels={["Coal", "Natural Gas"]}
        />
      ),
    ],
    [
      "demand by use",
      () => (
        <ChartForecastDemandByType
          timeline={timeline}
          domain={domain}
          displayTypes={["Residential", "Commercial"]}
          startingYear={STARTING_YEAR}
          multiyear={false}
        />
      ),
    ],
    [
      "fuel prices",
      () => (
        <ChartForecastFuelPrices
          timeline={timeline}
          domain={domain}
          startingYear={STARTING_YEAR}
          multiyear={false}
        />
      ),
    ],
    [
      "renewable output",
      () => (
        <ChartForecastRenewableCapacityFactor
          game={{} as GameType}
          timeline={timeline}
          domain={domain}
          startingYear={STARTING_YEAR}
          multiyear={false}
        />
      ),
    ],
    [
      "stored energy",
      () => (
        <ChartForecastStorage
          timeline={timeline}
          domain={domain}
          startingYear={STARTING_YEAR}
          multiyear={false}
        />
      ),
    ],
    [
      "supply and demand",
      () => (
        <ChartForecastSupplyDemand
          timeline={timeline}
          blackouts={[]}
          domain={{ ...domain, y: [0, 100_000] }}
          startingYear={STARTING_YEAR}
          multiyear={false}
        />
      ),
    ],
    [
      "temperature",
      () => (
        <ChartForecastWeather
          timeline={timeline}
          domain={domain}
          startingYear={STARTING_YEAR}
          multiyear={false}
        />
      ),
    ],
    [
      "finance",
      () => (
        <ChartFinances
          title="Cash"
          timeline={Array.from({ length: 6 }, (_, i) => ({
            month: STARTING_YEAR * 12 + i,
            year: STARTING_YEAR,
            value: 1_000 + i * 100,
            projected: i >= 3,
          }))}
          format={(value) => String(value)}
          startingYear={STARTING_YEAR}
          domain={[0, 5 * MINUTES_PER_MONTH]}
        />
      ),
    ],
  ])("%s keeps the title's 16px inset at every width", (_name, makeChart) => {
    for (const width of [350, 700]) {
      jest.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        width,
        height: 200,
        top: 0,
        right: width,
        bottom: 200,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      });
      const options = buildOptions(makeChart());
      expect(options.padding?.[1]).toBe(16);
    }
  });

  it("gives water its right axis instead of the shared padding", () => {
    const options = buildOptions(
      <ChartForecastWater
        timeline={timeline}
        domain={domain}
        startingYear={STARTING_YEAR}
        multiyear={false}
      />,
    );
    // Its plot ends where the reservoir axis begins, so it reserves no padding of its own
    expect(options.padding?.[1]).toBe(0);
    const rightAxis = options.axes?.find((axis) => axis.side === 1);
    expect(rightAxis).toBeDefined();
  });
});
