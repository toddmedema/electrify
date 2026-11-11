import * as React from "react";
import uPlot from "uplot";
import { TickPresentFutureType } from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { formatRequiredShare } from "../../helpers/ObjectiveRules";
import { chartPalette, withAlpha } from "../../Theme";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  anchoredForecastPaths,
  FORECAST_RIGHT_PAD,
  forecastMonthAxis,
  padRange,
  ShortfallBar,
  shortfallBarsPlugin,
  splitPastProjected,
  yAxis,
} from "./UPlotHelpers";
import { Props as SupplyDemandProps } from "./ChartForecastSupplyDemand";

interface MonthlyRange {
  minute: number;
  projected: boolean;
  supplyMin: number;
  supplyMax: number;
  demandMin: number;
  demandMax: number;
  /** The largest shortfall in any one hour; supply and demand extrema need not coincide. */
  peakShortfall: number;
  /** Energy left unmet and energy demanded, summed over the month's hours. */
  unmetSum: number;
  demandSum: number;
}

/** Aggregate every modeled hour, keeping past monthly averages separate from forecast ranges. */
export function supplyDemandMonthlyRanges(
  timeline: TickPresentFutureType[],
  currentMinute?: number,
): MonthlyRange[] {
  const ranges: MonthlyRange[] = [];
  for (const tick of timeline) {
    const month = Math.floor(tick.minute / MINUTES_PER_MONTH);
    const projected =
      currentMinute !== undefined && tick.minute >= currentMinute;
    const previous = ranges[ranges.length - 1];
    if (
      previous &&
      Math.floor(previous.minute / MINUTES_PER_MONTH) === month &&
      previous.projected === projected
    ) {
      previous.supplyMin = Math.min(previous.supplyMin, tick.supplyW);
      previous.supplyMax = Math.max(previous.supplyMax, tick.supplyW);
      previous.demandMin = Math.min(previous.demandMin, tick.demandW);
      previous.demandMax = Math.max(previous.demandMax, tick.demandW);
      previous.peakShortfall = Math.max(
        previous.peakShortfall,
        tick.demandW - tick.supplyW,
      );
      previous.unmetSum += Math.max(0, tick.demandW - tick.supplyW);
      previous.demandSum += tick.demandW;
    } else {
      ranges.push({
        minute: tick.minute,
        projected,
        supplyMin: tick.supplyW,
        supplyMax: tick.supplyW,
        demandMin: tick.demandW,
        demandMax: tick.demandW,
        peakShortfall: Math.max(0, tick.demandW - tick.supplyW),
        unmetSum: Math.max(0, tick.demandW - tick.supplyW),
        demandSum: tick.demandW,
      });
    }
  }
  return ranges;
}

/**
 * The share of a month's demand left unmet: one minus the "demand served" that scenario goals
 * and scoring measure, from the same hours the chart's tooltip describes.
 */
export function unmetShare(range: MonthlyRange): number {
  return range.demandSum > 0
    ? Math.min(1, range.unmetSum / range.demandSum)
    : 0;
}

/** A share as a percentage, "<0.1%" where it would round to nothing but is not zero. */
function formatUnmet(share: number): string {
  return share < 0.0005 ? "<0.1%" : formatRequiredShare(share);
}

export interface MonthlyShortfall extends ShortfallBar {
  /** The minute of the month's point on the chart. */
  minute: number;
}

/**
 * The forecast months with unmet demand, read from the same ranges the chart plots so a marker
 * and its tooltip can never disagree. Recorded months are averages of delivered energy and are
 * not marked. uPlot snaps the cursor to the nearest month's point, so a month owns the half
 * month either side of it, cut at the midpoint to a neighbouring point where that is closer
 * (the first forecast month starts mid-month), rather than the calendar month that starts there.
 */
export function monthlyShortfalls(ranges: MonthlyRange[]): MonthlyShortfall[] {
  const half = MINUTES_PER_MONTH / 2;
  return ranges.flatMap((range, index) => {
    if (!range.projected || range.peakShortfall <= 0) return [];
    const previous = ranges[index - 1];
    const next = ranges[index + 1];
    return [
      {
        minute: range.minute,
        from: previous
          ? Math.max(range.minute - half, (previous.minute + range.minute) / 2)
          : range.minute - half,
        to: next
          ? Math.min(range.minute + half, (range.minute + next.minute) / 2)
          : range.minute + half,
        unmetShare: unmetShare(range),
      },
    ];
  });
}

/** The bars that reach into the plotted x domain; a bar wholly outside it is not on screen. */
export function shortfallsWithin<T extends ShortfallBar>(
  bars: T[],
  [from, to]: [number, number],
): T[] {
  return bars.filter((bar) => bar.to > from && bar.from < to);
}

interface State {
  ranges: MonthlyRange[];
  domain: SupplyDemandProps["domain"];
  startingYear: number;
  multiyear: boolean;
  shortfalls: ShortfallBar[];
}

function forecastRangePaths(pastIndex: number): uPlot.Series.PathBuilder {
  const range = uPlot.paths.linear!();
  const forecast = anchoredForecastPaths(pastIndex);
  // Preserve uPlot's fill and band paths while keeping the shared, anchored forecast stroke.
  // The stroke-only builder used by line charts cannot fill the area between two range edges.
  return (...args) => ({ ...range(...args), ...forecast(...args) });
}

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  const palette = chartPalette();
  const series: uPlot.Series[] = [{}];
  for (const color of [palette.supply, palette.demand]) {
    for (let edge = 0; edge < 2; edge++) {
      const pastIndex = series.length;
      series.push(
        {
          stroke: color,
          width: color === palette.demand ? 2 : 1,
          points: { show: false },
          spanGaps: false,
        },
        {
          stroke: color,
          width: color === palette.demand ? 2 : 1,
          dash: [4, 4],
          paths: forecastRangePaths(pastIndex),
          points: { show: false },
          spanGaps: false,
        },
      );
    }
  }
  return {
    width: 0,
    height: 0,
    padding: [10 * scale, FORECAST_RIGHT_PAD, 0, 0],
    cursor: {
      x: true,
      y: false,
      points: { show: false },
      drag: { x: false, y: false, setScale: false },
    },
    legend: { show: false },
    scales: {
      x: { time: false, range: () => getState().domain.x },
      y: { range: () => padRange(...getState().domain.y) },
    },
    axes: [
      forecastMonthAxis(scale, getState, true),
      yAxis(scale, {
        values: (_u, splits) =>
          splits.map((value) => formatWattsAxis(value, splits)),
      }),
    ],
    series,
    bands: [
      { series: [3, 1], fill: withAlpha(palette.supply, 0.12) },
      { series: [4, 2], fill: withAlpha(palette.supply, 0.12) },
      { series: [7, 5], fill: withAlpha(palette.demand, 0.06) },
      { series: [8, 6], fill: withAlpha(palette.demand, 0.06) },
    ],
    plugins: [
      shortfallBarsPlugin(() => getState().shortfalls, palette.blackout),
    ],
  };
}

/** A range as formatted; one value when both ends round to the same reading. */
export function formatWattRange(min: number, max: number): string {
  const low = formatWatts(min);
  const high = formatWatts(max);
  return low === high ? low : `${low}–${high}`;
}

function tooltip(index: number, state: State): string {
  const range = state.ranges[index];
  const date = getDateFromMinute(range.minute, state.startingYear);
  const period = `${date.month} ${date.year}`;
  if (!range.projected) {
    return `${period} · recorded average\nSupply: ${formatWatts(range.supplyMin)}\nDemand: ${formatWatts(range.demandMin)}`;
  }
  const share = unmetShare(range);
  const shortfall =
    range.peakShortfall > 0
      ? `Demand unmet: ${formatUnmet(share)} (${share < 0.0005 ? "99.9%" : formatRequiredShare(1 - share)} served)\nPeak shortfall: ${formatWatts(range.peakShortfall)}`
      : "No shortfall";
  return `${period} · forecast range\nSupply: ${formatWattRange(range.supplyMin, range.supplyMax)}\nDemand: ${formatWattRange(range.demandMin, range.demandMax)}\n${shortfall}`;
}

export default function ChartSupplyDemandRanges(
  props: Omit<SupplyDemandProps, "multiyear" | "blackouts">,
) {
  const ranges = supplyDemandMonthlyRanges(props.timeline, props.currentMinute);
  const shortfalls = monthlyShortfalls(ranges);
  // The plot clips to the domain, so only the marks that reach into it are announced.
  const visible = shortfallsWithin(shortfalls, props.domain.x);
  const marked = visible.length;
  const worst = visible.reduce<MonthlyShortfall | undefined>(
    (deepest, bar) =>
      !deepest || bar.unmetShare > deepest.unmetShare ? bar : deepest,
    undefined,
  );
  const worstDate =
    worst && getDateFromMinute(worst.minute, props.startingYear);
  const isProjected = ranges.map((range) => range.projected);
  const data: uPlot.AlignedData = [ranges.map((range) => range.minute)];
  for (const key of [
    "supplyMin",
    "supplyMax",
    "demandMin",
    "demandMax",
  ] as const) {
    const values = splitPastProjected(
      ranges.map((range) => range[key]),
      isProjected,
    );
    data.push(values.past, values.projected);
  }
  return (
    <UPlotChart<State>
      id="chartForecastSupplyDemand"
      ariaLabel={`Monthly ranges of estimated electricity supply and demand. ${worst && worstDate ? `${marked} forecast ${marked === 1 ? "month" : "months"} with unmet demand marked; the worst, ${worstDate.month} ${worstDate.year}, leaves ${formatUnmet(worst.unmetShare)} of demand unmet` : "No forecast months with unmet demand"}`}
      formatSummaryValue={formatWatts}
      height={props.height}
      state={{
        ranges,
        domain: props.domain,
        startingYear: props.startingYear,
        multiyear: true,
        shortfalls,
      }}
      data={data}
      seriesLabels={[
        "Past supply low",
        "Forecast supply low",
        "Past supply high",
        "Forecast supply high",
        "Past demand low",
        "Forecast demand low",
        "Past demand high",
        "Forecast demand high",
      ]}
      buildOptions={buildOptions}
      structureKey="monthly-ranges"
      syncKey={props.syncKey}
      tooltip={tooltip}
    />
  );
}
