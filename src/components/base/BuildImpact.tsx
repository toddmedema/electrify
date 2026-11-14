import * as React from "react";
import { Typography } from "@mui/material";
import type { FacilityShoppingType, GameType } from "../../Types";
import {
  formatForecastWatts,
  formatForecastWattHours,
} from "../../helpers/Format";
import { chartPalette } from "../../Theme";
import { signature } from "./DeferredProjection";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";
import {
  computeOutlook,
  BuildImpactForecast,
  OutlookReply,
  OutlookRequest,
} from "./OutlookForecast";
import { createOutlookWorker } from "./OutlookWorkerClient";
import { useWorkerRequest } from "./useWorkerRequest";
import UPlotChart from "./UPlotChart";
import { xAxis, yAxis, zeroLinePlugin } from "./UPlotHelpers";
import { PolicyDemandLegend } from "./PolicyDemandChart";
import DecisionImpactPreview from "./DecisionImpactPreview";

const LABELS: [string, string] = ["Before building", "After building"];

/** A selected quote's next-year effect, including time spent under construction. */
export default function BuildImpact({
  game,
  facility,
}: {
  game: GameType;
  facility: FacilityShoppingType;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const gameKey = signature(game);
  // Keep the estimate steady while the live clock advances, and refresh on a planning change.
  const snapshot = React.useMemo(() => forecastWorkerSnapshot(game), [gameKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useWorkerRequest(
    expanded
      ? {
          key: JSON.stringify(facility),
          scope: snapshot,
          message: (requestId: number): OutlookRequest => ({
            requestId,
            kind: "buildImpact",
            game: snapshot,
            facility,
          }),
          fallback: () => computeOutlook("buildImpact", snapshot, facility),
        }
      : undefined,
    {
      createWorker: createOutlookWorker,
      reuseWorker: true,
      debounceMs: 100,
      read: (reply: OutlookReply) =>
        !reply.error && reply.result
          ? {
              result: reply.result as BuildImpactForecast,
            }
          : undefined,
    },
  );
  const result = state.status === "ready" ? state.result : undefined;
  return (
    <details
      className="buildImpact"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Grid impact · next 12 months</summary>
      {expanded && (
        <>
          <Typography variant="body2" color="textSecondary">
            Before and after this project, including construction time. Positive
            supply margin means spare power; negative means a shortage.
          </Typography>
          {facility.yearsToBuild >= 1 && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              This project is still under construction throughout this forecast.
            </Typography>
          )}
          {result ? (
            <>
              <DecisionImpactPreview
                label="Next-year grid impact"
                facts={[
                  {
                    concept: "supply",
                    label: "Lowest supply margin",
                    value: `${formatForecastWatts(Math.min(...result.before.monthlyMarginW))} → ${formatForecastWatts(Math.min(...result.after.monthlyMarginW))}`,
                  },
                  {
                    concept: "blackout",
                    label: "Unserved energy",
                    value: `${formatForecastWattHours(result.before.unservedWh)} → ${formatForecastWattHours(result.after.unservedWh)}`,
                  },
                ]}
              />
              <Typography variant="caption" component="p">
                Lowest supply margin in each month
              </Typography>
              <PolicyDemandLegend labels={LABELS} />
              <UPlotChart
                ariaLabel="Estimated monthly supply margin before and after building, over the next 12 months"
                height={160}
                state={result}
                interactiveTooltip
                tooltip={(index, forecast) =>
                  [
                    `Month ${index + 1} · lowest supply margin`,
                    `Before building: ${formatForecastWatts(forecast.before.monthlyMarginW[index])}`,
                    "",
                    `After building: ${formatForecastWatts(forecast.after.monthlyMarginW[index])}`,
                  ].join("\n")
                }
                data={[
                  result.before.monthlyMarginW.map((_, index) => index + 1),
                  result.before.monthlyMarginW,
                  result.after.monthlyMarginW,
                ]}
                seriesLabels={[
                  "Before building (solid)",
                  "After building (dashed)",
                ]}
                formatSummaryValue={formatForecastWatts}
                buildOptions={({ scale }) => ({
                  width: 0,
                  height: 0,
                  legend: { show: false },
                  plugins: [zeroLinePlugin(chartPalette().tick)],
                  scales: { x: { time: false, range: [1, 12] } },
                  axes: [
                    xAxis(scale, {
                      splits: () => [1, 3, 6, 9, 12],
                      values: (_u, ticks) => ticks.map((tick) => `+${tick} mo`),
                    }),
                    yAxis(scale, {
                      values: (_u, ticks) => ticks.map(formatForecastWatts),
                    }),
                  ],
                  series: [
                    {},
                    {
                      label: LABELS[0],
                      stroke: chartPalette().demand,
                      width: 2,
                    },
                    {
                      label: LABELS[1],
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
              {state.status === "error"
                ? "Couldn’t estimate this project. Reopen the review to retry."
                : "Estimating grid impact…"}
            </Typography>
          )}
        </>
      )}
    </details>
  );
}
