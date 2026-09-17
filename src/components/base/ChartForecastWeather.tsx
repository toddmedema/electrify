import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  AXIS_LABEL_SIZE,
  FORECAST_AXIS_LEFT,
  padRange,
  SPLINE,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";
import { TICK_MINUTES } from "../../Constants";
import { TickPresentFutureType, UnitSystemType } from "../../Types";
import {
  axisTicksAreYearly,
  formatMinuteAsMonthAxis,
  formatMinuteAsTooltipHeader,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { chartPalette } from "../../Theme";
import {
  formatTemperature,
  temperatureUnit,
  toDisplayTemperature,
} from "../../helpers/Units";
import { UnitsContext } from "./UnitsContext";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
  /** Shares a cursor with the other charts drawn against the same months */
  syncKey?: string;
}

interface State {
  data: TickPresentFutureType[];
  domain: Props["domain"];
  startingYear: number;
  multiyear: boolean;
  units: UnitSystemType;
}

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  const series: uPlot.Series[] = [
    {},
    {
      stroke: chartPalette().temperature,
      width: 1,
      points: { show: false },
      paths: SPLINE,
    },
  ];
  return {
    width: 0, // set by UPlotChart
    height: 0,
    padding: [5 * scale, 0, 0, 0],
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
          const yearOnly = axisTicksAreYearly(splits, MINUTES_PER_MONTH);
          return splits.map((t) =>
            formatMinuteAsMonthAxis(t, s.startingYear, s.multiyear, yearOnly),
          );
        },
      }),
      yAxis(scale, {
        grid: true,
        label: `Heat (${temperatureUnit(getState().units)})`,
        stroke: chartPalette().temperatureAxis,
        size: FORECAST_AXIS_LEFT - AXIS_LABEL_SIZE,
        values: (_u, splits) => splits.map((t) => String(Math.round(t))),
      }),
    ],
    series,
  };
}

function tooltip(idx: number, state: State): string {
  const d = state.data[idx];
  const header = formatMinuteAsTooltipHeader(d.minute, state.startingYear);
  return `${header}\nTemperature: ${formatTemperature(d.temperatureC, state.units)}`;
}

// This is a pureComponent because its props should change much less frequently than it renders.
// The lines themselves are plotted in the display unit, so the axis a line is labelled with is
// the one it is drawn against - converting only the labels would leave 20°F sitting where -7 is.
export default class ChartForecastWeather extends React.PureComponent<
  Props,
  {}
> {
  // A PureComponent would block a prop change here, but a context change is delivered anyway
  static contextType = UnitsContext;

  public render() {
    const units = this.context as UnitSystemType;
    const { domain, height, timeline, startingYear, multiyear, syncKey } =
      this.props;
    // Downsample the data to 6 per day to make it more vague / forecast-y
    const data = timeline.filter(
      (t: TickPresentFutureType) => t.minute % 240 < TICK_MINUTES,
    );
    // Make sure it gets the first + last entries for a full chart
    data.unshift(timeline[0]);
    data.push(timeline[timeline.length - 1]);

    const minutes = new Array<number>(data.length);
    const temperature = new Array<number>(data.length);
    data.forEach((t: TickPresentFutureType, i: number) => {
      minutes[i] = t.minute;
      temperature[i] = toDisplayTemperature(t.temperatureC, units);
    });

    return (
      <UPlotChart<State>
        id="chartForecastWeather"
        ariaLabel="Chart of predicted temperature"
        height={height}
        state={{ data, domain, startingYear, multiyear, units }}
        data={[minutes, temperature]}
        seriesLabels={["Temperature"]}
        buildOptions={buildOptions}
        // The axis labels are baked into the options, so a change of system rebuilds the plot
        structureKey={units}
        syncKey={syncKey}
        tooltip={tooltip}
      />
    );
  }
}
