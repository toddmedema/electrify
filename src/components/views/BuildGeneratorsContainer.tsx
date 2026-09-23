import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import { purchaseFacility } from "../../helpers/PurchaseFacility";
import { AppStateType, GeneratorShoppingType } from "../../Types";
import BuildGenerators, { DispatchProps, StateProps } from "./BuildGenerators";
import { focusEvidence } from "../../helpers/Evidence";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    evidenceRequest: state.ui.evidenceRequest,
    facilityDragActive: state.ui.facilityDragActive,
    game: state.game,
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
    onBack: () => {
      dispatch(navigate("FACILITIES"));
    },
    onBuildGenerator: (facility: GeneratorShoppingType, financed: boolean) => {
      dispatch(purchaseFacility(facility, financed));
    },
  };
};

const BuildGeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(BuildGenerators);

export default BuildGeneratorsContainer;
