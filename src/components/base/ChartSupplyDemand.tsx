import * as React from "react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import {
  bandsPlugin,
  chartFont,
  legendPlugin,
  LegendItem,
  padRange,
  spansFromEdges,
  TICK_LABEL_FILL,
  verticalLinePlugin,
  xAxis,
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
import { blackoutColor, demandColor, supplyColor } from "../../Theme";
import { LocationType } from "../../Types";

interface ChartData {
  minute: number;
  supplyW: number;
  demandW: number;
}

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
  legendItems: LegendItem[];
}

const SUN_LABELS = ["🌅", "☀️ ", "🌇"];
const HISTORIC_FILL = "#e3f2fd"; // blue50

function buildOptions({ getState, scale }: BuildContext<State>): uPlot.Options {
  return {
    width: 0, // set by UPlotChart
    height: 0,
    padding: [10 * scale, 5 * scale, 0, 0],
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
        stroke: TICK_LABEL_FILL,
        font: chartFont(scale),
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
      {
        stroke: supplyColor,
        width: 1.75,
        fill: HISTORIC_FILL,
        points: { show: false },
        spanGaps: false,
      },
      {
        stroke: supplyColor,
        width: 1,
        points: { show: false },
        spanGaps: false,
      },
      {
        stroke: demandColor,
        width: 2.5,
        points: { show: false },
      },
    ],
    plugins: [
      bandsPlugin(() => getState().blackoutSpans, blackoutColor, 0.3),
      verticalLinePlugin(() => getState().currentMinute, "#000000", 0.5),
      legendPlugin(() => getState().legendItems, 280, 18),
    ],
  };
}

function tooltip(idx: number, state: State): string {
  const d = state.timeline[idx];
  return `Supply: ${formatWatts(d.supplyW)}\nDemand: ${formatWatts(d.demandW)}`;
}

// TODO how to indicate history vs reality vs forecast? Perhaps current time as a prop, and then split it in the chart
// and don't actually differentiate between reality +  forecast in data?
const ChartSupplyDemand = (props: Props): React.JSX.Element => {
  const { startingYear, height, legend, timeline, location } = props;
  // Figure out the boundaries of the chart data
  let domainMin = 999999999999;
  let domainMax = 0;
  const rangeMin = timeline[0].minute;
  const rangeMax = timeline[timeline.length - 1].minute;
  timeline.forEach((d: ChartData) => {
    domainMin = Math.min(domainMin, d.supplyW, d.demandW);
    domainMax = Math.max(domainMax, d.supplyW, d.demandW);
  });

  // Get sunrise and sunset, sliding forward if it's actually in the next day
  const date = getDateFromMinute(rangeMin, startingYear);
  const midnight = Math.floor(rangeMin / 1440) * 1440;

  let sunrise = midnight + getSunriseSunset(date, location).sunrise;
  let sunset = midnight + getSunriseSunset(date, location).sunset;
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

  const noon = sunrise + (sunset - sunrise) / 2;

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

  // Divide between historic and forecast. One aligned x per tick, with each series blanked out
  // where it doesn't apply, so the two halves of supply can be styled differently.
  const currentMinute = props.currentMinute || 0;
  const minutes = new Array<number>(timeline.length);
  const supplyHistoric = new Array<number | null>(timeline.length);
  const supplyForecast = new Array<number | null>(timeline.length);
  const demand = new Array<number>(timeline.length);
  timeline.forEach((d: ChartData, i: number) => {
    minutes[i] = d.minute;
    supplyHistoric[i] = d.minute <= currentMinute ? d.supplyW : null;
    supplyForecast[i] = d.minute >= currentMinute ? d.supplyW : null;
    demand[i] = d.demandW;
  });

  // The blackout key only earns its place once there has been a blackout to explain
  const legendItems: LegendItem[] = [];
  if (legend) {
    legendItems.push(
      { name: "Supply", fill: supplyColor },
      { name: "Demand", fill: demandColor },
    );
    if (blackoutCount > 0) {
      legendItems.push({ name: "Blackout", fill: blackoutColor });
    }
  }

  const state: State = {
    timeline,
    domain: padRange(domainMin, domainMax),
    range: [rangeMin, rangeMax],
    hourTicks,
    sunTicks: [sunrise, noon, sunset],
    blackoutSpans: spansFromEdges(blackouts),
    currentMinute: currentMinute === rangeMax ? null : currentMinute,
    legendItems,
  };

  return (
    <UPlotChart<State>
      ariaLabel="Chart of electricity supply and demand over the day"
      height={height}
      state={state}
      data={[minutes, supplyHistoric, supplyForecast, demand]}
      buildOptions={buildOptions}
      tooltip={tooltip}
    />
  );
};
export default ChartSupplyDemand;
