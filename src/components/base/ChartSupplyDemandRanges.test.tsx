import { render } from "@testing-library/react";
import { TickPresentFutureType } from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { forecastShortfalls } from "../../helpers/ForecastShortfalls";
import ChartSupplyDemandRanges, {
  formatWattRange,
  monthlyShortfalls,
  shortfallsWithin,
  supplyDemandMonthlyRanges,
} from "./ChartSupplyDemandRanges";
import UPlotChart from "./UPlotChart";
import { shortfallSkyline, spansFromEdges } from "./UPlotHelpers";

jest.mock("./UPlotChart", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

interface State {
  shortfalls: Array<{ from: number; to: number; peakShortfall: number }>;
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
      unmetSum: 70,
      demandSum: 400,
      sampleCount: 3,
    },
    {
      minute: MINUTES_PER_MONTH,
      projected: true,
      supplyMin: 100,
      supplyMax: 100,
      demandMin: 100,
      demandMax: 100,
      peakShortfall: 0,
      unmetSum: 0,
      demandSum: 100,
      sampleCount: 1,
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
        minute: month(0),
        peakShortfall: 10,
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

  it("cuts a bar at the midpoint to its neighbours so it never reaches into their hover span", () => {
    // The forecast begins a third of the way through month 1, so its first point sits closer
    // to month 2's point than half a month away; month 3 is short and a full month from its
    // neighbour.
    const start = month(1) + MINUTES_PER_MONTH / 3;
    const ranges = supplyDemandMonthlyRanges(
      [
        tick(month(0), 100, 100),
        tick(start, 50, 100),
        tick(month(2), 150, 100),
        tick(month(3), 50, 100),
      ],
      start,
    );
    const [first, last] = monthlyShortfalls(ranges);
    // Half a month back, where the recorded point is farther; short of half a month ahead,
    // where the next month's point is closer.
    expect(first.from).toBe(start - MINUTES_PER_MONTH / 2);
    expect(first.to).toBe((start + month(2)) / 2);
    expect(first.to - start).toBeLessThan(MINUTES_PER_MONTH / 2);
    // Evenly spaced neighbours leave the usual half month either side.
    expect(last.from).toBe(month(3) - MINUTES_PER_MONTH / 2);
    expect(last.to).toBe(month(3) + MINUTES_PER_MONTH / 2);
    // Every point's own bar covers it, and no bar covers a different point.
    for (const range of ranges) {
      const covering = monthlyShortfalls(ranges).filter(
        ({ from, to }) => range.minute >= from && range.minute <= to,
      );
      expect(covering).toHaveLength(range.peakShortfall > 0 ? 1 : 0);
    }
  });

  it("keeps only the bars that reach into the plotted domain", () => {
    const bars = [
      { from: 0, to: 10, peakShortfall: 1 },
      { from: 10, to: 20, peakShortfall: 1 },
      { from: 20, to: 30, peakShortfall: 1 },
    ];
    expect(shortfallsWithin(bars, [10, 20])).toEqual([bars[1]]);
    expect(shortfallsWithin(bars, [5, 12])).toEqual([bars[0], bars[1]]);
    expect(shortfallsWithin(bars, [30, 40])).toEqual([]);
    expect(shortfallsWithin([], [0, 10])).toEqual([]);
  });

  it.each([1, 2, 3])(
    "keeps dense rasterized markers inside their hover spans at %ix pixel density",
    (ratio) => {
      const ranges = supplyDemandMonthlyRanges(
        [
          tick(month(0), 50, 100),
          tick(month(1), 100, 100),
          tick(month(2), 100, 100),
        ],
        0,
      );
      const position = (minute: number) =>
        (40.4 + (minute / MINUTES_PER_MONTH) * 0.4) * ratio;
      const [bar] = monthlyShortfalls(ranges);
      const rects = shortfallSkyline(
        [
          {
            x0: position(bar.from),
            x1: position(bar.to),
            heightShare: 0.5,
          },
        ],
        { left: 0, width: 100 * ratio, height: 200 * ratio },
        4 * ratio,
      );
      expect(rects.length).toBeGreaterThan(0);
      for (const rect of rects) {
        expect(rect.x).toBeGreaterThanOrEqual(position(bar.from));
        expect(rect.x + rect.width).toBeLessThanOrEqual(position(bar.to));
      }
      const nextPoint = position(ranges[1].minute);
      expect(
        rects.some(({ x, width }) => nextPoint >= x && nextPoint < x + width),
      ).toBe(false);
    },
  );

  it("uses the peak coincident shortfall in watts, independently of how long it lasts", () => {
    const [mild, total, spread] = monthlyShortfalls(
      supplyDemandMonthlyRanges(
        [
          tick(month(0), 90, 100),
          tick(month(1), 0, 100),
          // One hour in four is half short: an eighth of the month's demand, though the worst
          // hour is half of that hour's.
          tick(month(2), 100, 100),
          tick(month(2) + 60, 100, 100),
          tick(month(2) + 120, 100, 100),
          tick(month(2) + 180, 50, 100),
        ],
        0,
      ),
    );
    expect(mild.peakShortfall).toBe(10);
    expect(total.peakShortfall).toBe(100);
    expect(spread.peakShortfall).toBe(50);
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
        ranges={supplyDemandMonthlyRanges(timeline, 0)}
        domain={{ x: [0, 4 * MINUTES_PER_MONTH], y: [0, 300] }}
        startingYear={2020}
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
      expect(text.includes("peak")).toBe(marked[index]);
      expect(text.includes("No shortfall")).toBe(!marked[index]);
    });
  });

  it("keeps the energy share in the tooltip while the bar carries peak watts", () => {
    const props = drawnChartProps([
      tick(0, 150, 100),
      tick(MINUTES_PER_MONTH, 100, 100),
      tick(MINUTES_PER_MONTH + 60, 80, 100),
      tick(2 * MINUTES_PER_MONTH, 150, 100),
    ]);
    const state = props.state as State;
    const text = props.tooltip!(1, state);
    // 20 of the month's 200 demanded is unmet.
    expect(text).toContain("Demand unmet: 10% (90% served)");
    expect(text.split("\n")[0]).toBe("Feb 2020 · 10W avg unmet · 20W peak");
    expect(text).toContain("10W avg unmet");
    expect(text).not.toContain("hours");
    expect(state.shortfalls[0].peakShortfall).toBe(20);
    expect(props.tooltip!(0, state)).toContain("No shortfall");
  });

  it("does not round a real shortfall down to nothing", () => {
    const hours = Array.from({ length: 24 }, (_unused, hour) =>
      tick(hour * 60, hour === 12 ? 999_900 : 1_000_000, 1_000_000),
    );
    const props = drawnChartProps(hours);
    expect(props.tooltip!(0, props.state as State)).toContain(
      "Demand unmet: <0.1% (>99% served)",
    );
  });

  it("states how many forecast months are marked for assistive technology", () => {
    expect(
      drawnChartProps([tick(0, 150, 100), tick(MINUTES_PER_MONTH, 80, 100)])
        .ariaLabel,
    ).toMatch(
      /1 forecast month with unmet demand marked; the largest peak shortfall is 20W in \w+ 20\d\d/,
    );
    expect(drawnChartProps([tick(0, 150, 100)]).ariaLabel).toContain(
      "No forecast months with unmet demand",
    );
  });

  it("announces the largest peak even when another month leaves a larger share unmet", () => {
    const props = drawnChartProps([
      tick(0, 0, 10),
      tick(MINUTES_PER_MONTH, 980, 1000),
    ]);
    expect(props.ariaLabel).toContain(
      "largest peak shortfall is 20W in Feb 2020",
    );
  });

  it("announces only the marked months inside the plotted domain", () => {
    // The viewport slice keeps one tick past its edge. This one is a month and a half beyond
    // the 0 to 4 month domain, so its bar starts after the edge and paints nothing.
    expect(
      drawnChartProps([
        tick(0, 150, 100),
        tick(MINUTES_PER_MONTH, 80, 100),
        tick(5.5 * MINUTES_PER_MONTH, 80, 100),
      ]).ariaLabel,
    ).toContain("1 forecast month with unmet demand marked");
  });
});

describe("formatWattRange", () => {
  it("reads one value when both ends format the same, and a range otherwise", () => {
    expect(formatWattRange(130e6, 130.2e6)).toBe("130MW");
    expect(formatWattRange(120e6, 130e6)).toBe("120MW–130MW");
  });
});
