import * as React from "react";
import { Typography } from "@mui/material";
import type {
  FacilityShoppingType,
  GameType,
  TerritoryId,
  TerritoryTileId,
} from "../../Types";
import {
  formatForecastWatts,
  formatForecastWattHours,
} from "../../helpers/Format";
import type { FacilityPurchaseResult } from "../../helpers/PurchaseFacility";
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

const LABELS: [string, string] = ["Before", "After"];
const watts = (value: number | null) =>
  value === null ? "—" : formatForecastWatts(value);
const energy = (value: number | null) =>
  value === null ? "—" : formatForecastWattHours(value);
function minimum(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === values.length ? Math.min(...known) : null;
}

export type FacilityPurchaseSubmission = void | Promise<FacilityPurchaseResult>;

export function finishBuildReview(
  submission: FacilityPurchaseSubmission,
  close: () => void,
): void | Promise<void | string> {
  if (!submission) return close();
  return submission.then((result) =>
    result.status === "accepted" ? close() : result.message,
  );
}

/** Compare the twelve-month periods immediately before and after commissioning. */
export default function BuildPurchaseReviewDialog({
  game,
  facility,
  territoryId,
  tileId,
  ...purchase
}: PurchaseReviewDialogProps & {
  game?: GameType;
  facility: FacilityShoppingType;
  territoryId?: TerritoryId;
  tileId?: TerritoryTileId;
}) {
  const gameKey = purchase.open && game ? signature(game) : undefined;
  const runScope = game?.runIdentity ?? game?.location ?? game?.monthlyHistory;
  // Keep ordinary ticks steady; planning changes and imported runs refresh the estimate.
  const snapshot = React.useMemo(
    () =>
      gameKey !== undefined && game ? forecastWorkerSnapshot(game) : undefined,
    [gameKey, runScope], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const state = useWorkerRequest(
    snapshot
      ? {
          key: JSON.stringify([facility, territoryId, tileId]),
          scope: snapshot,
          message: (requestId: number): OutlookRequest => ({
            requestId,
            kind: "buildImpact",
            game: snapshot,
            facility,
            territoryId,
            tileId,
          }),
          fallback: () =>
            computeOutlook(
              "buildImpact",
              snapshot,
              facility,
              territoryId,
              tileId,
            ),
        }
      : undefined,
    {
      createWorker: createOutlookWorker,
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
      extraFacts={
        game
          ? [...(purchase.extraFacts ?? []), ...impactFacts]
          : purchase.extraFacts
      }
      afterFacts={
        <>
          {purchase.afterFacts}
          {snapshot && (
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
                        snapshot.startingYear,
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
                            ticks.map(
                              (tick) =>
                                getDateFromMinute(
                                  Math.round(
                                    getState().after.startMinute +
                                      tick * MINUTES_PER_MONTH,
                                  ),
                                  snapshot.startingYear,
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
          )}
        </>
      }
    />
  );
}
