import { render } from "@testing-library/react";
import {
  EMPTY_HISTORY,
  MINUTES_PER_MONTH,
  summarizeTimelineByMonth,
} from "../../helpers/DateTime";
import { TickPresentFutureType } from "../../Types";
import UPlotChart from "./UPlotChart";
import ChartMonthlySpareCapacity, {
  monthlySpareCapacityPoints,
} from "./ChartMonthlySpareCapacity";

jest.mock("./UPlotChart", () => jest.fn(() => null));

const history = (month: number, minimumSupplyMarginW?: number) => ({
  ...EMPTY_HISTORY,
  month,
  year: 2020,
  minimumSupplyMarginW,
  chartAverage: { reserveW: 999e6 } as TickPresentFutureType,
});
const domain = { x: [0, 12 * MINUTES_PER_MONTH] as [number, number] };

beforeEach(() => jest.clearAllMocks());

it("plots measured monthly minima, preserving missing records, zero and negative values", () => {
  const props = {
    past: [history(3, 0), history(2), history(1, 24e6)],
    projected: [history(4, -8e6)],
    startingYear: 2020,
    domain,
  };
  expect(monthlySpareCapacityPoints(props).map((point) => point.value)).toEqual(
    [24e6, null, 0, -8e6],
  );
  render(<ChartMonthlySpareCapacity {...props} />);
  const chart = (UPlotChart as jest.Mock).mock.calls[0][0];
  expect(chart.data).toEqual([
    [0, MINUTES_PER_MONTH, 2 * MINUTES_PER_MONTH, 3 * MINUTES_PER_MONTH],
    [24e6, null, 0, null],
    [null, null, 0, -8e6],
  ]);
  expect(chart.tooltip(1, chart.state)).toContain("Not recorded");
  expect(chart.tooltip(3, chart.state)).toContain(
    "Projected monthly minimum\nLowest reserve: -8MW",
  );
  const options = chart.buildOptions({ getState: () => chart.state, scale: 1 });
  const [min, max] = options.scales.y.range();
  expect(min).toBeLessThan(-8e6);
  expect(max).toBeGreaterThan(24e6);
  expect(options.series[2].dash).toEqual([4, 4]);
});

it("keeps a brief reserve dip from the full simulation summary instead of its monthly average", () => {
  const tick = (minute: number, reserveW: number) =>
    ({
      minute,
      reserveW,
      supplyW: 100e6,
      demandW: 100e6,
      supplyByFuel: {},
      demandByType: {},
    }) as TickPresentFutureType;
  const projected = summarizeTimelineByMonth(
    [
      tick(0, 90e6),
      tick(60, -3e6),
      tick(120, 90e6),
      tick(MINUTES_PER_MONTH, 12e6),
    ],
    2020,
  );
  expect(projected[0].chartAverage!.reserveW).toBeGreaterThan(0);
  expect(
    monthlySpareCapacityPoints({
      past: [],
      projected,
      startingYear: 2020,
      domain,
    }).map((point) => point.value),
  ).toEqual([-3e6, 12e6]);
});

it("retains adjacent months at viewport edges and includes zero for an entirely positive range", () => {
  const props = {
    past: [history(1, -9e6)],
    projected: [
      history(2, 2e6),
      history(3, 4e6),
      history(4, 6e6),
      history(5, 8e6),
    ],
    startingYear: 2020,
    domain: {
      x: [2 * MINUTES_PER_MONTH, 3 * MINUTES_PER_MONTH] as [number, number],
    },
  };
  expect(monthlySpareCapacityPoints(props).map((point) => point.value)).toEqual(
    [2e6, 4e6, 6e6, 8e6],
  );
  render(<ChartMonthlySpareCapacity {...props} />);
  const chart = (UPlotChart as jest.Mock).mock.calls[0][0];
  const options = chart.buildOptions({ getState: () => chart.state, scale: 1 });
  expect(options.scales.y.range()[0]).toBeLessThanOrEqual(0);
  expect(chart.tooltip(0, chart.state)).toContain("Feb 2020");
  expect(
    monthlySpareCapacityPoints({ ...props, past: [], projected: [] }),
  ).toEqual([]);
});
