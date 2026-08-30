import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import { buildFacility } from "../../reducers/Game";
import { selectFacility, snackbarOpen } from "../../reducers/UI";
import { getStore } from "../../StoreRegistry";
import { buildConsequenceMessage } from "../../helpers/BuildConsequences";
import { AppStateType, StorageShoppingType } from "../../Types";
import BuildStorage, { DispatchProps, StateProps } from "./BuildStorage";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigate("FACILITIES"));
    },
    onBuildStorage: (facility: StorageShoppingType, financed: boolean) => {
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

const BuildStorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(BuildStorage);

export default BuildStorageContainer;
