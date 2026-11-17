import type { AppThunk } from "../Store";
import type {
  FacilityShoppingType,
  TerritoryId,
  TerritoryTileId,
} from "../Types";
import { buildFacility } from "../reducers/Game";
import { navigate } from "../reducers/Card";
import { facilityPurchased, snackbarOpen } from "../reducers/UI";
import { buildConsequenceMessage } from "./BuildConsequences";
import { waitForPurchase } from "./WaitForPurchase";
import { multiplayerRuntime } from "../multiplayer/Registry";

export type FacilityPurchaseResult =
  | { status: "accepted"; facilityId: number }
  | { status: "rejected"; message: string };

/** Acknowledge only purchases accepted by the dispatching store. */
export const purchaseFacility =
  (
    facility: FacilityShoppingType,
    financed: boolean,
    territoryId?: TerritoryId,
    tileId?: TerritoryTileId,
  ): AppThunk<Promise<FacilityPurchaseResult>> =>
  async (dispatch, getState) => {
    const initial = getState();
    const sameRun = () =>
      getState().ui?.evidenceRunId === initial.ui?.evidenceRunId &&
      getState().game.seed === initial.game.seed &&
      getState().game.scenarioId === initial.game.scenarioId;
    const beforeIds = new Set(
      getState().game.facilities.map((candidate) => candidate.id),
    );
    const findBuilt = () =>
      getState().game.facilities.find(
        (candidate) =>
          !beforeIds.has(candidate.id) &&
          candidate.name === facility.name &&
          candidate.peakW === facility.peakW &&
          candidate.peakWh === facility.peakWh &&
          candidate.gasCycle === facility.gasCycle &&
          JSON.stringify(candidate.resilience ?? {}) ===
            JSON.stringify(facility.resilience ?? {}) &&
          (tileId === undefined || candidate.tileId === tileId) &&
          (territoryId === undefined || candidate.territoryId === territoryId),
      );
    const acknowledge = (built: NonNullable<ReturnType<typeof findBuilt>>) => {
      dispatch(facilityPurchased(built.id));
      dispatch(
        snackbarOpen({
          message: buildConsequenceMessage(facility),
          open: true,
          timeout: 8000,
          actionLabel: "Events",
          action: () => dispatch(navigate("EVENTS")),
        }),
      );
    };
    try {
      const multiplayer = multiplayerRuntime();
      const payload = {
        facility,
        financed,
        territoryId,
        ...(tileId !== undefined ? { tileId } : {}),
      };
      if (multiplayer && getState().game.multiplayer) {
        await multiplayer.submit({
          kind: "action",
          name: "buildFacility",
          payload,
        });
      } else dispatch(buildFacility(payload));
      if (!sameRun())
        return {
          status: "rejected",
          message: "The run changed before construction was confirmed.",
        };
      const built =
        multiplayer && getState().game.multiplayer
          ? await waitForPurchase(getState, findBuilt)
          : findBuilt();
      if (!built || !sameRun())
        return {
          status: "rejected",
          message:
            "Construction did not start. Review this project and try again.",
        };
      acknowledge(built);
      return { status: "accepted", facilityId: built.id };
    } catch (cause) {
      return {
        status: "rejected",
        message:
          cause instanceof Error
            ? cause.message
            : "Construction did not start.",
      };
    }
  };
