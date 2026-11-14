import * as React from "react";
import { Typography } from "@mui/material";
import type { FacilityShoppingType, GameType } from "../../Types";
import {
  formatForecastWatts,
  formatForecastWattHours,
} from "../../helpers/Format";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
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
import type { DecisionImpactFactType } from "./DecisionImpactPreview";
import {
  LivePurchaseReviewDialog as PurchaseReviewDialog,
  PurchaseReviewDialogProps,
} from "./PurchaseReviewDialog";

const LABELS: [string, string] = ["Before opening", "After opening"];
const watts = (value: number | null) =>
  value === null ? "—" : formatForecastWatts(value);
const energy = (value: number | null) =>
  value === null ? "—" : formatForecastWattHours(value);
function minimum(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === values.length ? Math.min(...known) : null;
}

export default function BuildPurchaseReviewDialog({
  game,
  facility,
  ...purchase
}: PurchaseReviewDialogProps & {
  game?: GameType;
  facility: FacilityShoppingType;
}) {
  return purchase.open && game ? (
    <BuildPurchaseForecast
      game={game}
      facility={facility}
      purchase={purchase}
    />
  ) : (
    <PurchaseReviewDialog {...purchase} />
  );
}

/** Compare the twelve-month periods immediately before and after commissioning. */
function BuildPurchaseForecast({
  game,
  facility,
  purchase,
}: {
  game: GameType;
  facility: FacilityShoppingType;
  purchase: PurchaseReviewDialogProps;
}) {
  const gameKey = signature(game);
  // Keep the estimate steady while the live clock advances, and refresh on a planning change.
  const snapshot = React.useMemo(() => forecastWorkerSnapshot(game), [gameKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useWorkerRequest(
    {
      key: JSON.stringify(facility),
      scope: snapshot,
      message: (requestId: number): OutlookRequest => ({
        requestId,
        kind: "buildImpact",
        game: snapshot,
        facility,
      }),
      fallback: () => computeOutlook("buildImpact", snapshot, facility),
    },
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
  const pendingValue = state.status === "error" ? "—" : "Estimating…";
  const impactFacts: DecisionImpactFactType[] = [
    {
      concept: "supply",
      label: "Lowest supply margin",
      value: result
        ? `${watts(minimum(result.before.monthlyMarginW))} → ${watts(minimum(result.after.monthlyMarginW))}`
        : pendingValue,
      detail: "1 year before vs after opening",
    },
    {
      concept: "blackout",
      label: "Unserved energy",
      value: result
        ? `${energy(result.before.unservedWh)} → ${energy(result.after.unservedWh)}`
        : pendingValue,
      detail: "1 year before vs after opening",
    },
  ];
  return (
    <PurchaseReviewDialog
      {...purchase}
      extraFacts={[...(purchase.extraFacts ?? []), ...impactFacts]}
      afterFacts={
        <>
          {purchase.afterFacts}
          <div className="buildImpact">
            <div className="chartCaption">Lowest supply margin</div>
            {result ? (
              <>
                <PolicyDemandLegend labels={LABELS} />
                <UPlotChart
                  ariaLabel="Estimated monthly supply margin before and after commissioning, twelve months each"
                  height={160}
                  state={result}
                  interactiveTooltip
                  tooltip={(index, forecast) => {
                    const date = getDateFromMinute(
                      Math.round(
                        forecast.after.startMinute +
                          forecast.months[index] * MINUTES_PER_MONTH,
                      ),
                      game.startingYear,
                    );
                    return [
                      `${date.month} ${date.year - 1} → ${date.month} ${date.year}`,
                      `${LABELS[0]}: ${watts(forecast.before.monthlyMarginW[index])}`,
                      "",
                      `${LABELS[1]}: ${watts(forecast.after.monthlyMarginW[index])}`,
                    ].join("\n");
                  }}
                  data={[
                    result.months,
                    result.before.monthlyMarginW,
                    result.after.monthlyMarginW,
                  ]}
                  seriesLabels={[
                    `${LABELS[0]} (solid)`,
                    `${LABELS[1]} (dashed)`,
                  ]}
                  formatSummaryValue={formatForecastWatts}
                  buildOptions={({ scale }) => ({
                    width: 0,
                    height: 0,
                    legend: { show: false },
                    plugins: [zeroLinePlugin(chartPalette().tick)],
                    scales: { x: { time: false, range: [0, 12] } },
                    axes: [
                      xAxis(scale, {
                        splits: () => [0, 3, 6, 9, 12],
                        values: (_u, ticks) =>
                          ticks.map(
                            (tick) =>
                              getDateFromMinute(
                                result.after.startMinute +
                                  tick * MINUTES_PER_MONTH,
                                game.startingYear,
                              ).month,
                          ),
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
          </div>
        </>
      }
    />
  );
}
