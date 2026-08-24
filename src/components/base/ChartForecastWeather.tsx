import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  legendPlugin,
  padRange,
  SPLINE,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";
import { TICK_MINUTES } from "../../Constants";
import { TickPresentFutureType } from "../../Types";
import {
  formatMinuteAsMonthAxis,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { temperatureColor, windColor } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
}

interface State {
  data: TickPresentFutureType[];
  domain: Props["domain"];
  startingYear: number;
  multiyear: boolean;
}

// Temperature and wind share one axis, as they did on Victory: the numbers are close enough in
// range that a second scale would only add a second set of labels to read
const LEGEND = [
  { name: "Heat (°C)", fill: temperatureColor },
  { name: "Wind (km/h)", fill: windColor },
];

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  return {
    width: 0, // set by UPlotChart
    height: 0,
    padding: [5 * scale, 5 * scale, 0, 0],
    cursor: {
      x: true,
      y: false,
      points: { show: false },
      drag: { x: false, y: false, setScale: false },
    },
    legend: { show: false },
    scales: {
      x: { time: false, range: () => getState().domain.x },
      y: { range: (_u, min, max) => padRange(min, max) },
    },
    axes: [
      xAxis(scale, {
        splits: () => {
          const [min, max] = getState().domain.x;
          return stepTicks(min, max, MINUTES_PER_MONTH);
        },
        values: (_u, splits) => {
          const s = getState();
          return splits.map((t) =>
            formatMinuteAsMonthAxis(t, s.startingYear, s.multiyear),
          );
        },
      }),
      yAxis(scale, {
        grid: true,
        values: (_u, splits) => splits.map((t) => String(Math.round(t))),
      }),
    ],
    series: [
      {},
      {
        stroke: temperatureColor,
        width: 1,
        points: { show: false },
        paths: SPLINE,
      },
      { stroke: windColor, width: 1, points: { show: false }, paths: SPLINE },
    ],
    plugins: [legendPlugin(() => LEGEND, 270, 20)],
  };
}

function tooltip(idx: number, state: State): string {
  const d = state.data[idx];
  return `Temperature: ${Math.round(d.temperatureC)}°C\nWind: ${Math.round(d.windKph)} km/h`;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastWeather extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear } = this.props;
    // Downsample the data to 6 per day to make it more vague / forecast-y
    const data = timeline.filter(
      (t: TickPresentFutureType) => t.minute % 240 < TICK_MINUTES,
    );
    // Make sure it gets the first + last entries for a full chart
    data.unshift(timeline[0]);
    data.push(timeline[timeline.length - 1]);

    const minutes = new Array<number>(data.length);
    const temperature = new Array<number>(data.length);
    const wind = new Array<number>(data.length);
    data.forEach((t: TickPresentFutureType, i: number) => {
      minutes[i] = t.minute;
      temperature[i] = t.temperatureC;
      wind[i] = t.windKph;
    });

    return (
      <UPlotChart<State>
        id="chartForecastWeather"
        ariaLabel="Chart of forecasted temperature and wind"
        height={height}
        state={{ data, domain, startingYear, multiyear }}
        data={[minutes, temperature, wind]}
        buildOptions={buildOptions}
        tooltip={tooltip}
      />
    );
  }
}
