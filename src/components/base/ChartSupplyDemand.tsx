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
  formatHour,
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
  fuels: FuelNameType[];
  production: number[];
  showCustomerSupply: boolean;
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

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  const { fuels, showCustomerSupply } = getState();
  const fuelLineStart = fuels.length + 1;
  const supplyLineStart = fuelLineStart + fuels.length * 2;
  const demandLineStart = supplyLineStart + (showCustomerSupply ? 2 : 0);
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
      ...fuels.map((fuel) => ({
        fill: withAlpha(fuelColors()[fuel], 0.16),
        width: 0,
        points: { show: false },
      })),
      ...fuels.flatMap((fuel, i) =>
        linePair(
          fuelColors()[fuel],
          SUPPLY_WIDTH,
          SUPPLY_FORECAST_DASH,
          fuelLineStart + i * 2,
        ),
      ),
      ...(showCustomerSupply
        ? linePair(chartPalette().supply, 2, [6, 3, 2, 3], supplyLineStart)
        : []),
      ...linePair(
        chartPalette().demand,
        DEMAND_WIDTH,
        DEMAND_FORECAST_DASH,
        demandLineStart,
      ),
    ],
    bands: fuels.slice(1).map((_fuel, i) => ({ series: [i + 2, i + 1] })),
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
  state: Pick<State, "timeline" | "fuels" | "production" | "startingYear">,
): string {
  const d = state.timeline[idx];
  const time = formatHour(getDateFromMinute(d.minute, state.startingYear));
  const flows: Array<[string, number | undefined]> = [
    ["Storage discharging", d.storageDischargeW],
    ["Storage charging", d.storageChargeW],
    ["Imports", d.importedW],
    ["Exports", d.exportedW],
  ];
  return [
    time,
    ...state.fuels.map(
      (fuel) => `${fuel}: ${formatWatts(d.supplyByFuel[fuel] || 0)}`,
    ),
    `Total production: ${formatWatts(state.production[idx])}`,
    ...flows
      .filter(([_label, value]) => value && value > 0)
      .map(([label, value]) => `${label}: ${formatWatts(value!)}`),
    `Supply to customers: ${formatWatts(d.supplyW)}`,
    `Demand: ${formatWatts(d.demandW)}`,
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
  const { fuels, byFuel, stacked, production } = productionStack(
    timeline,
    fuelOrder,
  );
  const showCustomerSupply = timeline.some(
    (tick, i) => Math.abs(tick.supplyW - production[i]) > 1,
  );
  // Figure out the boundaries of the chart data
  let domainMax = 0;
  const rangeMin = timeline[0].minute;
  const rangeMax = timeline[timeline.length - 1].minute;
  timeline.forEach((d: ChartData, i) => {
    domainMax = Math.max(domainMax, production[i], d.supplyW, d.demandW);
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
    } else if (d.demandW < d.supplyW && isBlackout) {
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
  const supply = splitPastProjected(
    timeline.map((d: ChartData) => d.supplyW),
    isForecast,
    { bridgeEnd: true },
  );
  const demand = splitPastProjected(
    timeline.map((d: ChartData) => d.demandW),
    isForecast,
    { bridgeEnd: true },
  );
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
    fuels,
    production,
    showCustomerSupply,
    startingYear,
  };

  return (
    <div id="chartSupplyDemand" className="dailyProductionChart">
      {legend && (
        <>
          <div className="dailyProductionHeading">Production by fuel</div>
          <ChartLegend
            items={[
              ...fuels.map((fuel) => ({
                name: fuel,
                color: fuelColors()[fuel],
              })),
              ...(showCustomerSupply
                ? [
                    {
                      name: "Supply to customers",
                      color: chartPalette().supply,
                      dash: "6,3,2,3",
                    },
                  ]
                : []),
              { name: "Demand", color: chartPalette().demand, dash: "8,4" },
              ...(blackoutCount
                ? [{ name: "Blackout", color: chartPalette().blackout }]
                : []),
            ]}
          />
        </>
      )}
      <UPlotChart<State>
        ariaLabel={`Chart of electricity supply and demand over the day, with production stacked by fuel. ${blackoutCount ? `${blackoutCount} blackout period${blackoutCount === 1 ? "" : "s"} shaded` : "No blackouts"}`}
        formatSummaryValue={formatWatts}
        height={height}
        state={state}
        data={[
          minutes,
          ...stacked,
          ...fuelLines,
          ...(showCustomerSupply ? [supply.past, supply.projected] : []),
          demand.past,
          demand.projected,
        ]}
        summaryData={[
          minutes,
          ...byFuel,
          production,
          timeline.map((tick) => tick.supplyW),
          timeline.map((tick) => tick.demandW),
        ]}
        seriesLabels={[
          ...fuels,
          "Total production",
          "Supply to customers",
          "Demand",
        ]}
        buildOptions={buildOptions}
        structureKey={`${fuels.join(",")}|${showCustomerSupply}`}
        tooltip={formatProductionTooltip}
      />
      {legend && (
        <div className="dailyProductionNote">
          <div>Bands: fuel output · Top: total production</div>
          <div>Solid: recorded · Dashed: forecast</div>
        </div>
      )}
    </div>
  );
};
export default React.memo(ChartSupplyDemand);
