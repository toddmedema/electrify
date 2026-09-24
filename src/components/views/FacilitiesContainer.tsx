import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import {
  sellFacility,
  setSpeed,
  togglePauseFacility,
  reprioritizeFacility,
  retrofitFacility,
  cancelRetrofit,
  buildTransmissionLine,
  upgradeTransmissionLine,
  setTradingPolicy,
} from "../../reducers/Game";
import {
  selectFacility,
  acknowledgeFacilityArrival,
  setFacilityDragActive,
  snackbarOpen,
} from "../../reducers/UI";
import { AppStateType } from "../../Types";
import Facilities, { DispatchProps, StateProps } from "./Facilities";
import { TRANSMISSION_CORRIDORS } from "../../data/AdjacentMarkets";
import { focusEvidence } from "../../helpers/Evidence";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    evidenceRequest: state.ui.evidenceRequest,
    facilityDragActive: state.ui.facilityDragActive,
    game: state.game,
    selectedFacilityId: state.ui.selectedFacilityId,
    arrivingFacilityId: state.ui.arrivingFacilityId,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onArrivalShown: (id) => dispatch(acknowledgeFacilityArrival(id)),
    onEvidenceReady: (request, element) => {
      dispatch(focusEvidence(request, element));
    },
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
    onRetrofit: (payload) => {
      dispatch(retrofitFacility(payload));
    },
    onCancelRetrofit: (id) => {
      dispatch(cancelRetrofit(id));
    },
    onFacilityDragStart: (speed) => {
      dispatch(setFacilityDragActive(true));
      if (speed !== "PAUSED") {
        dispatch(setSpeed("PAUSED"));
      }
    },
    onFacilityDragEnd: (sourceIndex, destinationIndex, resumeSpeed) => {
      dispatch(setFacilityDragActive(false));
      if (destinationIndex !== null) {
        dispatch(
          reprioritizeFacility({
            spotInList: sourceIndex,
            delta: destinationIndex - sourceIndex,
          }),
        );
      }
      if (resumeSpeed !== "PAUSED") {
        dispatch(setSpeed(resumeSpeed));
      }
    },
    onSelect: (id) => {
      dispatch(selectFacility(id));
    },
    onStorageBuild: () => {
      dispatch(navigate({ name: "BUILD_STORAGE", dontRemember: true }));
    },
    onTransmissionBuild: (corridorId, financed) => {
      dispatch(buildTransmissionLine({ corridorId, financed }));
      const corridor = TRANSMISSION_CORRIDORS.find(
        ({ id }) => id === corridorId,
      );
      if (corridor) {
        dispatch(
          snackbarOpen(
            `Intertie approved — power can flow in ${corridor.yearsToBuild} year${corridor.yearsToBuild === 1 ? "" : "s"}.`,
          ),
        );
      }
    },
    onTransmissionUpgrade: (corridorId, financed) => {
      dispatch(upgradeTransmissionLine({ corridorId, financed }));
      dispatch(
        snackbarOpen(
          "Upgrade approved. The line stays operational during construction.",
        ),
      );
    },
    onTradingPolicy: (policy) => {
      dispatch(setTradingPolicy(policy));
    },
  };
};

const FacilitiesContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Facilities);

export default FacilitiesContainer;
