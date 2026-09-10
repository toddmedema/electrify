import { returnToEvidence } from "../../helpers/EvidenceJourney";
import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import { buildFacility } from "../../reducers/Game";
import { selectFacility, snackbarOpen } from "../../reducers/UI";
import { getStore } from "../../StoreRegistry";
import { buildConsequenceMessage } from "../../helpers/BuildConsequences";
import { AppStateType, GeneratorShoppingType } from "../../Types";
import BuildGenerators, { DispatchProps, StateProps } from "./BuildGenerators";
import { focusEvidence } from "../../helpers/Evidence";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    evidenceRequest: state.ui.evidenceRequest,
    facilityDragActive: state.ui.facilityDragActive,
    game: state.game,
    hasEvidenceReturn: !!state.ui.evidenceJourney,
    focusFuel:
      state.card.storyTarget?.card === "FACILITIES"
        ? state.card.storyTarget.fuel
        : undefined,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onEvidenceReady: (request, element) => {
      dispatch(focusEvidence(request, element));
    },
    onEvidenceReturn: () => {
      dispatch(returnToEvidence());
    },
    onBack: () => {
      dispatch(navigate("FACILITIES"));
    },
    onBuildGenerator: (facility: GeneratorShoppingType, financed: boolean) => {
      const beforeIds = new Set(
        getStore()
          .getState()
          .game.facilities.map((candidate) => candidate.id),
      );
      dispatch(buildFacility({ facility, financed }));
      const built = getStore()
        .getState()
        .game.facilities.find((candidate) => !beforeIds.has(candidate.id));
      if (built) {
        dispatch(selectFacility(built.id));
        dispatch(
          snackbarOpen({
            message: buildConsequenceMessage(facility, financed),
            open: true,
            timeout: 8000,
            actionLabel: "Events",
            action: () => dispatch(navigate("EVENTS")),
          }),
        );
      }
    },
  };
};

const BuildGeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(BuildGenerators);

export default BuildGeneratorsContainer;
