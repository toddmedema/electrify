import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import ChartLegend from "./ChartLegend";
import {
  anchoredForecastPaths,
  bandsPlugin,
  chartFont,
  padRange,
  spansFromEdges,
  splitPastProjected,
  tickLabelFill,
  verticalLinePlugin,
  xAxis,
  baselinePlugin,
  yAxis,
} from "./UPlotHelpers";
import {
  formatMinuteOfDayChartAxis,
  getDateFromMinute,
  getHourTicks,
  getSunriseSunset,
} from "../../helpers/DateTime";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { getIntersectionX } from "../../helpers/Math";
import {
  chartPalette,
  fuelColors,
  getThemeVersion,
  subscribeThemeMode,
  withAlpha,
} from "../../Theme";
import { FuelNameType, LocationType, TickPresentFutureType } from "../../Types";

type ChartData = Pick<
  TickPresentFutureType,
  | "minute"
  | "supplyW"
  | "demandW"
  | "supplyByFuel"
  | "storageChargeW"
  | "storageDischargeW"
  | "importedW"
  | "exportedW"
>;

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface Props {
  currentMinute: number;
  location: LocationType;
  height?: number;
  legend?: boolean;
  timeline: ChartData[];
  startingYear: number;
  /** Bottom-to-top dispatch order, shared with the facility list. */
  fuelOrder?: FuelNameType[];
}

// Everything the plot's callbacks read. Rebuilt every render and handed to UPlotChart, which
// keeps the newest one reachable from options that were built once.
interface State {
  timeline: ChartData[];
  domain: [number, number];
  range: [number, number];
  hourTicks: number[];
  sunTicks: number[];
  blackoutSpans: Array<[number, number]>;
  currentMinute: number | null;
  sources: SupplySource[];
  bySource: number[][];
  supply: number[];
  totalDemand: number[];
  startingYear: number;
}

// Words rather than emoji: platform emoji are full-colour art that clash with the flat icon
// set and change shape from one OS to the next
const SUN_LABELS = ["Sunrise", "Noon", "Sunset"];

// Fuel boundaries stay lighter than the demand the player has to meet. Solid records and
// dashed forecasts meet at now; fills stay subtle so blackout shading remains visible.
const SUPPLY_WIDTH = 1.5;
const DEMAND_WIDTH = 3;
const SUPPLY_FORECAST_DASH = [2, 3];
const DEMAND_FORECAST_DASH = [8, 4];
type SupplySource = FuelNameType | "Storage discharge" | "Imports";

function sourceColor(source: SupplySource): string {
  if (source === "Storage discharge") return chartPalette().storage;
  if (source === "Imports") return chartPalette().intertie;
  return fuelColors()[source];
}

export function productionStack(
  timeline: ChartData[],
  fuelOrder: FuelNameType[],
) {
  const present = new Set<FuelNameType>();
  timeline.forEach((tick) => {
    (Object.keys(tick.supplyByFuel) as FuelNameType[]).forEach((fuel) => {
      if ((tick.supplyByFuel[fuel] || 0) > 0) present.add(fuel);
    });
  });
  const fuels = [...new Set([...fuelOrder, ...present])].filter((fuel) =>
    present.has(fuel),
  );
  const byFuel = fuels.map((fuel) =>
    timeline.map((tick) => tick.supplyByFuel[fuel] || 0),
  );
  const production = timeline.map(() => 0);
  const stacked = byFuel.map((values) => {
    values.forEach((value, i) => (production[i] += value));
    return [...production];
  });
  return { fuels, byFuel, stacked, production };
}

export function supplyDemandStack(
  timeline: ChartData[],
  fuelOrder: FuelNameType[],
) {
  const { fuels, byFuel, stacked, production } = productionStack(
    timeline,
    fuelOrder,
  );
  const sources: SupplySource[] = [...fuels];
  const bySource = [...byFuel];
  const supply = [...production];
  const flows: Array<[SupplySource, number[]]> = [
    ["Storage discharge", timeline.map((tick) => tick.storageDischargeW || 0)],
    ["Imports", timeline.map((tick) => tick.importedW || 0)],
  ];
  // Include a source throughout the displayed day, even when its current output is zero.
  flows.forEach(([source, values]) => {
    if (!values.some((value) => value > 0)) return;
    sources.push(source);
    bySource.push(values);
    values.forEach((value, i) => (supply[i] += value));
    stacked.push([...supply]);
  });
  // Charging is the power drawn from the grid, before storage conversion losses. Stored Wh
  // and those losses must not be added again to this power balance.
  const totalDemand = timeline.map(
    (tick) => tick.demandW + (tick.storageChargeW || 0) + (tick.exportedW || 0),
  );
  return { sources, bySource, stacked, supply, totalDemand };
}

function storageFill(): uPlot.Series["fill"] {
  let pattern: CanvasPattern | null = null;
  return (u) => {
    if (!pattern) {
      const tile = document.createElement("canvas");
      const ratio = uPlot.pxRatio;
      tile.width = tile.height = 8 * ratio;
      const ctx = tile.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.fillStyle = withAlpha(chartPalette().storage, 0.16);
      ctx.fillRect(0, 0, 8, 8);
      ctx.strokeStyle = withAlpha(chartPalette().storage, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, 8);
      ctx.lineTo(8, -4);
      ctx.moveTo(4, 12);
      ctx.lineTo(12, 4);
      ctx.stroke();
      pattern = u.ctx.createPattern(tile, "repeat");
    }
    return pattern || withAlpha(chartPalette().storage, 0.16);
  };
}

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  const { sources } = getState();
  const fuelLineStart = sources.length + 1;
  const demandLineStart = fuelLineStart + sources.length * 2;
  const linePair = (
    stroke: string,
    width: number,
    dash: number[],
    pastIndex: number,
  ): uPlot.Series[] => [
    { stroke, width, points: { show: false }, spanGaps: false },
    {
      stroke,
      width,
      dash,
      paths: anchoredForecastPaths(pastIndex),
      points: { show: false },
      spanGaps: false,
    },
  ];
  return {
    width: 0, // set by UPlotChart
    height: 0,
    padding: [18 * scale, 5 * scale, 0, 0],
    cursor: {
      x: true,
      y: false,
      points: { show: false },
      drag: { x: false, y: false, setScale: false },
    },
    legend: { show: false },
    scales: {
      x: { time: false, range: () => getState().range },
      y: { range: () => getState().domain },
    },
    axes: [
      xAxis(scale, {
        size: 27,
        splits: () => getState().hourTicks,
        values: (_u, splits) => splits.map(formatMinuteOfDayChartAxis),
      }),
      {
        // Sunrise and sunset ride a second axis so the hours stay evenly spaced and readable
        scale: "x",
        side: 2,
        stroke: tickLabelFill(),
        font: chartFont(),
        grid: { show: false },
        ticks: { show: false },
        border: { show: false },
        size: 18 * scale,
        gap: 0,
        splits: () => getState().sunTicks,
        values: () => SUN_LABELS,
      },
      yAxis(scale, {
        values: (_u, splits) => splits.map((t) => formatWattsAxis(t, splits)),
      }),
    ],
    series: [
      {},
      ...sources.map((source) => ({
        fill:
          source === "Storage discharge"
            ? storageFill()
            : withAlpha(sourceColor(source), 0.16),
        width: 0,
        points: { show: false },
      })),
      ...sources.flatMap((source, i) =>
        linePair(
          sourceColor(source),
          SUPPLY_WIDTH,
          SUPPLY_FORECAST_DASH,
          fuelLineStart + i * 2,
        ),
      ),
      ...linePair(
        chartPalette().demand,
        DEMAND_WIDTH,
        DEMAND_FORECAST_DASH,
        demandLineStart,
      ),
    ],
    bands: sources.slice(1).map((_source, i) => ({ series: [i + 2, i + 1] })),
    plugins: [
      bandsPlugin(() => getState().blackoutSpans, chartPalette().blackout, 0.3),
      baselinePlugin(chartPalette().axis),
      verticalLinePlugin(
        () => getState().currentMinute,
        chartPalette().axis,
        1,
      ),
      {
        hooks: {
          draw: (u) => {
            const now = getState().currentMinute;
            if (now == null) return;
            const ratio = uPlot.pxRatio;
            u.ctx.save();
            u.ctx.font = chartFont(ratio);
            u.ctx.fillStyle = tickLabelFill();
            u.ctx.textAlign = "center";
            const halfWidth = u.ctx.measureText("Now").width / 2;
            const x = Math.max(
              u.bbox.left + halfWidth,
              Math.min(
                u.bbox.left + u.bbox.width - halfWidth,
                u.valToPos(now, "x", true),
              ),
            );
            u.ctx.fillText("Now", x, u.bbox.top - 4 * ratio);
            u.ctx.restore();
          },
        },
      },
    ],
  };
}

export function formatProductionTooltip(
  idx: number,
  state: Pick<
    State,
    | "timeline"
    | "sources"
    | "bySource"
    | "supply"
    | "totalDemand"
    | "startingYear"
  >,
): string {
  const d = state.timeline[idx];
  const date = getDateFromMinute(d.minute, state.startingYear);
  const hour = Math.floor(date.minuteOfDay / 60);
  const minute = Math.floor(date.minuteOfDay % 60)
    .toString()
    .padStart(2, "0");
  const time = `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
  const loads: Array<[string, number | undefined]> = [
    ["Storage charging", d.storageChargeW],
    ["Exports", d.exportedW],
  ];
  return [
    time,
    `Total supply: ${formatWatts(state.supply[idx])}`,
    ...state.sources.map(
      (source, i) => `${source}: ${formatWatts(state.bySource[i][idx])}`,
    ),
    "",
    `Total demand: ${formatWatts(state.totalDemand[idx])}`,
    `Customers: ${formatWatts(d.demandW)}`,
    ...loads
      .filter(([_label, value]) => value && value > 0)
      .map(([label, value]) => `${label}: ${formatWatts(value!)}`),
    ...(d.demandW > d.supplyW
      ? [`Blackout: ${formatWatts(d.demandW - d.supplyW)} unmet`]
      : []),
  ].join("\n");
}

const ChartSupplyDemand = (props: Props): React.JSX.Element => {
  React.useSyncExternalStore(
    subscribeThemeMode,
    getThemeVersion,
    getThemeVersion,
  );
  const {
    startingYear,
    height,
    legend,
    timeline,
    location,
    fuelOrder = [],
  } = props;
  const { sources, bySource, stacked, supply, totalDemand } = supplyDemandStack(
    timeline,
    fuelOrder,
  );
  // Figure out the boundaries of the chart data
  let domainMax = 0;
  const rangeMin = timeline[0].minute;
  const rangeMax = timeline[timeline.length - 1].minute;
  timeline.forEach((_d: ChartData, i) => {
    domainMax = Math.max(domainMax, supply[i], totalDemand[i]);
  });

  // Get sunrise and sunset, sliding forward if it's actually in the next day
  const date = getDateFromMinute(rangeMin, startingYear);
  const midnight = Math.floor(rangeMin / 1440) * 1440;

  const sun = getSunriseSunset(date, location);
  let sunTicks: number[] = [];
  if (sun.daylight === "normal") {
    let sunrise = midnight + sun.sunrise;
    let sunset = midnight + sun.sunset;
    if (sunrise < rangeMin) {
      sunrise =
        midnight +
        1440 +
        getSunriseSunset(
          getDateFromMinute(rangeMin + 1440, startingYear),
          location,
        ).sunrise;
    }
    if (sunset < rangeMin) {
      sunset =
        midnight +
        1440 +
        getSunriseSunset(
          getDateFromMinute(rangeMin + 1440, startingYear),
          location,
        ).sunset;
    }
    sunTicks = [sunrise, sunrise + (sunset - sunrise) / 2, sunset];
  }

  // "Demand peaks in the early evening" only lands if you can read the clock off the axis
  const hourTicks = getHourTicks(rangeMin, rangeMax);

  // BLACKOUT CALCULATION
  let blackoutCount = 0;
  const blackouts = [
    {
      minute: rangeMin,
      value: 0,
    },
  ] as BlackoutEdges[];
  let prev = timeline[0];
  let isBlackout = prev.demandW > prev.supplyW;
  if (isBlackout) {
    blackouts.push({
      minute: rangeMin,
      value: domainMax,
    });
    blackoutCount++;
  }
  timeline.forEach((d: ChartData) => {
    if (d.demandW > d.supplyW && !isBlackout) {
      // Blackout starting: low then high edge
      const intersectionTime = getIntersectionX(
        prev.minute,
        prev.supplyW,
        d.minute,
        d.supplyW,
        prev.minute,
        prev.demandW,
        d.minute,
        d.demandW,
      );
      blackouts.push({ minute: intersectionTime, value: 0 });
      blackouts.push({ minute: intersectionTime, value: domainMax });
      isBlackout = true;
      blackoutCount++;
    } else if (d.demandW <= d.supplyW && isBlackout) {
      // Blackout ending: high then low edge
      const intersectionTime = getIntersectionX(
        prev.minute,
        prev.supplyW,
        d.minute,
        d.supplyW,
        prev.minute,
        prev.demandW,
        d.minute,
        d.demandW,
      );
      blackouts.push({ minute: intersectionTime, value: domainMax });
      blackouts.push({ minute: intersectionTime, value: 0 });
      isBlackout = false;
    }
    prev = d;
  });
  // Final entry
  blackouts.push({
    minute: rangeMax,
    value: isBlackout ? domainMax : 0,
  });

  // Fill continuous bands, then draw each boundary as solid history and dashed forecast.
  const currentMinute = props.currentMinute || 0;
  const isForecast = timeline.map((d: ChartData) => d.minute >= currentMinute);
  const fuelLines = stacked.flatMap((values) => {
    const split = splitPastProjected(values, isForecast, { bridgeEnd: true });
    return [split.past, split.projected];
  });
  const demand = splitPastProjected(totalDemand, isForecast, {
    bridgeEnd: true,
  });
  const minutes = new Array<number>(timeline.length);
  timeline.forEach((d: ChartData, i: number) => {
    minutes[i] = d.minute;
  });

  const state: State = {
    timeline,
    domain: [0, padRange(0, domainMax)[1]],
    range: [rangeMin, rangeMax],
    hourTicks,
    sunTicks,
    blackoutSpans: spansFromEdges(blackouts),
    currentMinute:
      currentMinute <= rangeMin || currentMinute >= rangeMax
        ? null
        : currentMinute,
    sources,
    bySource,
    supply,
    totalDemand,
    startingYear,
  };

  return (
    <div id="chartSupplyDemand" className="dailyProductionChart">
      {legend && (
        <ChartLegend
          items={[
            { name: "Total demand", color: chartPalette().demand, dash: "8,4" },
            ...sources.map((source) => ({
              name: source,
              color: sourceColor(source),
              hatch: source === "Storage discharge",
            })),
          ]}
        />
      )}
      <UPlotChart<State>
        ariaLabel={`Chart of electricity supply and demand over the day. Supply stacks fuel production, storage discharge and imports; total demand includes customers, storage charging and exports. ${blackoutCount ? `${blackoutCount} blackout period${blackoutCount === 1 ? "" : "s"} shaded` : "No blackouts"}`}
        interactiveDetails
        formatSummaryValue={formatWatts}
        height={height}
        state={state}
        data={[
          minutes,
          ...stacked,
          ...fuelLines,
          demand.past,
          demand.projected,
        ]}
        summaryData={[
          minutes,
          ...bySource,
          supply,
          timeline.map((tick) => tick.demandW),
          timeline.map((tick) => tick.storageChargeW || 0),
          timeline.map((tick) => tick.exportedW || 0),
          totalDemand,
        ]}
        seriesLabels={[
          ...sources,
          "Total supply",
          "Customers",
          "Storage charging",
          "Exports",
          "Total demand",
        ]}
        buildOptions={buildOptions}
        structureKey={sources.join(",")}
        tooltip={formatProductionTooltip}
      />
    </div>
  );
};
export default React.memo(ChartSupplyDemand);
