import * as React from "react";
import UPlotChart from "./UPlotChart";
import { chartPalette } from "../../Theme";
import { formatWatts } from "../../helpers/Format";

export default function PolicyDemandChart({
  current,
  changed,
}: {
  current: number[];
  changed: number[];
}) {
  return (
    <UPlotChart
      ariaLabel="Estimated utility demand: current plan and with this change, over a representative day"
      height={140}
      state={{}}
      data={[
        current.map((_, i) => (i * 24) / current.length),
        current,
        changed,
      ]}
      seriesLabels={["Current plan (solid)", "With this change (dashed)"]}
      formatSummaryValue={formatWatts}
      buildOptions={() => ({
        width: 0,
        height: 0,
        legend: { show: false },
        scales: {
          x: { time: false },
          y: { range: (_u, _min, max) => [0, max * 1.1] },
        },
        axes: [
          {
            stroke: chartPalette().tickLabel,
            grid: { stroke: chartPalette().grid },
            ticks: { stroke: chartPalette().tick },
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
          { label: "Current plan", stroke: chartPalette().demand, width: 2 },
          {
            label: "With this change",
            stroke: chartPalette().supply,
            dash: [6, 4],
            width: 2,
          },
        ],
      })}
    />
  );
}
