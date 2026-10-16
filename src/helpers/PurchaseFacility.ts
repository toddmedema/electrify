import type { AppThunk } from "../Store";
import type { FacilityShoppingType } from "../Types";
import { buildFacility } from "../reducers/Game";
import { navigate } from "../reducers/Card";
import { facilityPurchased, snackbarOpen } from "../reducers/UI";
import { buildConsequenceMessage } from "./BuildConsequences";
import { multiplayerRuntime } from "../multiplayer/Registry";

/** Acknowledge only purchases accepted by the dispatching store. */
export const purchaseFacility =
  (facility: FacilityShoppingType, financed: boolean): AppThunk =>
  (dispatch, getState) => {
    const beforeIds = new Set(
      getState().game.facilities.map((candidate) => candidate.id),
    );
    const acknowledge = () => {
      const built = getState().game.facilities.find(
        (candidate) => !beforeIds.has(candidate.id),
      );
      if (!built) return;
      dispatch(facilityPurchased(built.id));
      dispatch(
        snackbarOpen({
          message: buildConsequenceMessage(facility, financed),
          open: true,
          timeout: 8000,
          actionLabel: "Events",
          action: () => dispatch(navigate("EVENTS")),
        }),
      );
    };
    const multiplayer = multiplayerRuntime();
    if (multiplayer && getState().game.multiplayer) {
      void multiplayer
        .submit({
          kind: "action",
          name: "buildFacility",
          payload: { facility, financed },
        })
        .then(acknowledge)
        .catch(() => undefined);
    } else {
      dispatch(buildFacility({ facility, financed }));
      acknowledge();
    }
  };
