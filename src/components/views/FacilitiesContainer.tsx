import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import {
  sellFacility,
  togglePauseFacility,
  reprioritizeFacility,
} from "../../reducers/Game";
import { selectFacility, snackbarOpen } from "../../reducers/UI";
import { AppStateType } from "../../Types";
import Facilities, { DispatchProps, StateProps } from "./Facilities";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    selectedFacilityId: state.ui.selectedFacilityId,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onGeneratorBuild: () => {
      dispatch(navigate({ name: "BUILD_GENERATORS", dontRemember: true }));
    },
    onSell: (id) => {
      // Ids are handed out monotonically, so a stale selection can't come back to life on a
      // later facility - but a pane still shouldn't go on reporting one that isn't there
      dispatch(selectFacility(null));
      dispatch(sellFacility(id));
    },
    onTogglePause: (id) => {
      dispatch(togglePauseFacility(id));
    },
    onPause: (id, name) => {
      dispatch(togglePauseFacility(id));
      dispatch(
        snackbarOpen({
          message: `Paused ${name}`,
          actionLabel: "Undo",
          action: () => dispatch(togglePauseFacility(id)),
          open: true,
          timeout: 6000,
        }),
      );
    },
    onReprioritize: (spotInList: number, delta: number) => {
      dispatch(reprioritizeFacility({ spotInList, delta }));
    },
    onSelect: (id) => {
      dispatch(selectFacility(id));
    },
    onStorageBuild: () => {
      dispatch(navigate({ name: "BUILD_STORAGE", dontRemember: true }));
    },
  };
};

const FacilitiesContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Facilities);

export default FacilitiesContainer;
