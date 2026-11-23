import {
  cacheProjection,
  ProjectionView,
  ProjectionScope,
  projectionSignature,
  selectProjection,
} from "../../helpers/Projection";
import {
  GameType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../../Types";
import { afterPaint } from "./AfterPaint";
import { createProjectionWorker } from "./ProjectionWorkerClient";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";
import { projectionDecoder, ProjectionTransport } from "./ProjectionTransport";

/** Each forecast keeps its own worker and latest result. A short top-bar reply
 * cannot settle or cancel the longer planning request when Insights is open. */
function deferProjection(scope: ProjectionScope) {
  let ready: { key: string; history: MonthlyHistoryType[] } | undefined;
  let pending:
    | {
        key: string;
        history: MonthlyHistoryType[];
        game: GameType;
        now: TickPresentFutureType;
        requestId: number;
        cancel: () => void;
      }
    | undefined;
  const listeners = new Set<() => void>();
  let worker: Worker | undefined;
  let workerUnavailable = false;
  let nextRequestId = 0;
  let inFlight: number | undefined;
  let decoding = false;
  const DECODE_BUDGET_MS = 3;

  function cancelPending(): void {
    pending?.cancel();
    if (decoding) {
      decoding = false;
      inFlight = undefined;
    }
  }

  function publish(game: GameType, projection: ProjectionView): void {
    cacheProjection(game, projection, scope);
    ready = { key: signature(game), history: game.monthlyHistory };
    pending = undefined;
    listeners.forEach((listener) => listener());
  }

  function fallback(): void {
    cancelPending();
    worker?.terminate();
    worker = undefined;
    inFlight = undefined;
    workerUnavailable = true;
    if (!pending) return;
    const request = pending;
    request.cancel = afterPaint(() => {
      if (pending === request) {
        publish(
          request.game,
          selectProjection(request.game, request.now, request.key, scope),
        );
      }
    });
  }

  function dispatchPending(): void {
    if (!pending || inFlight !== undefined) return;
    if (workerUnavailable || typeof Worker === "undefined") {
      fallback();
      return;
    }
    try {
      if (!worker) {
        worker = createProjectionWorker();
        worker.onmessage = (
          event: MessageEvent<{
            requestId: number;
            transport?: ProjectionTransport;
            error?: boolean;
          }>,
        ) => {
          if (event.data.requestId !== inFlight) return;
          if (pending?.requestId === event.data.requestId) {
            if (event.data.error || !event.data.transport) {
              fallback();
              return;
            }
            const request = pending;
            const decode = projectionDecoder(
              event.data.transport,
              request.game,
              request.now,
            );
            decoding = true;
            const step = () => {
              if (pending !== request) return;
              try {
                const projection = decode(performance.now() + DECODE_BUDGET_MS);
                if (!projection) {
                  request.cancel = afterPaint(step);
                  return;
                }
                decoding = false;
                inFlight = undefined;
                publish(request.game, projection);
                dispatchPending();
              } catch (_error) {
                fallback();
              }
            };
            request.cancel = afterPaint(step);
            return;
          }
          inFlight = undefined;
          // Only the newest edit is queued; old replies never replace current forecasts.
          dispatchPending();
        };
        worker.onerror = fallback;
        worker.onmessageerror = fallback;
      }
      inFlight = pending.requestId;
      worker.postMessage({
        requestId: pending.requestId,
        game: forecastWorkerSnapshot(pending.game),
        now: pending.now,
        scope,
      });
    } catch (_error) {
      fallback();
    }
  }

  /** Whether selectProjection already holds this game's projection, so reading it is cheap. */
  function projectionReady(game: GameType): boolean {
    return (
      ready !== undefined &&
      ready.history === game.monthlyHistory &&
      ready.key === signature(game)
    );
  }

  /** The projection, now. Cheap when projectionReady; otherwise it simulates in the caller's frame. */
  function readProjection(
    game: GameType,
    now: TickPresentFutureType,
  ): ProjectionView {
    const projection = selectProjection(game, now, signature(game), scope);
    // A synchronous initial/new-run render supersedes any older worker snapshot too.
    cancelPending();
    pending = undefined;
    ready = { key: signature(game), history: game.monthlyHistory };
    return projection;
  }

  /**
   * Asks for this game's projection in the worker, then tells every subscriber. Asking again for the
   * same inputs is free, and asking for different ones cancels the older request.
   */
  function requestProjection(game: GameType, now: TickPresentFutureType): void {
    if (projectionReady(game)) return;
    const key = signature(game);
    const history = game.monthlyHistory;
    if (pending && pending.key === key && pending.history === history) return;
    cancelPending();
    pending = {
      key,
      history,
      game,
      now,
      requestId: ++nextRequestId,
      // Even snapshot cloning and worker startup stay off the rollover's paint.
      cancel: afterPaint(dispatchPending),
    };
  }

  /** Called after a requested projection lands. Returns the unsubscribe function. */
  function subscribeProjection(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        cancelPending();
        pending = undefined;
        worker?.terminate();
        worker = undefined;
        inFlight = undefined;
        workerUnavailable = false;
      }
    };
  }
  return {
    projectionReady,
    readProjection,
    requestProjection,
    subscribeProjection,
  };
}

// Every reader asks about the same game object in the same render pass, and the signature
// stringifies the location, world events and policies, so it is worked out once per game
const signatures = new WeakMap<GameType, string>();
export function signature(game: GameType): string {
  let key = signatures.get(game);
  if (key === undefined) {
    key = projectionSignature(game);
    signatures.set(game, key);
  }
  return key;
}

const deferred = {
  planning: deferProjection("planning"),
  "top-bar": deferProjection("top-bar"),
};

export function projectionReady(
  game: GameType,
  scope: ProjectionScope = "planning",
): boolean {
  return deferred[scope].projectionReady(game);
}

export function readProjection(
  game: GameType,
  now: TickPresentFutureType,
  scope: ProjectionScope = "planning",
): ProjectionView {
  return deferred[scope].readProjection(game, now);
}

export function requestProjection(
  game: GameType,
  now: TickPresentFutureType,
  scope: ProjectionScope = "planning",
): void {
  deferred[scope].requestProjection(game, now);
}

export function subscribeProjection(
  listener: () => void,
  scope: ProjectionScope = "planning",
): () => void {
  return deferred[scope].subscribeProjection(listener);
}
