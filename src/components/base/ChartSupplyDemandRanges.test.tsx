import { render } from "@testing-library/react";
import { TickPresentFutureType } from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { forecastShortfalls } from "../../helpers/ForecastShortfalls";
import ChartSupplyDemandRanges, {
  formatWattRange,
  monthlyShortfalls,
  supplyDemandMonthlyRanges,
} from "./ChartSupplyDemandRanges";
import UPlotChart from "./UPlotChart";
import { spansFromEdges } from "./UPlotHelpers";

jest.mock("./UPlotChart", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

interface State {
  shortfalls: Array<{ from: number; to: number }>;
}

const tick = (minute: number, supplyW: number, demandW: number) =>
  ({ minute, supplyW, demandW }) as TickPresentFutureType;

it("keeps brief extrema and actual coincident shortfalls in each forecast month", () => {
  const ranges = supplyDemandMonthlyRanges(
    [
      tick(0, 120, 100),
      tick(60, 30, 80),
      tick(120, 200, 220),
      tick(MINUTES_PER_MONTH, 100, 100),
    ],
    0,
  );
  expect(ranges).toEqual([
    {
      minute: 0,
      projected: true,
      supplyMin: 30,
      supplyMax: 200,
      demandMin: 80,
      demandMax: 220,
      peakShortfall: 50,
      shortSamples: 2,
      samples: 3,
    },
    {
      minute: MINUTES_PER_MONTH,
      projected: true,
      supplyMin: 100,
      supplyMax: 100,
      demandMin: 100,
      demandMax: 100,
      peakShortfall: 0,
      shortSamples: 0,
      samples: 1,
    },
  ]);
});

it("keeps a recorded monthly average separate from that month's forecast", () => {
  const ranges = supplyDemandMonthlyRanges(
    [tick(0, 100, 90), tick(60, 70, 80), tick(120, 150, 100)],
    60,
  );
  expect(ranges).toHaveLength(2);
  expect(ranges[0]).toMatchObject({
    projected: false,
    supplyMin: 100,
    supplyMax: 100,
  });
  expect(ranges[1]).toMatchObject({
    projected: true,
    supplyMin: 70,
    supplyMax: 150,
    peakShortfall: 10,
  });
});

it("does not infer a shortage from noncoincident supply and demand extrema", () => {
  expect(
    supplyDemandMonthlyRanges([tick(0, 60, 50), tick(60, 200, 180)], 0)[0]
      .peakShortfall,
  ).toBe(0);
  expect(supplyDemandMonthlyRanges([], 0)).toEqual([]);
});

describe("monthlyShortfalls", () => {
  const month = (index: number) => index * MINUTES_PER_MONTH;

  it("marks a month for one short hour late in the month, where the extrema still look comfortable", () => {
    // Supply never drops below 200 and demand never exceeds 210 except at hour 23, so the
    // plotted ranges overlap by far more than one hour of shortfall would suggest.
    const ranges = supplyDemandMonthlyRanges(
      [
        tick(month(0), 400, 190),
        tick(month(0) + 60 * 22, 220, 200),
        tick(month(0) + 60 * 23, 200, 210),
      ],
      0,
    );
    expect(ranges[0]).toMatchObject({ supplyMin: 200, demandMax: 210 });
    expect(monthlyShortfalls(ranges)).toEqual([
      {
        from: month(0) - MINUTES_PER_MONTH / 2,
        to: month(0) + MINUTES_PER_MONTH / 2,
        severity: 10 / 210,
      },
    ]);
  });

  it("marks only forecast months whose hours actually fall short", () => {
    const ranges = supplyDemandMonthlyRanges(
      [
        // Recorded averages: delivered supply never exceeds demand, so these are not marked.
        tick(month(0), 90, 100),
        tick(month(1), 100, 100),
        // Forecast: the noncoincident extrema of the second month do not make a shortfall.
        tick(month(2), 60, 50),
        tick(month(2) + 60, 200, 180),
        tick(month(3), 50, 100),
      ],
      month(2),
    );
    const bars = monthlyShortfalls(ranges);
    expect(bars).toHaveLength(1);
    expect(bars[0].from).toBe(month(3) - MINUTES_PER_MONTH / 2);
    expect(monthlyShortfalls([])).toEqual([]);
  });

  it("scales severity with the peak shortfall against that month's peak demand and caps it", () => {
    const [mild, total] = monthlyShortfalls(
      supplyDemandMonthlyRanges(
        [tick(month(0), 90, 100), tick(month(1), 0, 100)],
        0,
      ),
    );
    expect(mild.severity).toBeCloseTo(0.1);
    expect(total.severity).toBe(1);
  });

  it("flags exactly the months the hourly shortfall helper flags", () => {
    // Three months of hourly samples with shortages that start late in a month, run across a
    // month boundary, and sit in a single hour.
    const timeline: TickPresentFutureType[] = [];
    for (let minute = 0; minute < 4 * MINUTES_PER_MONTH; minute += 60) {
      const hour = minute / 60;
      const short =
        (hour >= 21 && hour <= 26) || hour === 24 * 2 + 5 || hour === 24 * 3;
      timeline.push(tick(minute, short ? 80 : 150, 100));
    }
    const ranges = supplyDemandMonthlyRanges(timeline, 0);
    const hourly = spansFromEdges(
      forecastShortfalls(timeline, 60, 200).blackouts,
    );
    const hourlyMonths = new Set<number>();
    for (const [from, to] of hourly) {
      for (
        let m = Math.floor(from / MINUTES_PER_MONTH);
        m <= Math.floor((to - 1) / MINUTES_PER_MONTH);
        m++
      ) {
        hourlyMonths.add(m);
      }
    }
    const chartMonths = new Set(
      monthlyShortfalls(ranges).map(({ from }) =>
        Math.round((from + MINUTES_PER_MONTH / 2) / MINUTES_PER_MONTH),
      ),
    );
    expect([...chartMonths].sort()).toEqual([...hourlyMonths].sort());
    expect(chartMonths.size).toBe(4);
  });
});

describe("ChartSupplyDemandRanges", () => {
  const drawnChartProps = (timeline: TickPresentFutureType[]) => {
    render(
      <ChartSupplyDemandRanges
        timeline={timeline}
        domain={{ x: [0, 4 * MINUTES_PER_MONTH], y: [0, 300] }}
        startingYear={2020}
        currentMinute={0}
      />,
    );
    return jest.mocked(UPlotChart).mock.calls.at(-1)![0];
  };

  beforeEach(() => jest.mocked(UPlotChart).mockClear());

  it("marks the months its tooltip reports a shortfall for, and only those", () => {
    const props = drawnChartProps([
      tick(0, 150, 100),
      tick(MINUTES_PER_MONTH, 150, 100),
      tick(MINUTES_PER_MONTH + 60, 80, 100),
      tick(2 * MINUTES_PER_MONTH, 150, 100),
    ]);
    const x = props.data[0] as number[];
    const state = props.state as State;
    const marked = x.map((minute) =>
      state.shortfalls.some(({ from, to }) => minute >= from && minute <= to),
    );
    expect(marked).toEqual([false, true, false]);
    x.forEach((_minute, index) => {
      const text = props.tooltip!(index, state);
      expect(text.includes("Peak shortfall")).toBe(marked[index]);
      expect(text.includes("No shortfall")).toBe(!marked[index]);
    });
    expect(props.tooltip!(1, state)).toContain("Short in 1 of 2 modeled hours");
  });

  it("states how many forecast months are marked for assistive technology", () => {
    expect(
      drawnChartProps([tick(0, 150, 100), tick(MINUTES_PER_MONTH, 80, 100)])
        .ariaLabel,
    ).toContain("1 forecast month with unmet demand marked");
    expect(drawnChartProps([tick(0, 150, 100)]).ariaLabel).toContain(
      "No forecast months with unmet demand",
    );
  });
});

describe("formatWattRange", () => {
  it("reads one value when both ends format the same, and a range otherwise", () => {
    expect(formatWattRange(130e6, 130.2e6)).toBe("130MW");
    expect(formatWattRange(120e6, 130e6)).toBe("120MW–130MW");
  });
});
