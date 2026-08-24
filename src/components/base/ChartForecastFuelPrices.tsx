import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  dashArray,
  padRange,
  SPLINE,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";
import {
  formatMinuteAsMonthAxis,
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
}

type PricedFuelType = "Coal" | "Natural Gas" | "Oil" | "Uranium";
const PRICED_FUELS: PricedFuelType[] = [
  "Coal",
  "Natural Gas",
  "Oil",
  "Uranium",
];

interface State {
  prices: number[][];
  domain: Props["domain"];
  startingYear: number;
  multiyear: boolean;
}

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
        label: "Per MMBTU",
        values: (_u, splits) => splits.map((t) => formatMoneyConcise(t)),
      }),
    ],
    series: [
      {},
      ...PRICED_FUELS.map((f) => ({
        stroke: fuelColors[f],
        width: 1.5,
        // Four overlapping lines are more than color alone can separate, so each
        // fuel also gets its own dash pattern
        dash: dashArray(fuelDashArrays[f]),
        points: { show: false },
        paths: SPLINE,
      })),
    ],
  };
}

function tooltip(idx: number, state: State): string {
  return PRICED_FUELS.map(
    (f, i) => `${f}: ${formatMoneyStable(state.prices[i][idx])}`,
  ).join("\n");
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastFuelPrices extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear } = this.props;

    const minutes = new Array<number>(timeline.length);
    // Every tick carries all four prices; the fallback is only here because the fuel prices
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
          height={height}
          state={{ prices, domain, startingYear, multiyear }}
          data={[minutes, ...prices]}
          buildOptions={buildOptions}
          tooltip={tooltip}
        />
        {/* Below the plot rather than floating in it, where it used to clip the data */}
        <div className="chartLegend">
          {PRICED_FUELS.map((f) => (
            <span key={f} className="chartLegendItem">
              <svg
                className="chartLegendSwatch chartLegendSwatch-line"
                viewBox="0 0 20 4"
                aria-hidden="true"
              >
                <line
                  x1="0"
                  y1="2"
                  x2="20"
                  y2="2"
                  stroke={fuelColors[f]}
                  strokeWidth="3"
                  strokeDasharray={fuelDashArrays[f]}
                />
              </svg>
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  }
}
