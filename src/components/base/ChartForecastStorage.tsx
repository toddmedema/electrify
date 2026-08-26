import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  FORECAST_AXIS_LEFT,
  FORECAST_AXIS_RIGHT,
  padRange,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";
import { TickPresentFutureType } from "../../Types";
import {
  formatMinuteAsMonthAxis,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { formatWattHours, formatWattHoursAxis } from "../../helpers/Format";
import { supplyColor } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
  /** False where a chart below this one carries the month names for the whole stack */
  showXLabels?: boolean;
  /** Shares a cursor with the other charts drawn against the same months */
  syncKey?: string;
}

interface State {
  timeline: TickPresentFutureType[];
  domain: Props["domain"];
  startingYear: number;
  multiyear: boolean;
}

function buildOptions(showXLabels: boolean) {
  return ({ getState, scale }: BuildContext<State>): uPlot.Options => ({
    width: 0, // set by UPlotChart
    height: 0,
    padding: [5 * scale, FORECAST_AXIS_RIGHT * scale, 0, 0],
    cursor: {
      x: true,
      y: false,
      points: { show: false },
      drag: { x: false, y: false, setScale: false },
    },
    legend: { show: false },
    scales: {
      x: { time: false, range: () => getState().domain.x },
      y: {
        range: (_u, min, max) => padRange(min, max),
      },
    },
    axes: [
      xAxis(scale, {
        showLabels: showXLabels,
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
        size: FORECAST_AXIS_LEFT,
        values: (_u, splits) =>
          splits.map((t) => formatWattHoursAxis(t, splits)),
      }),
    ],
    series: [{}, { stroke: supplyColor, width: 1, points: { show: false } }],
  });
}

function tooltip(idx: number, state: State): string {
  return formatWattHours(state.timeline[idx].storedWh);
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class chartForecastStorage extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const {
      domain,
      height,
      timeline,
      startingYear,
      multiyear,
      showXLabels,
      syncKey,
    } = this.props;

    const minutes = new Array<number>(timeline.length);
    const stored = new Array<number>(timeline.length);
    timeline.forEach((t: TickPresentFutureType, i: number) => {
      minutes[i] = t.minute;
      stored[i] = t.storedWh;
    });

    return (
      <UPlotChart<State>
        id="chartForecastStorage"
        ariaLabel="Chart of forecasted stored power"
        height={height}
        state={{ timeline, domain, startingYear, multiyear }}
        data={[minutes, stored]}
        buildOptions={buildOptions(showXLabels !== false)}
        structureKey={String(showXLabels !== false)}
        syncKey={syncKey}
        tooltip={tooltip}
      />
    );
  }
}
