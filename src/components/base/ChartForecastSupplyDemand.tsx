import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  bandsPlugin,
  padRange,
  spansFromEdges,
  splitPastProjected,
  forecastMonthAxis,
  yAxis,
} from "./UPlotHelpers";
import { TickPresentFutureType } from "../../Types";
import { formatMinuteAsTooltipHeader } from "../../helpers/DateTime";
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
  /**
   * The minute the record ends and the forecast begins. Everything at or after it draws dashed.
   * Omitted and every point draws solid, as before.
   */
  currentMinute?: number;
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
    // Keep only enough trailing room for a centred x-axis label. This chart has no right axis,
    // so reserving the weather chart's gutter made its plot visibly narrower than its peers.
    padding: [10 * scale, 24 * scale, 0, 0],
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
      forecastMonthAxis(scale, getState, showXLabels),
      yAxis(scale, {
        values: (_u, splits) => splits.map((t) => formatWattsAxis(t, splits)),
      }),
    ],
    series: [
      {},
      {
        stroke: chartPalette().supply,
        width: 1,
        points: { show: false },
        spanGaps: false,
      },
      {
        stroke: chartPalette().supply,
        width: 1,
        dash: [4, 4],
        points: { show: false },
        spanGaps: false,
      },
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
    plugins: [
      bandsPlugin(() => getState().blackoutSpans, chartPalette().blackout, 0.3),
    ],
  });
}

function tooltip(idx: number, state: State): string {
  const d = state.timeline[idx];
  const header = formatMinuteAsTooltipHeader(d.minute, state.startingYear);
  const reserve =
    d.reserveW === undefined
      ? ""
      : `\nReserve margin: ${formatWatts(d.reserveW)}`;
  return `${header}\nSupply: ${formatWatts(d.supplyW)}\nDemand: ${formatWatts(d.demandW)}${reserve}`;
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
      currentMinute,
      showXLabels,
      syncKey,
    } = this.props;

    const minutes = new Array<number>(timeline.length);
    const supplyValues = new Array<number | null>(timeline.length);
    const demandValues = new Array<number | null>(timeline.length);
    const isProjected = timeline.map(
      (t: TickPresentFutureType) =>
        currentMinute !== undefined && t.minute >= currentMinute,
    );
    timeline.forEach((t: TickPresentFutureType, i: number) => {
      minutes[i] = t.minute;
      supplyValues[i] = t.supplyW;
      demandValues[i] = t.demandW;
    });
    // The recorded months are drawn solid and the simulated hours dashed, the forecast starting
    // at the last recorded point so the two halves meet. On this month-scale axis that bridge is
    // the whole gap between them, so no month-scale chart extends the solid line into the future.
    const supply = splitPastProjected(supplyValues, isProjected);
    const demand = splitPastProjected(demandValues, isProjected);

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
        ariaLabel="Chart of estimated electricity supply and demand"
        formatSummaryValue={formatWatts}
        height={height}
        state={state}
        data={[
          minutes,
          supply.past,
          supply.projected,
          demand.past,
          demand.projected,
        ]}
        seriesLabels={[
          "Past supply",
          "Forecast supply",
          "Past demand",
          "Forecast demand",
        ]}
        buildOptions={buildOptions(showXLabels !== false)}
        structureKey={String(showXLabels !== false)}
        syncKey={syncKey}
        tooltip={tooltip}
      />
    );
  }
}
