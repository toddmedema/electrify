import * as React from "react";
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
import SupplyMarginComparisonChart from "./SupplyMarginComparisonChart";
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
            <SupplyMarginComparisonChart
              forecast={result}
              failed={state.status === "error"}
              labels={LABELS}
              ariaLabel="Estimated monthly supply margin before and after commissioning, twelve months each"
              dateAt={(month, forecast) =>
                getDateFromMinute(
                  Math.round(
                    forecast.after.startMinute + month * MINUTES_PER_MONTH,
                  ),
                  snapshot.startingYear,
                )
              }
              periodLabel={(date) =>
                `${date.month} ${date.year - 1} → ${date.month} ${date.year}`
              }
            />
          )}
        </>
      }
    />
  );
}
