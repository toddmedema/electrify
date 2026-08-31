import * as React from "react";
import uPlot from "uplot";
import { HOURS_PER_YEAR_REAL } from "../../Constants";
import { GENERATORS } from "../../data/Facilities";
import {
  formatMinuteAsMonthAxis,
  formatMinuteAsTooltipHeader,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import {
  getAirborneWindCapacityFactor,
  getOffshoreWindCapacityFactor,
  getSolarCapacityFactor,
  getWindCapacityFactor,
} from "../../helpers/Energy";
import { fuelColors } from "../../Theme";
import {
  GameType,
  GeneratorShoppingType,
  TickPresentFutureType,
} from "../../Types";
import ChartLegend from "./ChartLegend";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  FORECAST_AXIS_LEFT,
  FORECAST_AXIS_RIGHT,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";

const WEATHER_RENEWABLES = new Set([
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
  "Solar",
  "Hydro",
]);

export interface Props {
  game: GameType;
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
  showXLabels?: boolean;
  syncKey?: string;
}

export interface RenewableCapacityFactorPoint {
  minute: number;
  factors: Record<string, number>;
}

interface State {
  data: RenewableCapacityFactorPoint[];
  domain: Props["domain"];
  maximum: number;
  startingYear: number;
  multiyear: boolean;
  showXLabels: boolean;
  technologies: GeneratorShoppingType[];
}

export function availableWeatherRenewables(
  game: GameType,
  timeline: TickPresentFutureType[],
): GeneratorShoppingType[] {
  const generators = GENERATORS(
    game,
    1_000_000,
    timeline.map((tick) => tick.windKph),
    timeline.map((tick) => tick.solarIrradianceWM2),
    timeline.flatMap((tick) =>
      tick.windOffshoreKph === undefined ? [] : [tick.windOffshoreKph],
    ),
    timeline.map((tick) => tick.windAirborneKph),
  );
  return generators.filter(
    (generator) =>
      generator.available && WEATHER_RENEWABLES.has(generator.name),
  );
}

function capacityFactor(
  technology: GeneratorShoppingType,
  ticks: TickPresentFutureType[],
): number {
  switch (technology.name) {
    case "Wind":
      return getWindCapacityFactor(ticks.map((tick) => tick.windKph));
    case "Offshore Wind":
      return getOffshoreWindCapacityFactor(
        ticks.flatMap((tick) =>
          tick.windOffshoreKph === undefined ? [] : [tick.windOffshoreKph],
        ),
      );
    case "Airborne Wind":
      return getAirborneWindCapacityFactor(
        ticks.map((tick) => tick.windAirborneKph),
      );
    case "Solar":
      return getSolarCapacityFactor(
        ticks.map((tick) => tick.solarIrradianceWM2),
      );
    case "Hydro": {
      const runoffMm =
        ticks.reduce((total, tick) => total + tick.hydroRunoffMm, 0) /
        ticks.length;
      const monthlyPotentialWh = (technology.hydroWhPerMm || 0) * runoffMm;
      return Math.min(
        1,
        monthlyPotentialWh / (technology.peakW * (HOURS_PER_YEAR_REAL / 12)),
      );
    }
    default:
      return 0;
  }
}

export function monthlyRenewableCapacityFactors(
  timeline: TickPresentFutureType[],
  technologies: GeneratorShoppingType[],
): RenewableCapacityFactorPoint[] {
  const months = new Map<number, TickPresentFutureType[]>();
  timeline.forEach((tick) => {
    const month = Math.floor(tick.minute / MINUTES_PER_MONTH);
    const ticks = months.get(month) || [];
    ticks.push(tick);
    months.set(month, ticks);
  });
  return Array.from(months.values()).map((ticks) => ({
    minute: Math.round((ticks[0].minute + ticks[ticks.length - 1].minute) / 2),
    factors: Object.fromEntries(
      technologies.map((technology) => [
        technology.name,
        capacityFactor(technology, ticks),
      ]),
    ),
  }));
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
      y: { range: () => [0, Math.min(1, getState().maximum * 1.1)] },
    },
    axes: [
      xAxis(scale, {
        splits: () => {
          const [min, max] = getState().domain.x;
          return stepTicks(min, max, MINUTES_PER_MONTH);
        },
        values: (_u, splits) => {
          const state = getState();
          return state.showXLabels
            ? splits.map((minute) =>
                formatMinuteAsMonthAxis(
                  minute,
                  state.startingYear,
                  state.multiyear,
                ),
              )
            : splits.map(() => "");
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
      ...getState().technologies.map((technology, index) => ({
        stroke: fuelColors()[technology.fuel],
        dash: index === 0 ? undefined : [6 * scale, (3 + index) * scale],
        width: 2,
        points: { show: true, size: 4 * scale },
      })),
    ],
  };
}

function tooltip(idx: number, state: State): string {
  const point = state.data[idx];
  const header = formatMinuteAsTooltipHeader(point.minute, state.startingYear);
  return `${header}\n${state.technologies
    .map(
      (technology) =>
        `${technology.name}: ${percent(point.factors[technology.name])}`,
    )
    .join("\n")}`;
}

export default class ChartForecastRenewableCapacityFactor extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const {
      domain,
      game,
      height,
      timeline,
      startingYear,
      multiyear,
      showXLabels = true,
      syncKey,
    } = this.props;
    const technologies = availableWeatherRenewables(game, timeline);
    const data = monthlyRenewableCapacityFactors(timeline, technologies);
    const minutes = data.map((point) => point.minute);
    const factors = technologies.map((technology) =>
      data.map((point) => point.factors[technology.name]),
    );
    const maximum = Math.max(0.25, ...factors.flat());

    return (
      <>
        <ChartLegend
          items={technologies.map((technology, index) => ({
            name: technology.name,
            color: fuelColors()[technology.fuel],
            dash: index === 0 ? undefined : `6 ${3 + index}`,
          }))}
        />
        <UPlotChart<State>
          id="chartForecastRenewableCapacityFactor"
          ariaLabel="Chart of forecasted monthly renewable capacity factors"
          height={height}
          state={{
            data,
            domain,
            maximum,
            startingYear,
            multiyear,
            showXLabels,
            technologies,
          }}
          data={[minutes, ...factors]}
          summaryData={[
            minutes,
            ...factors.map((series) => series.map((factor) => factor * 100)),
          ]}
          seriesLabels={technologies.map(
            (technology) => `${technology.name} capacity factor (%)`,
          )}
          buildOptions={buildOptions}
          structureKey={technologies
            .map((technology) => technology.name)
            .join("|")}
          syncKey={syncKey}
          tooltip={tooltip}
        />
      </>
    );
  }
}
