import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import { padRange, stepTicks, titlePlugin, xAxis, yAxis } from "./UPlotHelpers";
import { formatMonthChartAxis } from "../../helpers/DateTime";
import { demandColor } from "../../Theme";

interface ChartData {
  month: number; // unique across years
  year: number;
  value: number;
  projected: boolean;
}

export interface Props {
  height?: number;
  title: string;
  timeline: ChartData[];
  format: (n: number) => number | string;
}

interface State {
  timeline: ChartData[];
  title: string;
  format: Props["format"];
  range: [number, number];
  domain: [number, number];
  multiyear: boolean;
}

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  return {
    width: 0, // set by UPlotChart
    height: 0,
    padding: [10 * scale, 5 * scale, 0, 0],
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
          const [min, max] = getState().range;
          return stepTicks(min, max, 1);
        },
        values: (_u, splits) => {
          const s = getState();
          return splits.map((t) => formatMonthChartAxis(t, s.multiyear));
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
        stroke: demandColor,
        width: 2,
        points: { show: false },
        spanGaps: false,
      },
      {
        stroke: demandColor,
        width: 2,
        dash: [4, 4],
        points: { show: false },
        spanGaps: false,
      },
    ],
    plugins: [titlePlugin(() => getState().title, 200, 7)],
  };
}

function tooltip(idx: number, state: State): string {
  return state.format(state.timeline[idx].value).toString();
}

const ChartFinances = (props: Props): React.JSX.Element => {
  // Figure out the boundaries of the chart data
  let domainMin = 0;
  let domainMax = 0;
  const rangeMin = props.timeline[0].month;
  const rangeMax = Math.max(
    rangeMin + 11,
    props.timeline[props.timeline.length - 1].month,
  );
  // One aligned x per month, with each half of the series blanked out where the other one runs,
  // so that recorded months draw solid and projected ones dashed
  const months = new Array<number>(props.timeline.length);
  const past = new Array<number | null>(props.timeline.length);
  const projected = new Array<number | null>(props.timeline.length);
  let lastPast = -1;
  props.timeline.forEach((d: ChartData, i: number) => {
    domainMin = Math.min(domainMin, d.value);
    domainMax = Math.max(domainMax, d.value);
    months[i] = d.month;
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
  const multiyear = rangeMax - rangeMin > 12;

  const state: State = {
    timeline: props.timeline,
    title: props.title,
    format: props.format,
    range: [rangeMin, rangeMax],
    domain: padRange(domainMin, domainMax),
    multiyear,
  };

  return (
    <UPlotChart<State>
      ariaLabel={`Chart of ${props.title} over time`}
      height={props.height}
      state={state}
      data={[months, past, projected]}
      buildOptions={buildOptions}
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
