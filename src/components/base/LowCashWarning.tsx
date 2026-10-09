import * as React from "react";
import { shallowEqual } from "react-redux";
import { AppThunk, useAppDispatch, useAppSelector } from "../../Store";
import { currentTick } from "../../helpers/GameSelectors";
import {
  LOW_CASH_THRESHOLD,
  lowCashRateQuote,
} from "../../helpers/LowCashRate";
import { pendingScenarioChoice } from "../../helpers/ScenarioChoices";
import { delta } from "../../reducers/Game";
import { dialogClose, dialogOpen } from "../../reducers/UI";

/** Checks again inside the thunk so StrictMode cannot offer the same month twice. */
export const offerLowCashWarning = (): AppThunk => (dispatch, getState) => {
  const { game, ui, user, card } = getState();
  const cash = currentTick(game)?.cash;
  if (
    !game.inGame ||
    game.replayPlayback ||
    cash === undefined ||
    cash >= LOW_CASH_THRESHOLD ||
    game.lowCashWarningMonth === game.date.monthsElapsed ||
    !["FACILITIES", "INSIGHTS", "EVENTS"].includes(card.name) ||
    ui.dialog.open ||
    ui.victory ||
    ui.manualHelpEntry ||
    ui.dataCenterGuideRequested ||
    user.needsDisplayName ||
    pendingScenarioChoice(game)
  )
    return;

  const quote = lowCashRateQuote(game);
  const rate = quote.dollarsPerkWh;
  const increase =
    rate !== null && game.dollarsPerkWh > 0
      ? `${Math.round((rate / game.dollarsPerkWh - 1) * 100)}%`
      : undefined;
  const price = rate !== null ? `${(rate * 100).toFixed(2)}c/kWh` : "";
  const message =
    rate === null
      ? quote.projectedCash >= 0
        ? "Your current rates are projected to cover this month's costs. The utility board's rate cap prevents a further increase."
        : `Rates alone cannot prevent bankruptcy this month.${quote.capped ? " Even the utility board's maximum rate is too low to cover your costs." : " There is not enough electricity revenue to cover your costs."}`
      : quote.projectedCash < 0
        ? `You must raise your rates to ${price}${increase ? ` (a ${increase} increase)` : ""} to avoid bankruptcy this month.`
        : `Raise your rates to ${price}${increase ? ` (a ${increase} increase)` : ""} to build your cash buffer this month. Your current rates are projected to cover this month's costs.`;
  dispatch(delta({ lowCashWarningMonth: game.date.monthsElapsed }));
  dispatch(
    dialogOpen({
      open: true,
      title: "You're about to run out of cash - raise your rates?",
      message,
      notCancellable: true,
      actionLabel: rate !== null ? "Raise rates" : undefined,
      action:
        rate !== null
          ? () => {
              dispatch(delta({ dollarsPerkWh: rate }));
              dispatch(dialogClose());
            }
          : undefined,
      secondaryLabel: "Go bankrupt",
      secondaryAction: () => dispatch(dialogClose()),
    }),
  );
};

export default function LowCashWarning() {
  const dispatch = useAppDispatch();
  const state = useAppSelector(
    ({ game, ui, user, card }) => ({ game, ui, user, card }),
    shallowEqual,
  );
  React.useEffect(() => {
    if (!document.querySelector('[role="dialog"]'))
      dispatch(offerLowCashWarning());
  }, [dispatch, state]);
  return null;
}
