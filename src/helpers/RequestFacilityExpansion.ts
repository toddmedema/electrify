import type { AppThunk } from "../Store";
import type { ExpandFacilityAction } from "../Types";
import {
  expandFacility,
  cancelFacilityExpansion,
} from "../reducers/GameActions";
import { facilityExpansionQuote } from "./FacilityExpansion";
import { currentCash } from "./GameSelectors";
import { waitForPurchase } from "./WaitForPurchase";
import { multiplayerRuntime } from "../multiplayer/Registry";

export type FacilityExpansionRequestResult =
  { status: "accepted" } | { status: "rejected"; message: string };

export type FacilityExpansionCancellationResult =
  | { status: "accepted"; refund: number }
  | { status: "completed"; message: string }
  | { status: "rejected"; message: string };

/** A receipt alone is insufficient: the exact reviewed project must arrive in this run. */
export const requestFacilityExpansion =
  (
    payload: ExpandFacilityAction,
  ): AppThunk<Promise<FacilityExpansionRequestResult>> =>
  async (dispatch, getState) => {
    const initial = getState();
    const quote = facilityExpansionQuote(
      initial.game,
      payload.facilityId,
      payload.targetSize,
    );
    if (quote.status !== "ready")
      return { status: "rejected", message: quote.reason };
    if (quote.quoteKey !== payload.quoteKey)
      return {
        status: "rejected",
        message: "The quote changed. Review the updated project and try again.",
      };
    if (currentCash(initial.game) < quote.cost)
      return {
        status: "rejected",
        message: "More cash is needed for this upgrade.",
      };
    const sameRun = () =>
      getState().ui?.evidenceRunId === initial.ui?.evidenceRunId &&
      getState().game.seed === initial.game.seed &&
      getState().game.scenarioId === initial.game.scenarioId;
    const findStarted = () => {
      if (!sameRun()) return undefined;
      const pending = getState().game.facilities.find(
        ({ id }) => id === payload.facilityId,
      )?.expansionInProgress;
      return pending?.quoteKey === payload.quoteKey &&
        pending.targetSize === payload.targetSize
        ? pending
        : undefined;
    };
    try {
      const runtime = multiplayerRuntime();
      if (initial.game.multiplayer) {
        if (!runtime)
          return {
            status: "rejected",
            message: "Reconnect to co-op before starting this upgrade.",
          };
        await runtime.submit({
          kind: "action",
          name: "expandFacility",
          payload,
        });
      } else dispatch(expandFacility(payload));
      if (!sameRun())
        return {
          status: "rejected",
          message: "The run changed before the upgrade was confirmed.",
        };
      const pending = initial.game.multiplayer
        ? await waitForPurchase(getState, findStarted)
        : findStarted();
      if (!pending || !sameRun())
        return {
          status: "rejected",
          message:
            "The upgrade did not start. Review the project and try again.",
        };
      return { status: "accepted" };
    } catch (cause) {
      if (findStarted()) return { status: "accepted" };
      return {
        status: "rejected",
        message:
          cause instanceof Error ? cause.message : "The upgrade did not start.",
      };
    }
  };

/** Distinguish a refund from construction completing while the host processes the request. */
export const requestCancelFacilityExpansion =
  (
    facilityId: number,
    expectedQuoteKey?: string,
  ): AppThunk<Promise<FacilityExpansionCancellationResult>> =>
  async (dispatch, getState) => {
    const initial = getState();
    const before = initial.game.facilities.find(({ id }) => id === facilityId);
    const expansion = before?.expansionInProgress;
    if (!before || !expansion)
      return {
        status: "rejected",
        message:
          "There is no capacity upgrade to cancel. Review the plant's capacity.",
      };
    if (
      expectedQuoteKey !== undefined &&
      expectedQuoteKey !== expansion.quoteKey
    )
      return {
        status: "rejected",
        message:
          "The capacity upgrade changed. Review the current project before canceling.",
      };
    const sameRun = () =>
      getState().ui?.evidenceRunId === initial.ui?.evidenceRunId &&
      getState().game.seed === initial.game.seed &&
      getState().game.scenarioId === initial.game.scenarioId;
    const findOutcome = (): FacilityExpansionCancellationResult | undefined => {
      if (!sameRun()) return undefined;
      const facility = getState().game.facilities.find(
        ({ id }) => id === facilityId,
      );
      if (!facility || facility.expansionInProgress) return undefined;
      const size = facility.peakWh ?? facility.peakW;
      if (size >= expansion.targetSize)
        return {
          status: "completed",
          message:
            "The upgrade already completed. The added capacity is available; no refund was issued.",
        };
      return size === (before.peakWh ?? before.peakW)
        ? { status: "accepted", refund: expansion.cost }
        : undefined;
    };
    try {
      const runtime = multiplayerRuntime();
      if (initial.game.multiplayer) {
        if (!runtime)
          return {
            status: "rejected",
            message: "Reconnect to co-op before canceling this upgrade.",
          };
        await runtime.submit({
          kind: "action",
          name: "cancelFacilityExpansion",
          payload: facilityId,
        });
      } else dispatch(cancelFacilityExpansion(facilityId));
      if (!sameRun())
        return {
          status: "rejected",
          message: "The run changed before cancellation was confirmed.",
        };
      const outcome = initial.game.multiplayer
        ? await waitForPurchase(getState, findOutcome)
        : findOutcome();
      return outcome && sameRun()
        ? outcome
        : {
            status: "rejected",
            message:
              "Cancellation was not confirmed. Review the project and try again.",
          };
    } catch (cause) {
      return (
        findOutcome() ?? {
          status: "rejected",
          message:
            cause instanceof Error
              ? cause.message
              : "Cancellation was not confirmed.",
        }
      );
    }
  };
