import * as React from "react";
import { ReactReduxContext, shallowEqual } from "react-redux";
import { currentTick } from "../../helpers/GameSelectors";
import type { AppStateType, GameType } from "../../Types";
import { signature } from "./DeferredProjection";

const noSubscription = () => () => undefined;

/** Read exact cash when an action is chosen without redrawing quotes on every tick. */
export function useBuildCashReader(fallback: number): () => number {
  const context = React.useContext(ReactReduxContext);
  return () => {
    const game = context
      ? (context.store.getState() as Partial<AppStateType>).game
      : undefined;
    return game ? (currentTick(game)?.cash ?? fallback) : fallback;
  };
}

function useCashValue<T>(
  fallback: number,
  select: (cash: number) => T,
  live = true,
): T {
  const context = React.useContext(ReactReduxContext);
  const readCash = useBuildCashReader(fallback);
  const read = () => select(live ? readCash() : fallback);
  return React.useSyncExternalStore(
    live ? (context?.store.subscribe ?? noSubscription) : noSubscription,
    read,
    read,
  );
}

/** Reviews read exact live cash; closed dialogs do not subscribe. */
export function useBuildCash(fallback: number, live = true): number {
  return useCashValue(fallback, (cash) => cash, live);
}

/** Cards redraw only when cash crosses a quoted affordability threshold. */
export function useBuildAffordability(
  fallback: number,
  downpayment: number,
): boolean {
  return useCashValue(fallback, (cash) => cash >= downpayment);
}

/** Quote inputs move monthly or after decisions. Cash readers subscribe independently. */
export function sameBuildQuote<Props extends { game: GameType }>(
  previous: Props,
  next: Props,
): boolean {
  const { game: before, ...previousProps } = previous;
  const { game: after, ...nextProps } = next;
  return (
    shallowEqual(previousProps, nextProps) &&
    (before === after ||
      (after.speed !== "PAUSED" &&
        before.speed === after.speed &&
        before.inGame === after.inGame &&
        before.tutorialStep === after.tutorialStep &&
        before.interestRate === after.interestRate &&
        (before.runIdentity ?? before.location) ===
          (after.runIdentity ?? after.location) &&
        before.date.minute <= after.date.minute &&
        signature(before) === signature(after)))
  );
}
