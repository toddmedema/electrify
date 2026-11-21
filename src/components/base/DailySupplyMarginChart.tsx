import { useState } from "react";
import { MONTHS, TICK_MINUTES, TICKS_PER_DAY } from "../../Constants";
import { formatForecastWatts } from "../../helpers/Format";
import { chartPalette } from "../../Theme";
import type { BuildImpactForecast } from "./OutlookForecast";
import { PolicyDemandLegend } from "./PolicyDemandChart";
import UPlotChart from "./UPlotChart";
import { xAxis, yAxis, zeroLinePlugin } from "./UPlotHelpers";

const minutes = Array.from(
  { length: TICKS_PER_DAY + 1 },
  (_, index) => index * TICK_MINUTES,
);
const timeMarks = [0, 6 * 60, 12 * 60, 18 * 60, 24 * 60];
const annual = "12 month avg";

function clock(minute: number) {
  const hour = String(Math.floor(minute / 60)).padStart(2, "0");
  return `${hour}:${String(minute % 60).padStart(2, "0")}`;
}

function extendToMidnight(values: Array<number | null>) {
  return [...values, values.at(-1) ?? null];
}

export default function DailySupplyMarginChart({
  forecast,
  labels,
}: {
  forecast: BuildImpactForecast;
  labels: [string, string];
}) {
  const [month, setMonth] = useState(-1);
  const { before, after } = forecast;
  const beforeDay = before.averageDayByMonthW[month] ?? before.averageDayW;
  const afterDay = after.averageDayByMonthW[month] ?? after.averageDayW;
  const watts = (value: number | null) =>
    value === null ? "—" : formatForecastWatts(value);
  return (
    <section className="dailySupplyMargin">
      <div className="dailySupplyMarginHeader">
        <h3>Average daily supply margin</h3>
        <select
          aria-label="Average day period"
          value={month}
          onChange={(event) => setMonth(Number(event.target.value))}
        >
          <option value={-1}>{annual}</option>
          {MONTHS.map((name, index) => (
            <option value={index} key={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <PolicyDemandLegend labels={labels} />
      <UPlotChart
        ariaLabel={`Estimated average daily supply margin before and after commissioning, ${MONTHS[month] ?? annual}`}
        height={160}
        state={{ beforeDay, afterDay }}
        interactiveTooltip
        tooltip={(index, { beforeDay, afterDay }) => {
          const slot = Math.min(index, TICKS_PER_DAY - 1);
          return [
            `${clock(minutes[slot])}–${clock(minutes[slot + 1])}`,
            `${labels[0]}: ${watts(beforeDay[slot])}`,
            "",
            `${labels[1]}: ${watts(afterDay[slot])}`,
          ].join("\n");
        }}
        data={[
          minutes,
          extendToMidnight(beforeDay),
          extendToMidnight(afterDay),
        ]}
        seriesLabels={[`${labels[0]} (solid)`, `${labels[1]} (dashed)`]}
        formatSummaryValue={formatForecastWatts}
        buildOptions={({ scale }) => ({
          width: 0,
          height: 0,
          legend: { show: false },
          plugins: [zeroLinePlugin(chartPalette().tick)],
          scales: {
            x: { time: false, range: [0, 24 * 60] },
          },
          axes: [
            xAxis(scale, {
              splits: () => timeMarks,
              values: (_u, ticks) => ticks.map(clock),
            }),
            yAxis(scale, {
              values: (_u, ticks) => ticks.map(formatForecastWatts),
            }),
          ],
          series: [
            {},
            { label: labels[0], stroke: chartPalette().demand, width: 2 },
            {
              label: labels[1],
              stroke: chartPalette().supply,
              width: 2,
              dash: [6, 4],
            },
          ],
        })}
      />
    </section>
  );
}
