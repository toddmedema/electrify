import { Typography } from "@mui/material";
import type { DateType } from "../../Types";
import { formatForecastWatts } from "../../helpers/Format";
import { chartPalette } from "../../Theme";
import { PolicyDemandLegend } from "./PolicyDemandChart";
import UPlotChart from "./UPlotChart";
import { xAxis, yAxis, zeroLinePlugin } from "./UPlotHelpers";

interface MarginComparison {
  months: number[];
  before: { monthlyMarginW: Array<number | null> };
  after: { monthlyMarginW: Array<number | null> };
}

const watts = (value: number | null) =>
  value === null ? "—" : formatForecastWatts(value);

export default function SupplyMarginComparisonChart<
  T extends MarginComparison,
>({
  forecast,
  failed,
  labels,
  ariaLabel,
  dateAt,
  periodLabel,
}: {
  forecast: T | undefined;
  failed: boolean;
  labels: [string, string];
  ariaLabel: string;
  dateAt: (month: number, forecast: T) => DateType;
  periodLabel: (date: DateType) => string;
}) {
  return (
    <div className="buildImpact">
      <div className="chartCaption">Lowest supply margin</div>
      {forecast ? (
        <>
          <PolicyDemandLegend labels={labels} />
          <UPlotChart
            ariaLabel={ariaLabel}
            height={160}
            state={forecast}
            interactiveTooltip
            tooltip={(index, result) =>
              [
                periodLabel(dateAt(result.months[index], result)),
                `${labels[0]}: ${watts(result.before.monthlyMarginW[index])}`,
                "",
                `${labels[1]}: ${watts(result.after.monthlyMarginW[index])}`,
              ].join("\n")
            }
            data={[
              forecast.months,
              forecast.before.monthlyMarginW,
              forecast.after.monthlyMarginW,
            ]}
            seriesLabels={[`${labels[0]} (solid)`, `${labels[1]} (dashed)`]}
            formatSummaryValue={formatForecastWatts}
            buildOptions={({ scale, getState }) => ({
              width: 0,
              height: 0,
              legend: { show: false },
              plugins: [zeroLinePlugin(chartPalette().tick)],
              scales: {
                x: { time: false, range: (_u, min, max) => [min, max] },
              },
              axes: [
                xAxis(scale, {
                  splits: () =>
                    getState().months.filter(
                      (_, index, months) =>
                        index % 3 === 0 || index === months.length - 1,
                    ),
                  values: (_u, ticks) =>
                    ticks.map((month) => dateAt(month, getState()).month),
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
        </>
      ) : (
        <Typography role="status" sx={{ py: 2 }}>
          {failed
            ? "Couldn’t estimate this project. Reopen the review to retry."
            : "Estimating grid impact…"}
        </Typography>
      )}
    </div>
  );
}
