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
import { TickPresentFutureType } from "../../Types";
import {
  formatMinuteAsMonthAxis,
  formatMinuteAsTooltipHeader,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { getSolarCapacityFactor } from "../../helpers/Energy";
import { fuelColors } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
  /** Shares a cursor with the other charts drawn against the same months */
  syncKey?: string;
}

export interface SolarCapacityFactorPoint {
  minute: number;
  capacityFactor: number;
}

interface State {
  data: SolarCapacityFactorPoint[];
  domain: Props["domain"];
  capacityFactorMax: number;
  startingYear: number;
  multiyear: boolean;
}

/** Average the game's irradiance-based solar output estimate into readable monthly values. */
export function monthlySolarCapacityFactors(
  timeline: TickPresentFutureType[],
): SolarCapacityFactorPoint[] {
  const points: SolarCapacityFactorPoint[] = [];
  let month = -1;
  let firstMinute = 0;
  let lastMinute = 0;
  let irradiances: number[] = [];

  const addPoint = () => {
    if (irradiances.length > 0) {
      points.push({
        minute: Math.round((firstMinute + lastMinute) / 2),
        capacityFactor: getSolarCapacityFactor(irradiances),
      });
    }
  };

  timeline.forEach((tick) => {
    const tickMonth = Math.floor(tick.minute / MINUTES_PER_MONTH);
    if (tickMonth !== month) {
      addPoint();
      month = tickMonth;
      firstMinute = tick.minute;
      irradiances = [];
    }
    lastMinute = tick.minute;
    irradiances.push(tick.solarIrradianceWM2);
  });
  addPoint();

  return points;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  return {
    width: 0,
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
        range: () => [0, Math.min(1, getState().capacityFactorMax * 1.1)],
      },
    },
    axes: [
      xAxis(scale, {
        splits: () => {
          const [min, max] = getState().domain.x;
          return stepTicks(min, max, MINUTES_PER_MONTH);
        },
        values: (_u, splits) => {
          const state = getState();
          return splits.map((minute) =>
            formatMinuteAsMonthAxis(
              minute,
              state.startingYear,
              state.multiyear,
            ),
          );
        },
      }),
      yAxis(scale, {
        grid: true,
        size: FORECAST_AXIS_LEFT,
        values: (_u, splits) => splits.map(percent),
      }),
    ],
    series: [
      {},
      {
        stroke: fuelColors().Sun,
        width: 2,
        points: { show: true, size: 4 * scale },
      },
    ],
  };
}

function tooltip(idx: number, state: State): string {
  const point = state.data[idx];
  const header = formatMinuteAsTooltipHeader(point.minute, state.startingYear);
  return `${header}\nSolar capacity factor: ${percent(point.capacityFactor)}`;
}

export default class ChartForecastSolarCapacityFactor extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear, syncKey } =
      this.props;
    const data = monthlySolarCapacityFactors(timeline);
    const minutes = data.map((point) => point.minute);
    const capacityFactors = data.map((point) => point.capacityFactor);
    const percentages = capacityFactors.map((factor) => factor * 100);
    const capacityFactorMax = Math.max(0.25, ...capacityFactors);

    return (
      <UPlotChart<State>
        id="chartForecastSolarCapacityFactor"
        ariaLabel="Chart of forecasted monthly solar capacity factor"
        height={height}
        state={{
          data,
          domain,
          capacityFactorMax,
          startingYear,
          multiyear,
        }}
        data={[minutes, capacityFactors]}
        summaryData={[minutes, percentages]}
        seriesLabels={["Solar capacity factor (%)"]}
        buildOptions={buildOptions}
        syncKey={syncKey}
        tooltip={tooltip}
      />
    );
  }
}
