import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  AXIS_LABEL_SIZE,
  FORECAST_AXIS_LEFT,
  FORECAST_AXIS_RIGHT,
  padRange,
  SPLINE,
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
import { formatWattHours, formatWattsInUnit } from "../../helpers/Format";
import { chartPalette } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
  showXLabels?: boolean;
  syncKey?: string;
}

interface State {
  timeline: TickPresentFutureType[];
  domain: Props["domain"];
  startingYear: number;
  multiyear: boolean;
}

const RESERVOIR_SCALE = "reservoir";
const GIGAWATT = { suffix: "G", divisor: 1e9 };

export function formatReservoirAxisValue(value: number): string {
  return formatWattsInUnit(value, GIGAWATT).replace(/GW$/, "");
}

function buildOptions(showXLabels: boolean) {
  return ({ getState, scale }: BuildContext<State>): uPlot.Options => ({
    width: 0,
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
      y: { range: (_u, min, max) => padRange(Math.min(0, min), max) },
      [RESERVOIR_SCALE]: {
        range: (_u, min, max) => padRange(Math.min(0, min), max),
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
        grid: true,
        label: "Water (mm)",
        size: FORECAST_AXIS_LEFT - AXIS_LABEL_SIZE,
        values: (_u, splits) => splits.map((v) => String(Math.round(v))),
      }),
      yAxis(scale, {
        scale: RESERVOIR_SCALE,
        side: 1,
        label: "Reservoir (GWh)",
        stroke: chartPalette().reservoir,
        size: FORECAST_AXIS_RIGHT - AXIS_LABEL_SIZE,
        values: (_u, splits) => splits.map((v) => formatReservoirAxisValue(v)),
      }),
    ],
    series: [
      {},
      {
        stroke: chartPalette().precipitation,
        width: 1,
        points: { show: false },
      },
      {
        stroke: chartPalette().snowpack,
        width: 1,
        points: { show: false },
        paths: SPLINE,
      },
      {
        scale: RESERVOIR_SCALE,
        stroke: chartPalette().reservoir,
        width: 2,
        points: { show: false },
        paths: SPLINE,
      },
    ],
  });
}

function tooltip(idx: number, state: State): string {
  const d = state.timeline[idx];
  return `${formatMinuteAsTooltipHeader(d.minute, state.startingYear)}\nPrecipitation: ${d.precipitationMm.toFixed(0)} mm\nSnowpack: ${d.snowpackMm.toFixed(0)} mm SWE\nReservoir: ${formatWattHours(d.hydroReservoirWh)} of ${formatWattHours(d.hydroReservoirCapacityWh)}`;
}

export default class ChartForecastWater extends React.PureComponent<Props, {}> {
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
    const minutes: number[] = [];
    const precipitation: number[] = [];
    const snowpack: number[] = [];
    const reservoir: number[] = [];
    timeline.forEach((d) => {
      minutes.push(d.minute);
      precipitation.push(d.precipitationMm);
      snowpack.push(d.snowpackMm);
      reservoir.push(d.hydroReservoirWh);
    });
    return (
      <UPlotChart<State>
        id="chartForecastWater"
        ariaLabel="Chart of watershed precipitation, snowpack, and hydro reservoir level"
        height={height}
        state={{ timeline, domain, startingYear, multiyear }}
        data={[minutes, precipitation, snowpack, reservoir]}
        seriesLabels={["Precipitation", "Snowpack", "Reservoir"]}
        buildOptions={buildOptions(showXLabels !== false)}
        structureKey={String(showXLabels !== false)}
        syncKey={syncKey}
        tooltip={tooltip}
      />
    );
  }
}
