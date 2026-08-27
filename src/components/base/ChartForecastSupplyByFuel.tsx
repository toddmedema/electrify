import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  FORECAST_AXIS_LEFT,
  FORECAST_AXIS_RIGHT,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";
import {
  formatMinuteAsMonthAxis,
  formatMinuteAsTooltipHeader,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { FuelNameType, TickPresentFutureType } from "../../Types";
import { chartPalette, fuelColors, withAlpha } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
  // Bottom-to-top order of the stack, ie the order these fuels are dispatched in. Already
  // narrowed to the fuels this forecast actually burns -- see forecastFuels, which the pane
  // calls too so its legend and this stack can't disagree about what is in the picture
  fuels: FuelNameType[];
  /** False where a chart below this one carries the month names for the whole stack */
  showXLabels?: boolean;
  /** Shares a cursor with the other charts drawn against the same months */
  syncKey?: string;
  /**
   * The one fuel to draw at full strength, with every other band faded back. Set from the
   * facility the player has selected in the fleet list, so that clicking a coal plant says
   * which part of the stack is theirs.
   */
  highlightFuel?: FuelNameType;
}

/**
 * The fuels a forecast burns, bottom to top of the stack.
 *
 * Anything generating in the forecast window belongs in it, even if it was built partway through
 * and so isn't in the fleet the dispatch order was derived from.
 */
export function forecastFuels(
  dispatchOrder: FuelNameType[],
  timeline: TickPresentFutureType[],
): FuelNameType[] {
  const inForecast = new Set<FuelNameType>();
  timeline.forEach((t) => {
    Object.keys(t.supplyByFuel).forEach((f) =>
      inForecast.add(f as FuelNameType),
    );
  });
  const fuels = dispatchOrder.filter((f) => inForecast.has(f));
  inForecast.forEach((f) => {
    if (fuels.indexOf(f) === -1) {
      fuels.push(f);
    }
  });
  return fuels;
}

interface State {
  fuels: FuelNameType[];
  // Each fuel's own output at each x, ie before it is stacked, for the tooltip to report
  byFuel: number[][];
  demand: number[];
  minutes: number[];
  domain: Props["domain"];
  maxY: number;
  startingYear: number;
  multiyear: boolean;
}

// Faded far enough that the highlighted band is unmistakably the subject, but not so far
// that the rest of the stack stops being readable as context
const MUTED_BAND_ALPHA = 0.15;

function buildOptions(
  fuels: FuelNameType[],
  showXLabels: boolean,
  highlightFuel?: FuelNameType,
) {
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
      y: { range: () => [0, getState().maxY] as [number, number] },
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
      ...fuels.map((f) => ({
        fill:
          highlightFuel && f !== highlightFuel
            ? withAlpha(fuelColors()[f], MUTED_BAND_ALPHA)
            : fuelColors()[f],
        // A hairline of background between bands keeps them apart even where two
        // fuel colors are close, since seven series can't all be far apart
        stroke: chartPalette().background,
        width: 0.5,
        points: { show: false },
      })),
      {
        // Drawn over the stack so the gap between the two reads as the shortfall
        stroke: chartPalette().demand,
        width: 2,
        dash: [4, 2],
        points: { show: false },
      },
    ],
    // Each fuel's fill runs down to the band below it rather than to the axis, which is what
    // makes the series read as a stack; the bottom fuel keeps its own fill to zero
    bands: fuels.slice(1).map((_f, i) => ({ series: [i + 2, i + 1] })),
  });
}

function tooltip(idx: number, state: State): string {
  const header = formatMinuteAsTooltipHeader(
    state.minutes[idx],
    state.startingYear,
  );
  return [
    header,
    ...state.fuels
      .map(
        (f: FuelNameType, i: number) =>
          f + ": " + formatWatts(state.byFuel[i][idx]),
      )
      .reverse(),
    "Demand: " + formatWatts(state.demand[idx]),
  ].join("\n");
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastSupplyByFuel extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const {
      domain,
      fuels,
      height,
      timeline,
      startingYear,
      multiyear,
      showXLabels,
      syncKey,
      highlightFuel,
    } = this.props;

    // Every band needs a value at every x or the stack tears, so backfill the whole series.
    // The sampled forecast repeats its first minute, and a stack lines its bands up by x, so a
    // duplicate x knocks every band after it out of alignment - drop repeats as we go.
    const minutes: number[] = [];
    const demand: number[] = [];
    const byFuel: number[][] = fuels.map(() => []);
    timeline.forEach((t) => {
      if (minutes.length && minutes[minutes.length - 1] === t.minute) {
        return;
      }
      minutes.push(t.minute);
      demand.push(t.demandW);
      fuels.forEach((f, i) => byFuel[i].push(t.supplyByFuel[f] || 0));
    });

    // uPlot stacks by drawing the running totals and filling between neighbours, so the series
    // it is handed are cumulative even though the tooltip reports each fuel on its own
    const stacked: number[][] = [];
    const running = new Array<number>(minutes.length).fill(0);
    byFuel.forEach((series) => {
      for (let i = 0; i < minutes.length; i++) {
        running[i] += series[i];
      }
      stacked.push([...running]);
    });

    // The stack tops out at total generation, which can sit either side of demand - leave room for both
    let maxY = 0;
    for (let i = 0; i < minutes.length; i++) {
      maxY = Math.max(maxY, running[i], demand[i]);
    }

    const state: State = {
      fuels,
      byFuel,
      demand,
      minutes,
      domain,
      maxY,
      startingYear,
      multiyear,
    };

    return (
      <div id="chartForecastSupplyByFuel">
        <UPlotChart<State>
          ariaLabel="Chart of forecasted electricity supply by fuel type"
          height={height}
          state={state}
          data={[minutes, ...stacked, demand]}
          seriesLabels={[
            ...fuels.map((fuel) => `${fuel} cumulative supply`),
            "Demand",
          ]}
          buildOptions={buildOptions(
            fuels,
            showXLabels !== false,
            highlightFuel,
          )}
          structureKey={`${fuels.join(",")}|${showXLabels !== false}|${highlightFuel || ""}`}
          syncKey={syncKey}
          tooltip={tooltip}
        />
      </div>
    );
  }
}
