import * as React from "react";
import uPlot from "uplot";
import { TickPresentFutureType } from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { chartPalette, withAlpha } from "../../Theme";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  anchoredForecastPaths,
  bandsPlugin,
  FORECAST_RIGHT_PAD,
  forecastMonthAxis,
  padRange,
  spansFromEdges,
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
  peakShortfall: number;
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
    } else {
      ranges.push({
        minute: tick.minute,
        projected,
        supplyMin: tick.supplyW,
        supplyMax: tick.supplyW,
        demandMin: tick.demandW,
        demandMax: tick.demandW,
        peakShortfall: Math.max(0, tick.demandW - tick.supplyW),
      });
    }
  }
  return ranges;
}

interface State {
  ranges: MonthlyRange[];
  domain: SupplyDemandProps["domain"];
  startingYear: number;
  multiyear: boolean;
  blackoutSpans: Array<[number, number]>;
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
    padding: [10 * scale, FORECAST_RIGHT_PAD * scale, 0, 0],
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
      bandsPlugin(() => getState().blackoutSpans, palette.blackout, 0.3),
    ],
  };
}

function tooltip(index: number, state: State): string {
  const range = state.ranges[index];
  const date = getDateFromMinute(range.minute, state.startingYear);
  const period = `${date.month} ${date.year}`;
  if (!range.projected) {
    return `${period} · recorded average\nSupply: ${formatWatts(range.supplyMin)}\nDemand: ${formatWatts(range.demandMin)}`;
  }
  return `${period} · forecast range\nSupply: ${formatWatts(range.supplyMin)}–${formatWatts(range.supplyMax)}\nDemand: ${formatWatts(range.demandMin)}–${formatWatts(range.demandMax)}\nPeak shortfall: ${formatWatts(range.peakShortfall)}`;
}

export default function ChartSupplyDemandRanges(
  props: Omit<SupplyDemandProps, "multiyear">,
) {
  const ranges = supplyDemandMonthlyRanges(props.timeline, props.currentMinute);
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
      ariaLabel="Monthly ranges of estimated electricity supply and demand"
      formatSummaryValue={formatWatts}
      height={props.height}
      state={{
        ranges,
        domain: props.domain,
        startingYear: props.startingYear,
        multiyear: true,
        blackoutSpans: spansFromEdges(props.blackouts),
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
