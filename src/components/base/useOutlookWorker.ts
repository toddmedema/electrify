import * as React from "react";
import type { GameType } from "../../Types";
import { afterPaint, useAfterPaintValue } from "./AfterPaint";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";
import {
  computeOutlook,
  OutlookKind,
  OutlookReply,
  OutlookResults,
} from "./OutlookForecast";
import { createOutlookWorker } from "./OutlookWorkerClient";

/** Persistent outlook worker; one request runs while edits collapse to the newest snapshot. */
export function useOutlookWorker<K extends OutlookKind>(
  kind: K,
  key: string | undefined,
  game: GameType,
): OutlookResults[K] {
  // Imported saves carry new run/location objects even when their seed and month agree.
  const scope = game.runIdentity ?? game.location ?? game.monthlyHistory;
  const [settled, setSettled] = React.useState<{
    scope: unknown;
    month: number;
    result: OutlookResults[K];
  }>();
  const latest = React.useRef<{
    requestId: number;
    game: GameType;
    scope: unknown;
  }>();
  const worker = React.useRef<Worker>();
  const inFlight = React.useRef<number>();
  const nextId = React.useRef(0);
  const failed = React.useRef(false);
  const cancel = React.useRef<() => void>();
  const supported = typeof Worker !== "undefined";
  const fallback = useAfterPaintValue(
    !supported ? key : undefined,
    () => computeOutlook(kind, game),
    scope,
  );

  React.useEffect(() => {
    if (!supported || key === undefined) {
      latest.current = undefined;
      return;
    }
    latest.current = { requestId: ++nextId.current, game, scope };
    const publish = (
      request: NonNullable<typeof latest.current>,
      result: OutlookResults[K],
    ) => {
      if (latest.current !== request) return;
      latest.current = undefined;
      setSettled({
        scope: request.scope,
        month: request.game.date.monthsElapsed,
        result,
      });
    };
    const onFailure = () => {
      worker.current?.terminate();
      worker.current = undefined;
      inFlight.current = undefined;
      failed.current = true;
      cancel.current?.();
      const request = latest.current;
      if (request)
        cancel.current = afterPaint(() => {
          if (latest.current === request)
            publish(request, computeOutlook(kind, request.game));
        });
    };
    const dispatch = () => {
      const request = latest.current;
      if (!request || inFlight.current !== undefined) return;
      if (failed.current) {
        onFailure();
        return;
      }
      try {
        if (!worker.current) worker.current = createOutlookWorker();
        worker.current.onmessage = (event: MessageEvent<OutlookReply>) => {
          if (event.data.requestId !== inFlight.current) return;
          inFlight.current = undefined;
          const current = latest.current;
          if (current?.requestId === event.data.requestId) {
            if (event.data.error) {
              onFailure();
              return;
            }
            publish(current, event.data.result as OutlookResults[K]);
          }
          dispatch();
        };
        worker.current.onerror = (event) => {
          event.preventDefault();
          onFailure();
        };
        worker.current.onmessageerror = onFailure;
        inFlight.current = request.requestId;
        worker.current.postMessage({
          requestId: request.requestId,
          kind,
          game: forecastWorkerSnapshot(request.game),
        });
      } catch (_error) {
        onFailure();
      }
    };
    cancel.current = afterPaint(dispatch);
    return () => cancel.current?.();
    // Keep the snapshot from the first render that saw these inputs, as the synchronous
    // month-keyed computation did. Ordinary ticks never enqueue another forecast.
  }, [kind, key, scope, supported]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(
    () => () => {
      latest.current = undefined;
      cancel.current?.();
      worker.current?.terminate();
      worker.current = undefined;
      inFlight.current = undefined;
      failed.current = false;
    },
    [],
  );

  if (key === undefined) return undefined;
  if (!supported) return fallback;
  return settled?.scope === scope && settled.month <= game.date.monthsElapsed
    ? settled.result
    : undefined;
}
