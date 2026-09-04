import * as React from "react";
import uPlot from "uplot";
import { DEMAND_TYPES } from "../../data/DemandProfiles";
import {
  DemandByTypeType,
  DemandTypeNameType,
  TickPresentFutureType,
} from "../../Types";
import {
  axisTicksAreYearly,
  formatMinuteAsMonthAxis,
  formatMinuteAsTooltipHeader,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { chartPalette, demandTypeColors } from "../../Theme";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  FORECAST_AXIS_LEFT,
  FORECAST_AXIS_RIGHT,
  stepTicks,
  xAxis,
  yAxis,
} from "./UPlotHelpers";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  /** Shared with the DOM legend so both surfaces always present the same ranking. */
  displayTypes?: readonly DemandTypeNameType[];
  /** Player-facing authored labels while the underlying demand category remains stable. */
  typeLabels?: Partial<Record<DemandTypeNameType, string>>;
  startingYear: number;
  multiyear: boolean;
  showXLabels?: boolean;
  syncKey?: string;
}

interface State {
  byType: DemandByTypeType[];
  displayTypes: readonly DemandTypeNameType[];
  minutes: number[];
  domain: Props["domain"];
  maxY: number;
  startingYear: number;
  multiyear: boolean;
  typeLabels: Partial<Record<DemandTypeNameType, string>>;
}

function buildOptions(showXLabels: boolean) {
  return ({ getState, scale }: BuildContext<State>): uPlot.Options => ({
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
          const state = getState();
          const yearOnly = axisTicksAreYearly(splits, MINUTES_PER_MONTH);
          return splits.map((minute) =>
            formatMinuteAsMonthAxis(
              minute,
              state.startingYear,
              state.multiyear,
              yearOnly,
            ),
          );
        },
      }),
      yAxis(scale, {
        size: FORECAST_AXIS_LEFT,
        values: (_u, splits) =>
          splits.map((value) => formatWattsAxis(value, splits)),
      }),
    ],
    series: [
      {},
      ...DEMAND_TYPES.map((type) => ({
        fill: demandTypeColors()[type],
        stroke: chartPalette().background,
        width: 0.5,
        points: { show: false },
      })),
    ],
    bands: DEMAND_TYPES.slice(1).map((_type, index) => ({
      series: [index + 2, index + 1],
    })),
  });
}

const EMPTY_BREAKDOWN: DemandByTypeType = {
  Residential: 0,
  Commercial: 0,
  Industrial: 0,
  Transportation: 0,
  "Data centers": 0,
};

/**
 * A stable ranking for the whole visible range. Reordering under the pointer would make the
 * legend and stacked chart hard to follow, so the first plotted instant owns the ordering.
 */
export function demandTypesBySizeAtStart(
  timeline: TickPresentFutureType[],
  startMinute: number,
): DemandTypeNameType[] {
  const firstVisible =
    timeline.find((tick) => tick.minute >= startMinute) ||
    timeline[timeline.length - 1];
  const breakdown = firstVisible?.demandByType || EMPTY_BREAKDOWN;
  return [...DEMAND_TYPES].sort(
    (a, b) =>
      breakdown[b] - breakdown[a] ||
      DEMAND_TYPES.indexOf(a) - DEMAND_TYPES.indexOf(b),
  );
}

export function formatDemandTypeTooltip(
  minute: number,
  breakdown: DemandByTypeType,
  startingYear: number,
  displayTypes: readonly DemandTypeNameType[],
  typeLabels: Partial<Record<DemandTypeNameType, string>> = {},
): string {
  return [
    formatMinuteAsTooltipHeader(minute, startingYear),
    ...displayTypes.map(
      (type) => `${typeLabels[type] || type}: ${formatWatts(breakdown[type])}`,
    ),
  ].join("\n");
}

function tooltip(idx: number, state: State): string {
  return formatDemandTypeTooltip(
    state.minutes[idx],
    state.byType[idx],
    state.startingYear,
    state.displayTypes,
    state.typeLabels,
  );
}

export default class ChartForecastDemandByType extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const {
      domain,
      displayTypes,
      height,
      timeline,
      startingYear,
      multiyear,
      showXLabels,
      syncKey,
      typeLabels = {},
    } = this.props;
    const minutes: number[] = [];
    const byType: DemandByTypeType[] = [];
    timeline.forEach((tick) => {
      if (minutes.length && minutes[minutes.length - 1] === tick.minute) {
        return;
      }
      minutes.push(tick.minute);
      byType.push(tick.demandByType);
    });

    const stacked: number[][] = [];
    const unstacked: number[][] = DEMAND_TYPES.map((type) =>
      byType.map((breakdown) => breakdown[type]),
    );
    const running = new Array<number>(minutes.length).fill(0);
    DEMAND_TYPES.forEach((_type: DemandTypeNameType, typeIndex) => {
      for (let i = 0; i < minutes.length; i++) {
        running[i] += unstacked[typeIndex][i];
      }
      stacked.push([...running]);
    });
    const maxY = Math.max(...running, 0);
    const state: State = {
      byType,
      displayTypes:
        displayTypes || demandTypesBySizeAtStart(timeline, domain.x[0]),
      minutes,
      domain,
      maxY,
      startingYear,
      multiyear,
      typeLabels,
    };

    return (
      <div id="chartForecastDemandByType">
        <UPlotChart<State>
          ariaLabel="Chart of predicted electricity demand by customer or use type"
          formatSummaryValue={formatWatts}
          height={height}
          state={state}
          data={[minutes, ...stacked]}
          summaryData={[minutes, ...unstacked]}
          seriesLabels={DEMAND_TYPES.map((type) => typeLabels[type] || type)}
          buildOptions={buildOptions(showXLabels !== false)}
          structureKey={String(showXLabels !== false)}
          syncKey={syncKey}
          tooltip={tooltip}
        />
      </div>
    );
  }
}
