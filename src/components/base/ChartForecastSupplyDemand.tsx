import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  bandsPlugin,
  FORECAST_AXIS_LEFT,
  FORECAST_AXIS_RIGHT,
  padRange,
  spansFromEdges,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";
import { TickPresentFutureType } from "../../Types";
import {
  formatMinuteAsMonthAxis,
  formatMinuteAsTooltipHeader,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { chartPalette } from "../../Theme";

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  blackouts: BlackoutEdges[];
  domain: { x: [number, number]; y: [number, number] };
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
  blackoutSpans: Array<[number, number]>;
  startingYear: number;
  multiyear: boolean;
}

function buildOptions(showXLabels: boolean) {
  return ({ getState, scale }: BuildContext<State>): uPlot.Options => ({
    width: 0, // set by UPlotChart
    height: 0,
    // Right gutter reserved rather than used, so this plot ends where the weather chart's
    // second axis makes that one end -- see FORECAST_AXIS_RIGHT
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
        range: () => {
          const [min, max] = getState().domain.y;
          return padRange(min, max);
        },
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
        values: (_u, splits) => splits.map((t) => formatWattsAxis(t, splits)),
      }),
    ],
    series: [
      {},
      { stroke: chartPalette().supply, width: 1, points: { show: false } },
      { stroke: chartPalette().demand, width: 2, points: { show: false } },
    ],
    plugins: [
      bandsPlugin(() => getState().blackoutSpans, chartPalette().blackout, 0.3),
    ],
  });
}

function tooltip(idx: number, state: State): string {
  const d = state.timeline[idx];
  const header = formatMinuteAsTooltipHeader(d.minute, state.startingYear);
  return `${header}\nSupply: ${formatWatts(d.supplyW)}\nDemand: ${formatWatts(d.demandW)}`;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class chartForecastSupplyDemand extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const {
      domain,
      height,
      timeline,
      blackouts,
      startingYear,
      multiyear,
      showXLabels,
      syncKey,
    } = this.props;

    const minutes = new Array<number>(timeline.length);
    const supply = new Array<number>(timeline.length);
    const demand = new Array<number>(timeline.length);
    timeline.forEach((t: TickPresentFutureType, i: number) => {
      minutes[i] = t.minute;
      supply[i] = t.supplyW;
      demand[i] = t.demandW;
    });

    const state: State = {
      timeline,
      domain,
      blackoutSpans: spansFromEdges(blackouts),
      startingYear,
      multiyear,
    };

    return (
      <UPlotChart<State>
        id="chartForecastSupplyDemand"
        ariaLabel="Chart of forecasted electricity supply and demand"
        height={height}
        state={state}
        data={[minutes, supply, demand]}
        seriesLabels={["Supply", "Demand"]}
        buildOptions={buildOptions(showXLabels !== false)}
        structureKey={String(showXLabels !== false)}
        syncKey={syncKey}
        tooltip={tooltip}
      />
    );
  }
}
