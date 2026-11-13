import * as React from "react";
import { Box } from "@mui/material";
import UPlotChart from "./UPlotChart";
import ChartLegend from "./ChartLegend";
import { chartPalette, getThemeVersion, subscribeThemeMode } from "../../Theme";
import { formatForecastWatts as formatWatts } from "../../helpers/Format";
import { DESIGN_WIDTH, MAX_CHART_SCALE } from "./UPlotHelpers";

const CHART_HEIGHT = 140;
// The changed plan's dash, shared by the plotted series and its legend swatch.
const CHANGED_DASH = [6, 4];

/** The key to PolicyDemandChart, drawn with the plotted lines' own colours and dash. */
export function PolicyDemandLegend({
  labels = ["Current plan", "With this change"],
}: {
  labels?: [string, string];
}) {
  React.useSyncExternalStore(
    subscribeThemeMode,
    getThemeVersion,
    getThemeVersion,
  );
  const palette = chartPalette();
  return (
    <ChartLegend
      items={[
        { name: labels[0], color: palette.demand, dash: "none" },
        {
          name: labels[1],
          color: palette.supply,
          dash: CHANGED_DASH.join(" "),
        },
      ]}
    />
  );
}

/**
 * Holds the chart's exact footprint while the estimate is computed. UPlotChart scales its height
 * with its width up to a cap, so an aspect ratio plus that cap reproduces it at every size.
 */
export function PolicyDemandChartPlaceholder() {
  return (
    <Box
      role="status"
      sx={{
        width: "100%",
        aspectRatio: `${DESIGN_WIDTH} / ${CHART_HEIGHT}`,
        maxHeight: CHART_HEIGHT * MAX_CHART_SCALE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "text.secondary",
      }}
    >
      Estimating this choice…
    </Box>
  );
}

/** The y range for the two demand curves: their own min and max, with a little headroom. */
export function demandRange(min: number, max: number): [number, number] {
  const span = max - min;
  // A flat day (or no data) has no span to pad by, so pad by its size instead
  const pad = span > 0 ? span * 0.1 : Math.abs(max) * 0.1 || 1;
  return [Math.max(0, min - pad), max + pad];
}

export default function PolicyDemandChart({
  current,
  changed,
  labels = ["Current plan", "With this change"],
  ariaLabel = "Estimated demand: current plan and with this change, over a representative day",
}: {
  current: number[];
  changed: number[];
  /** The solid and dashed series' names. */
  labels?: [string, string];
  ariaLabel?: string;
}) {
  return (
    <UPlotChart
      ariaLabel={ariaLabel}
      height={CHART_HEIGHT}
      state={{}}
      data={[
        current.map((_, i) => (i * 24) / current.length),
        current,
        changed,
      ]}
      seriesLabels={[`${labels[0]} (solid)`, `${labels[1]} (dashed)`]}
      formatSummaryValue={formatWatts}
      buildOptions={() => ({
        width: 0,
        height: 0,
        legend: { show: false },
        scales: {
          x: { time: false, range: [0, 24] },
          // Fitted to the data rather than anchored at zero: a program moves the day's demand
          // by a few percent, which a zero-based axis flattens into two overlapping lines
          y: { range: (_u, min, max) => demandRange(min, max) },
        },
        axes: [
          {
            stroke: chartPalette().tickLabel,
            grid: { stroke: chartPalette().grid },
            ticks: { stroke: chartPalette().tick },
            incrs: [6, 12, 24],
            values: (_u, ticks) => ticks.map((t) => `${t}:00`),
          },
          {
            stroke: chartPalette().tickLabel,
            grid: { stroke: chartPalette().grid },
            ticks: { stroke: chartPalette().tick },
            size: 60,
            values: (_u, ticks) => ticks.map((t) => formatWatts(t)),
          },
        ],
        series: [
          {},
          { label: labels[0], stroke: chartPalette().demand, width: 2 },
          {
            label: labels[1],
            stroke: chartPalette().supply,
            dash: CHANGED_DASH,
            width: 2,
          },
        ],
      })}
    />
  );
}
