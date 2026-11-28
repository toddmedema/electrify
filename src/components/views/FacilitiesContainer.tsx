import type { AppDispatch } from "../../Store";
import { acquireUtility } from "../../reducers/GameActions";
import { connectToStore } from "../base/ConnectToStore";
import { navigate } from "../../reducers/Card";
import {
  INTERTIE_UPGRADE_APPROVED,
  intertieApprovedMessage,
} from "../../helpers/BuildConsequences";
import {
  sellFacility,
  setSpeed,
  togglePauseFacility,
  reprioritizeFacility,
  reprioritizePowerAgreement,
  reprioritizeTransmissionLine,
  retrofitFacility,
  cancelRetrofit,
  buildTransmissionLine,
  upgradeTransmissionLine,
  cancelTransmissionLine,
  togglePauseTransmissionLine,
  setBuyingRule,
  setSellingRule,
} from "../../reducers/Game";
import {
  selectFacility,
  acknowledgeFacilityArrival,
  setFacilityDragActive,
  snackbarOpen,
} from "../../reducers/UI";
import { AppStateType, GameType } from "../../Types";
import Facilities, { DispatchProps, StateProps } from "./Facilities";
import { TRANSMISSION_CORRIDORS } from "../../data/AdjacentMarkets";
import { focusEvidence } from "../../helpers/Evidence";
import { multiplayerRuntime } from "../../multiplayer/Registry";
import {
  requestFacilityExpansion,
  requestCancelFacilityExpansion,
} from "../../helpers/RequestFacilityExpansion";

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
  const finishDrag = (
    resumeSpeed: GameType["speed"],
    action?: ReturnType<
      | typeof reprioritizeFacility
      | typeof reprioritizeTransmissionLine
      | typeof reprioritizePowerAgreement
    >,
  ) => {
    dispatch(setFacilityDragActive(false));
    if (action) dispatch(action);
    if (resumeSpeed !== "PAUSED" && !multiplayerRuntime())
      dispatch(setSpeed(resumeSpeed));
  };
  return {
    onArrivalShown: (id) => dispatch(acknowledgeFacilityArrival(id)),
    onEvidenceReady: (request, element) => {
      dispatch(focusEvidence(request, element));
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
    onExpand: (payload) => dispatch(requestFacilityExpansion(payload)),
    onCancelExpansion: (id, quoteKey) =>
      dispatch(requestCancelFacilityExpansion(id, quoteKey)),
    onRetrofit: (payload) => {
      dispatch(retrofitFacility(payload));
    },
    onCancelRetrofit: (id) => {
      dispatch(cancelRetrofit(id));
    },
    onFacilityDragStart: (speed) => {
      dispatch(setFacilityDragActive(true));
      if (speed !== "PAUSED" && !multiplayerRuntime()) {
        dispatch(setSpeed("PAUSED"));
      }
    },
    onFacilityDragEnd: (
      sourceIndex,
      destinationIndex,
      resumeSpeed,
      intertie,
    ) => {
      finishDrag(
        resumeSpeed,
        destinationIndex === null
          ? undefined
          : (intertie ? reprioritizeTransmissionLine : reprioritizeFacility)({
              spotInList: sourceIndex,
              delta: destinationIndex - sourceIndex,
            }),
      );
    },
    onAgreementDragEnd: (move, resumeSpeed) => {
      finishDrag(
        resumeSpeed,
        move ? reprioritizePowerAgreement(move) : undefined,
      );
    },
    onSelect: (id) => {
      dispatch(selectFacility(id));
    },
    onStorageBuild: () => {
      dispatch(navigate({ name: "BUILD_STORAGE", dontRemember: true }));
    },
    onTransmissionBuild: (corridorId, financed, tier) => {
      dispatch(buildTransmissionLine({ corridorId, financed, tier }));
      const corridor = TRANSMISSION_CORRIDORS.find(
        ({ id }) => id === corridorId,
      );
      if (corridor) {
        dispatch(snackbarOpen(intertieApprovedMessage(corridor.yearsToBuild)));
      }
    },
    onTransmissionCancel: (id) => {
      dispatch(cancelTransmissionLine(id));
    },
    onTransmissionPause: (id, name, paused) => {
      dispatch(togglePauseTransmissionLine(id));
      if (!paused)
        dispatch(
          snackbarOpen({
            message: `Paused ${name}`,
            actionLabel: "Undo",
            action: () => dispatch(togglePauseTransmissionLine(id)),
            open: true,
            timeout: 6000,
          }),
        );
    },
    onUtilityAcquire: async (payload) => {
      const multiplayer = multiplayerRuntime();
      if (multiplayer) {
        await multiplayer.submit({
          kind: "action",
          name: "acquireUtility",
          payload,
        });
        return true;
      }
      return dispatch((dispatch, getState) => {
        const before = getState().game;
        dispatch(acquireUtility(payload));
        return getState().game !== before;
      });
    },
    onTransmissionUpgrade: (corridorId, financed) => {
      dispatch(upgradeTransmissionLine({ corridorId, financed }));
      dispatch(snackbarOpen(INTERTIE_UPGRADE_APPROVED));
    },
    onBuyingRule: (rule) => {
      dispatch(setBuyingRule(rule));
    },
    onSellingRule: (rule) => {
      dispatch(setSellingRule(rule));
    },
  };
};

const FacilitiesContainer = connectToStore(
  mapStateToProps,
  mapDispatchToProps,
)(Facilities);

export default FacilitiesContainer;
