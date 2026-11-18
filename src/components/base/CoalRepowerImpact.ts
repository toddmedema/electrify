import { useMemo } from "react";
import type { CoalRepowerType, GameType } from "../../Types";
import { signature } from "./DeferredProjection";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";
import {
  computeOutlook,
  OutlookReply,
  OutlookRequest,
  OutlookResults,
} from "./OutlookForecast";
import { createOutlookWorker } from "./OutlookWorkerClient";
import { useWorkerRequest } from "./useWorkerRequest";

export function useCoalRepowerImpact(
  game: GameType,
  facilityId: number,
  upgrade: CoalRepowerType,
) {
  const gameKey = signature(game);
  const runScope = game.runIdentity ?? game.location;
  const snapshot = useMemo(
    () => forecastWorkerSnapshot(game),
    [gameKey, runScope], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const repower = { facilityId, upgrade };
  type Impact = NonNullable<OutlookResults["coalRepowerImpact"]>;
  return useWorkerRequest<OutlookRequest, OutlookReply, Impact>(
    {
      key: `${facilityId}:${upgrade}`,
      scope: snapshot,
      message: (requestId: number): OutlookRequest => ({
        requestId,
        kind: "coalRepowerImpact",
        game: snapshot,
        repower,
      }),
      fallback: () => {
        const impact = computeOutlook(
          "coalRepowerImpact",
          snapshot,
          undefined,
          repower,
        );
        if (!impact) throw new Error("No conversion forecast");
        return impact;
      },
    },
    {
      createWorker: createOutlookWorker,
      debounceMs: 100,
      read: (reply: OutlookReply) =>
        !reply.error && reply.result
          ? {
              result: reply.result as NonNullable<
                OutlookResults["coalRepowerImpact"]
              >,
            }
          : undefined,
    },
  );
}
