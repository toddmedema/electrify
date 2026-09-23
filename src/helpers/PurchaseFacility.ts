import type { AppThunk } from "../Store";
import type { FacilityShoppingType } from "../Types";
import { buildFacility } from "../reducers/Game";
import { navigate } from "../reducers/Card";
import { facilityPurchased, snackbarOpen } from "../reducers/UI";
import { buildConsequenceMessage } from "./BuildConsequences";

/** Acknowledge only purchases accepted by the dispatching store. */
export const purchaseFacility =
  (facility: FacilityShoppingType, financed: boolean): AppThunk =>
  (dispatch, getState) => {
    const beforeIds = new Set(
      getState().game.facilities.map((candidate) => candidate.id),
    );
    dispatch(buildFacility({ facility, financed }));
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
