import {
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

/**
 * Takes the game's long-range projection off the frame that invalidates it.
 *
 * selectProjection is memoized on projectionSignature, which changes on every month rollover
 * (and on rate, fleet and policy decisions). Its first caller after a change pays for a
 * twenty-year simulation in render, and at a rollover that is the same frame as the reducer's
 * own month-end work. Both on-screen readers, Insights and the top bar's runway warning, go
 * through this module instead. When the projection is stale they keep drawing the previous one
 * and ask for the new one here. It is computed once after paint for every reader, and they all
 * re-render in a single commit when it lands.
 *
 * The deferred call is selectProjection with the game and tick from the render that first saw
 * the new signature, which is what the synchronous call would have used. Once it lands, every
 * reader's own selectProjection call is a cache hit with the same result as before.
 */

let ready: { key: string; history: MonthlyHistoryType[] } | undefined;
let pending:
  | { key: string; history: MonthlyHistoryType[]; cancel: () => void }
  | undefined;
const listeners = new Set<() => void>();

// Every reader asks about the same game object in the same render pass, and the signature
// stringifies the location, world events and policies, so it is worked out once per game
const signatures = new WeakMap<GameType, string>();
function signature(game: GameType): string {
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
  ready = { key: signature(game), history: game.monthlyHistory };
  return projection;
}

/**
 * Asks for this game's projection after paint, then tells every subscriber. Asking again for the
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
    cancel: afterPaint(() => {
      pending = undefined;
      readProjection(game, now);
      // One task, so React batches every reader's update into one commit
      listeners.forEach((listener) => listener());
    }),
  };
}

/** Called after a requested projection lands. Returns the unsubscribe function. */
export function subscribeProjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && pending) {
      pending.cancel();
      pending = undefined;
    }
  };
}
