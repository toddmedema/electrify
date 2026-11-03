import * as React from "react";
import uPlot from "uplot";
import { Typography } from "@mui/material";
import UPlotChart, { BuildContext } from "./UPlotChart";
import ChartLegend from "./ChartLegend";
import {
  FORECAST_RIGHT_PAD,
  forecastMonthAxis,
  padRange,
  patternFill,
  verticalLinePlugin,
  yAxis,
  zeroLinePlugin,
} from "./UPlotHelpers";
import { TickPresentFutureType, TransmissionStateType } from "../../Types";
import {
  formatMinuteAsTooltipHeader,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattsAxis,
} from "../../helpers/Format";
import { chartPalette, getThemeVersion, subscribeThemeMode } from "../../Theme";

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
  /** Where recorded history ends and the forecast begins, marked with a line */
  currentMinute?: number;
  /** With both directions disabled the empty chart says so, rather than blaming balanced supply */
  transmission?: Pick<TransmissionStateType, "buyingRule" | "sellingRule">;
}

/** What crossed the interties at one moment, or on average across a month. */
export interface ExchangePoint {
  minute: number;
  importedW: number;
  exportedW: number;
  /** What the lines could carry then, after hot-weather derating */
  capacityW: number;
  pricePerMWh: number;
}

// An hourly line over a few years is a band of daily swings too thin to read, so past a year the
// chart shows monthly averages, as Supply by Fuel does
const MONTHLY_ABOVE_MINUTES = 12 * MINUTES_PER_MONTH;

function pointOf(tick: TickPresentFutureType): ExchangePoint {
  return {
    minute: tick.minute,
    importedW: tick.importedW || 0,
    exportedW: tick.exportedW || 0,
    capacityW: tick.transmissionCapacityW || 0,
    pricePerMWh: tick.marketPricePerMWh || 0,
  };
}

/**
 * Time-weighted monthly averages of imports, exports and line capacity, one point per game month.
 *
 * Imports and exports are averaged separately, never netted: a month can import through the
 * evening and export at midday, and the net would hide both. The price is weighted by the power
 * that flowed at it, since that is what the month's trades actually cost. The sampled forecast
 * is uneven, so each tick counts for the time until the next one. Recorded history already holds
 * one average per month and passes through unchanged.
 */
export function monthlyExchange(
  timeline: TickPresentFutureType[],
): ExchangePoint[] {
  const months: ExchangePoint[] = [];
  let bucket = Number.NaN;
  let first: TickPresentFutureType | undefined;
  let time = 0;
  let imported = 0;
  let exported = 0;
  let capacity = 0;
  let flow = 0;
  let paid = 0;
  let priceTime = 0;
  const flush = () => {
    if (!first) return;
    months.push({
      minute: first.minute,
      importedW: imported / time,
      exportedW: exported / time,
      capacityW: capacity / time,
      pricePerMWh: flow > 0 ? paid / flow : priceTime / time,
    });
  };
  timeline.forEach((tick, i) => {
    const month = Math.floor(tick.minute / MINUTES_PER_MONTH);
    if (month !== bucket) {
      flush();
      bucket = month;
      first = tick;
      time = imported = exported = capacity = flow = paid = priceTime = 0;
    }
    const next = timeline[i + 1];
    // The last point still counts for something, or a month made only of it would divide by zero
    const weight = Math.max(
      next
        ? Math.min(next.minute, (month + 1) * MINUTES_PER_MONTH) - tick.minute
        : 0,
      1e-6,
    );
    const { importedW, exportedW, capacityW, pricePerMWh } = pointOf(tick);
    time += weight;
    imported += importedW * weight;
    exported += exportedW * weight;
    capacity += capacityW * weight;
    flow += (importedW + exportedW) * weight;
    paid += pricePerMWh * (importedW + exportedW) * weight;
    priceTime += pricePerMWh * weight;
  });
  flush();
  return months;
}

/** The points to plot: every simulated hour in a year or less, monthly averages beyond it. */
export function exchangePoints(
  timeline: TickPresentFutureType[],
  monthly: boolean,
): ExchangePoint[] {
  if (monthly) return monthlyExchange(timeline);
  // The sampled forecast repeats its first minute; a duplicate x would tear both areas
  return timeline
    .filter((tick, i) => i === 0 || tick.minute !== timeline[i - 1].minute)
    .map(pointOf);
}

interface State {
  points: ExchangePoint[];
  domain: Props["domain"];
  yRange: [number, number];
  startingYear: number;
  multiyear: boolean;
  monthly: boolean;
  currentMinute: number | null;
}

function buildOptions(showXLabels: boolean) {
  return ({ getState, scale }: BuildContext<State>): uPlot.Options => {
    const palette = chartPalette();
    return {
      width: 0, // set by UPlotChart
      height: 0,
      padding: [5 * scale, FORECAST_RIGHT_PAD, 0, 0],
      cursor: {
        x: true,
        y: false,
        points: { show: false },
        drag: { x: false, y: false, setScale: false },
      },
      legend: { show: false },
      scales: {
        x: { time: false, range: () => getState().domain.x },
        y: { range: () => getState().yRange },
      },
      axes: [
        forecastMonthAxis(scale, getState, showXLabels),
        yAxis(scale, {
          grid: true,
          values: (_u, splits) => splits.map((t) => formatWattsAxis(t, splits)),
        }),
      ],
      series: [
        {},
        // Both are interties, so the colour is shared; direction is carried by which side of the
        // zero line the area sits on, and by the texture
        {
          stroke: palette.intertie,
          width: 1.5,
          fill: patternFill("vertical"),
          points: { show: false },
        },
        {
          stroke: palette.intertie,
          width: 1.5,
          fill: patternFill("hatch"),
          points: { show: false },
        },
      ],
      plugins: [
        zeroLinePlugin(palette.axis),
        verticalLinePlugin(
          () => getState().currentMinute,
          palette.axis,
          1,
          2 * scale,
        ),
      ],
    };
  };
}

function tooltip(idx: number, state: State): string {
  const point = state.points[idx];
  let header: string;
  if (state.monthly) {
    const date = getDateFromMinute(point.minute, state.startingYear);
    header = `${date.month} ${date.year} average`;
  } else {
    header = formatMinuteAsTooltipHeader(point.minute, state.startingYear);
  }
  return [
    header,
    `Imports: ${formatWatts(point.importedW)}`,
    `Exports: ${formatWatts(point.exportedW)}`,
    `Neighbor price: ${formatMoneyConcise(point.pricePerMWh)}/MWh`,
    `Line capacity: ${formatWatts(point.capacityW)}`,
  ].join("\n");
}

// The swatches are painted from the palette in force, so this one wakes when the theme changes:
// the class below is pure and would otherwise keep the colours it was first drawn with
function PowerExchangeLegend(): React.JSX.Element {
  React.useSyncExternalStore(
    subscribeThemeMode,
    getThemeVersion,
    getThemeVersion,
  );
  const palette = chartPalette();
  return (
    <ChartLegend
      items={[
        {
          name: "Imports above 0",
          color: palette.powerFlowPattern,
          pattern: "vertical",
          fill: palette.powerFlowFill,
        },
        {
          name: "Exports below 0",
          color: palette.powerFlowPattern,
          pattern: "hatch",
          fill: palette.powerFlowFill,
        },
      ]}
    />
  );
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastPowerExchange extends React.PureComponent<
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
      currentMinute,
      transmission,
    } = this.props;
    const monthly = domain.x[1] - domain.x[0] > MONTHLY_ABOVE_MINUTES;
    const points = exchangePoints(timeline, monthly);

    const minutes = new Array<number>(points.length);
    const importRow = new Array<number>(points.length);
    // Exports plot below zero...
    const exportRow = new Array<number>(points.length);
    // ...so the accessible summary reads how much was exported from this row instead
    const exportSizeRow = new Array<number>(points.length);
    let peakImport = 0;
    let peakExport = 0;
    points.forEach((point, i) => {
      minutes[i] = point.minute;
      importRow[i] = point.importedW;
      exportRow[i] = point.exportedW > 0 ? -point.exportedW : 0;
      exportSizeRow[i] = point.exportedW;
      peakImport = Math.max(peakImport, point.importedW);
      peakExport = Math.max(peakExport, point.exportedW);
    });

    if (peakImport <= 0 && peakExport <= 0) {
      return (
        <Typography
          className="powerExchangeEmpty"
          variant="body2"
          role="note"
          color="text.secondary"
          sx={{ mx: 2, my: 1 }}
        >
          {transmission?.buyingRule === "NONE" &&
          transmission.sellingRule === "NONE"
            ? "No power is crossing your interties because trading is turned off."
            : "No imports or exports in this period. Your interties only trade when you fall short or have surplus to sell."}
        </Typography>
      );
    }

    // Keep a sliver of room on the side that never fires, so the zero line sits clear of the axis
    const yRange = padRange(
      -Math.max(peakExport, peakImport * 0.15),
      Math.max(peakImport, peakExport * 0.15),
    );

    const state: State = {
      points,
      domain,
      yRange,
      startingYear,
      multiyear,
      monthly,
      // A line on the chart's edge says nothing, and just thickens the frame
      currentMinute:
        currentMinute === undefined ||
        currentMinute <= domain.x[0] ||
        currentMinute >= domain.x[1]
          ? null
          : currentMinute,
    };

    return (
      <>
        <PowerExchangeLegend />
        <UPlotChart<State>
          id="chartForecastPowerExchange"
          ariaLabel="Chart of predicted imports and exports over your interties. Imports plot above zero and exports below zero"
          formatSummaryValue={formatWatts}
          height={height}
          state={state}
          data={[minutes, importRow, exportRow]}
          summaryData={[minutes, importRow, exportSizeRow]}
          seriesLabels={["Imports", "Exports"]}
          buildOptions={buildOptions(showXLabels !== false)}
          structureKey={String(showXLabels !== false)}
          syncKey={syncKey}
          tooltip={tooltip}
        />
      </>
    );
  }
}
