import {
  cacheProjection,
  ProjectionView,
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

/**
 * Takes the game's long-range projection off the frame that invalidates it.
 *
 * selectProjection is memoized on projectionSignature, which changes on every month rollover
 * (and on rate, fleet and policy decisions). Its first caller after a change pays for a
 * twenty-year simulation in render, and at a rollover that is the same frame as the reducer's
 * own month-end work. Both on-screen readers, Insights and the top bar's runway warning, go
 * through this module instead. When the projection is stale they keep drawing the previous one
 * and ask for the new one here. It is computed in a persistent worker for every reader, and they all
 * re-render in a single commit when it lands.
 *
 * The worker calls selectProjection with the game and tick from the render that first saw
 * the new signature, which is what the synchronous call would have used. Once it lands, every
 * reader's own selectProjection call is a cache hit with the same result as before.
 */

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

function publish(game: GameType, projection: ProjectionView): void {
  cacheProjection(game, projection);
  ready = { key: signature(game), history: game.monthlyHistory };
  pending = undefined;
  listeners.forEach((listener) => listener());
}

function fallback(): void {
  worker?.terminate();
  worker = undefined;
  inFlight = undefined;
  workerUnavailable = true;
  if (!pending) return;
  const request = pending;
  request.cancel = afterPaint(() => {
    if (pending === request) {
      publish(request.game, selectProjection(request.game, request.now));
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
          projection?: ProjectionView;
          error?: boolean;
        }>,
      ) => {
        if (event.data.requestId !== inFlight) return;
        inFlight = undefined;
        if (pending?.requestId === event.data.requestId) {
          if (event.data.error || !event.data.projection) {
            fallback();
            return;
          }
          publish(pending.game, event.data.projection);
        }
        // Only the newest edit is queued; old replies never replace current forecasts.
        dispatchPending();
      };
      worker.onerror = fallback;
      worker.onmessageerror = fallback;
    }
    inFlight = pending.requestId;
    worker.postMessage({
      requestId: pending.requestId,
      game: pending.game,
      now: pending.now,
    });
  } catch (_error) {
    fallback();
  }
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

/** Whether selectProjection already holds this game's projection, so reading it is cheap. */
export function projectionReady(game: GameType): boolean {
  return (
    ready !== undefined &&
    ready.history === game.monthlyHistory &&
    ready.key === signature(game)
  );
}

/** The projection, now. Cheap when projectionReady; otherwise it simulates in the caller's frame. */
export function readProjection(
  game: GameType,
  now: TickPresentFutureType,
): ProjectionView {
  const projection = selectProjection(game, now);
  // A synchronous initial/new-run render supersedes any older worker snapshot too.
  pending?.cancel();
  pending = undefined;
  ready = { key: signature(game), history: game.monthlyHistory };
  return projection;
}

/**
 * Asks for this game's projection in the worker, then tells every subscriber. Asking again for the
 * same inputs is free, and asking for different ones cancels the older request.
 */
export function requestProjection(
  game: GameType,
  now: TickPresentFutureType,
): void {
  if (projectionReady(game)) return;
  const key = signature(game);
  const history = game.monthlyHistory;
  if (pending && pending.key === key && pending.history === history) return;
  pending?.cancel();
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
export function subscribeProjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      pending?.cancel();
      pending = undefined;
      worker?.terminate();
      worker = undefined;
      inFlight = undefined;
      workerUnavailable = false;
    }
  };
}
