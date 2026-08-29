import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import { padRange, stepTicks, titlePlugin, xAxis, yAxis } from "./UPlotHelpers";
import {
  formatMinuteAsMonthAxis,
  formatMonthChartAxis,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { MONTHS } from "../../Constants";
import { chartPalette } from "../../Theme";

interface ChartData {
  month: number; // unique across years
  year: number;
  value: number;
  projected: boolean;
}

export interface Props {
  height?: number;
  id?: string;
  title: string;
  timeline: ChartData[];
  format: (n: number) => number | string;
  /**
   * Insights draws finance beside operational forecasts. Supplying these puts the financial
   * series on the same minute scale so uPlot can synchronize their cursors honestly.
   */
  startingYear?: number;
  domain?: [number, number];
  syncKey?: string;
}

interface State {
  timeline: ChartData[];
  title: string;
  format: Props["format"];
  range: [number, number];
  domain: [number, number];
  multiyear: boolean;
  startingYear?: number;
}

/**
 * Finances normally plots one x unit per month. Insights converts those points to game minutes
 * so its cursor can line up with the forecast charts, and must convert the tick unit with them.
 */
export function financeXTicks(
  range: [number, number],
  minuteScale: boolean,
): number[] {
  return stepTicks(range[0], range[1], minuteScale ? MINUTES_PER_MONTH : 1);
}

/** Convert the finance series' absolute month index to the minute scale used by Insights. */
export function financeXValue(
  point: Pick<ChartData, "month">,
  startingYear?: number,
): number {
  return startingYear === undefined
    ? point.month
    : (point.month - startingYear * 12 - 1) * MINUTES_PER_MONTH;
}

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  return {
    width: 0, // set by UPlotChart
    height: 0,
    // Month labels are centred on their ticks. The final tick sits on the plot edge,
    // so reserve half a label beyond it rather than clipping its trailing characters.
    padding: [10 * scale, 24 * scale, 0, 0],
    cursor: {
      x: true,
      y: false,
      points: { show: false },
      drag: { x: false, y: false, setScale: false },
    },
    legend: { show: false },
    scales: {
      x: { time: false, range: () => getState().range },
      y: { range: () => getState().domain },
    },
    axes: [
      xAxis(scale, {
        splits: () => {
          const state = getState();
          return financeXTicks(state.range, state.startingYear !== undefined);
        },
        values: (_u, splits) => {
          const s = getState();
          return splits.map((t) =>
            s.startingYear === undefined
              ? formatMonthChartAxis(t, s.multiyear)
              : formatMinuteAsMonthAxis(t, s.startingYear, s.multiyear),
          );
        },
      }),
      yAxis(scale, {
        grid: true,
        values: (_u, splits) => splits.map((t) => String(getState().format(t))),
      }),
    ],
    series: [
      {},
      {
        stroke: chartPalette().demand,
        width: 2,
        points: { show: false },
        spanGaps: false,
      },
      {
        stroke: chartPalette().demand,
        width: 2,
        dash: [4, 4],
        points: { show: false },
        spanGaps: false,
      },
    ],
    plugins: [titlePlugin(() => getState().title, 7)],
  };
}

function tooltip(idx: number, state: State): string {
  const d = state.timeline[idx];
  const monthName = MONTHS[(d.month - 1) % 12];
  return `${monthName} ${d.year}\n${state.format(d.value)}`;
}

const ChartFinances = (props: Props): React.JSX.Element => {
  // Figure out the boundaries of the chart data
  let domainMin = 0;
  let domainMax = 0;
  const minuteScale = props.startingYear !== undefined;
  const xValue = (d: ChartData) => financeXValue(d, props.startingYear);
  const firstX = xValue(props.timeline[0]);
  const lastX = xValue(props.timeline[props.timeline.length - 1]);
  const defaultSpan = minuteScale ? 11 * MINUTES_PER_MONTH : 11;
  const rangeMin = props.domain?.[0] ?? firstX;
  const rangeMax = props.domain?.[1] ?? Math.max(rangeMin + defaultSpan, lastX);
  // One aligned x per month, with each half of the series blanked out where the other one runs,
  // so that recorded months draw solid and projected ones dashed
  const months = new Array<number>(props.timeline.length);
  const past = new Array<number | null>(props.timeline.length);
  const projected = new Array<number | null>(props.timeline.length);
  let lastPast = -1;
  props.timeline.forEach((d: ChartData, i: number) => {
    domainMin = Math.min(domainMin, d.value);
    domainMax = Math.max(domainMax, d.value);
    months[i] = xValue(d);
    past[i] = d.projected ? null : d.value;
    projected[i] = d.projected ? d.value : null;
    if (!d.projected) {
      lastPast = i;
    }
  });
  // The projection picks up where the record leaves off, rather than starting a month adrift
  if (lastPast > -1 && lastPast + 1 < props.timeline.length) {
    projected[lastPast] = props.timeline[lastPast].value;
  }
  const multiyear =
    rangeMax - rangeMin > (minuteScale ? 12 * MINUTES_PER_MONTH : 12);

  const state: State = {
    timeline: props.timeline,
    title: props.title,
    format: props.format,
    range: [rangeMin, rangeMax],
    domain: padRange(domainMin, domainMax),
    multiyear,
    startingYear: props.startingYear,
  };

  return (
    <UPlotChart<State>
      ariaLabel={`Chart of ${props.title} over time`}
      formatSummaryValue={(value) => String(state.format(value))}
      id={props.id || "chartFinances"}
      height={props.height}
      state={state}
      data={[months, past, projected]}
      seriesLabels={[`Past ${props.title}`, `Forecast ${props.title}`]}
      buildOptions={buildOptions}
      syncKey={props.syncKey}
      tooltip={tooltip}
    />
  );
};
/**
 * The series only changes when a month rolls over or the player changes something, so memoising
 * lets the whole chart -- data prep, aligned arrays and the canvas redraw -- be skipped on the
 * frames in between. Finances hands over a referentially stable series for exactly this.
 */
export default React.memo(ChartFinances);
