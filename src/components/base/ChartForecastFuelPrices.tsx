import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  AXIS_LABEL_SIZE,
  dashArray,
  FORECAST_AXIS_LEFT,
  FORECAST_AXIS_RIGHT,
  padRange,
  SPLINE,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";
import {
  formatMinuteAsMonthAxis,
  formatMinuteAsTooltipHeader,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { formatMoneyConcise, formatMoneyStable } from "../../helpers/Format";
import { TickPresentFutureType } from "../../Types";
import { fuelColors, fuelDashArrays } from "../../Theme";

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

export type PricedFuelType =
  "Biomass" | "Coal" | "Natural Gas" | "Oil" | "Uranium";
export const PRICED_FUELS: PricedFuelType[] = [
  "Biomass",
  "Coal",
  "Natural Gas",
  "Oil",
  "Uranium",
];

interface State {
  prices: number[][];
  minutes: number[];
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
      y: { range: (_u, min, max) => padRange(min, max) },
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
        grid: true,
        label: "Per MMBTU",
        // The label sits outside the axis, so it comes out of the shared gutter too
        size: FORECAST_AXIS_LEFT - AXIS_LABEL_SIZE,
        values: (_u, splits) => splits.map((t) => formatMoneyConcise(t)),
      }),
    ],
    series: [
      {},
      ...PRICED_FUELS.map((f) => ({
        stroke: fuelColors()[f],
        width: 1.5,
        // Five overlapping lines are more than color alone can separate, so each
        // fuel also gets its own dash pattern
        dash: dashArray(fuelDashArrays[f]),
        points: { show: false },
        paths: SPLINE,
      })),
    ],
  });
}

function tooltip(idx: number, state: State): string {
  const header = formatMinuteAsTooltipHeader(
    state.minutes[idx],
    state.startingYear,
  );
  return [
    header,
    ...PRICED_FUELS.map(
      (f, i) => `${f}: ${formatMoneyStable(state.prices[i][idx])}`,
    ),
  ].join("\n");
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastFuelPrices extends React.PureComponent<
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
    // Every tick carries all five prices; the fallback is only here because the fuel prices
    // are optional on the tick type
    const prices = PRICED_FUELS.map(() => new Array<number>(timeline.length));
    timeline.forEach((t: TickPresentFutureType, i: number) => {
      minutes[i] = t.minute;
      PRICED_FUELS.forEach((f, fi) => {
        prices[fi][i] = t[f] ?? 0;
      });
    });

    return (
      <div id="chartForecastFuelPrices">
        <UPlotChart<State>
          ariaLabel="Chart of forecasted fuel prices"
          formatSummaryValue={formatMoneyStable}
          height={height}
          state={{ prices, minutes, domain, startingYear, multiyear }}
          data={[minutes, ...prices]}
          seriesLabels={PRICED_FUELS}
          buildOptions={buildOptions(showXLabels !== false)}
          structureKey={String(showXLabels !== false)}
          syncKey={syncKey}
          tooltip={tooltip}
        />
      </div>
    );
  }
}
