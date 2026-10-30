import * as React from "react";
import uPlot from "uplot";
import { MonthlyHistoryType } from "../../Types";
import { MINUTES_PER_MONTH, getDateFromMinute } from "../../helpers/DateTime";
import { monthMinute } from "../../helpers/Projection";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { chartPalette } from "../../Theme";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  anchoredForecastPaths,
  bandsPlugin,
  FORECAST_RIGHT_PAD,
  forecastMonthAxis,
  padRange,
  spansBelow,
  splitPastProjected,
  yAxis,
} from "./UPlotHelpers";

interface Props {
  past: MonthlyHistoryType[];
  projected: MonthlyHistoryType[];
  startingYear: number;
  domain: { x: [number, number] };
  height?: number;
  syncKey?: string;
}

/** Use the stored extrema, never monthly averages or a downsampled forecast. */
export function monthlySpareCapacityPoints(props: Props) {
  const points = [
    ...props.past.map((month) => ({ month, projected: false })),
    ...props.projected.map((month) => ({ month, projected: true })),
  ]
    .map(({ month, projected }) => ({
      minute: monthMinute(month, props.startingYear),
      value: month.minimumSupplyMarginW ?? null,
      projected,
    }))
    .sort((a, b) => a.minute - b.minute);
  // Keep the adjacent months so the line reaches both viewport edges.
  const firstInside = points.findIndex(
    (point) => point.minute >= props.domain.x[0],
  );
  const first =
    firstInside < 0
      ? Math.max(0, points.length - 1)
      : Math.max(0, firstInside - 1);
  const firstAfter = points.findIndex(
    (point) => point.minute > props.domain.x[1],
  );
  return points.slice(first, firstAfter < 0 ? points.length : firstAfter + 1);
}

interface State {
  points: ReturnType<typeof monthlySpareCapacityPoints>;
  domain: { x: [number, number]; y: [number, number] };
  startingYear: number;
  multiyear: boolean;
  negativeSpans: Array<[number, number]>;
}

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  const palette = chartPalette();
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
    series: [
      {},
      {
        stroke: palette.supply,
        width: 2,
        points: { show: false },
        spanGaps: false,
      },
      {
        stroke: palette.supply,
        width: 2,
        dash: [4, 4],
        paths: anchoredForecastPaths(1),
        points: { show: false },
        spanGaps: false,
      },
    ],
    plugins: [
      bandsPlugin(() => getState().negativeSpans, palette.blackout),
      {
        hooks: {
          draw: (plot) => {
            const { ctx, bbox } = plot;
            const y = plot.valToPos(0, "y", true);
            ctx.save();
            ctx.strokeStyle = palette.axis;
            ctx.lineWidth = uPlot.pxRatio;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(bbox.left, y);
            ctx.lineTo(bbox.left + bbox.width, y);
            ctx.stroke();
            ctx.restore();
          },
        },
      },
    ],
  };
}

function tooltip(index: number, state: State): string {
  const point = state.points[index];
  const date = getDateFromMinute(point.minute, state.startingYear);
  return `${date.month} ${date.year} · ${point.projected ? "Projected" : "Recorded"} monthly minimum\nLowest reserve: ${point.value === null ? "Not recorded" : formatWatts(point.value)}`;
}

export default function ChartMonthlySpareCapacity(props: Props) {
  const points = monthlySpareCapacityPoints(props);
  const minutes = points.map((point) => point.minute);
  const values = points.map((point) => point.value);
  const split = splitPastProjected(
    values,
    points.map((point) => point.projected),
  );
  let min = 0;
  let max = 0;
  for (const value of values) {
    if (value !== null) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return (
    <UPlotChart<State>
      id="chartMonthlySpareCapacity"
      ariaLabel="Monthly lowest reserve. Negative values mean a reserve deficit; positive reserve does not rule out a blackout"
      formatSummaryValue={formatWatts}
      interactiveTooltip
      height={props.height}
      state={{
        points,
        domain: { x: props.domain.x, y: [min, max] },
        startingYear: props.startingYear,
        multiyear:
          props.domain.x[1] - props.domain.x[0] > 12 * MINUTES_PER_MONTH,
        negativeSpans: spansBelow(minutes, values),
      }}
      data={[minutes, split.past, split.projected]}
      seriesLabels={["Recorded monthly minimum", "Projected monthly minimum"]}
      buildOptions={buildOptions}
      syncKey={props.syncKey}
      tooltip={tooltip}
    />
  );
}
