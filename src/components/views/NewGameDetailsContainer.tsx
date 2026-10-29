import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { start, delta, quit } from "../../reducers/Game";
import { getHistoryApi } from "../../Globals";
import { scenarioListUrl } from "../../ScenarioUrl";
import { store } from "../../Store";
import { delta as uiDelta } from "../../reducers/UI";
import { startWithSaveGuard } from "./StartGame";
import { AppStateType, GameType } from "../../Types";
import NewGameDetails, { DispatchProps, StateProps } from "./NewGameDetails";
import { coopControls } from "../../multiplayer/Registry";

// A co-op guest follows the host's screens; its own controls don't change the selection.
const coopRole = () => store.getState().ui.coop?.role;

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: {
      ...state.game,
      scenarioId: state.ui.scenarioPreview ?? state.game.scenarioId,
      difficulty: state.ui.previewDifficulty ?? state.game.difficulty,
    },
    uid: state.user.uid,
    coop: state.ui.coop,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      if (coopRole() === "guest") {
        coopControls()?.back();
        return;
      }
      // Consuming the details entry keeps the address bar and Redux's popstate navigation in
      // lockstep. Direct links are bootstrapped with a catalog entry immediately behind them.
      getHistoryApi().back();
    },
    onDelta: (d: Partial<GameType>) => {
      if (coopRole() === "guest") return;
      dispatch(uiDelta({ previewDifficulty: d.difficulty }));
    },
    onStart: (scenarioId: number) => {
      const role = coopRole();
      if (role) {
        if (role === "host")
          coopControls()?.start({
            scenarioId,
            difficulty:
              store.getState().ui.previewDifficulty ??
              store.getState().game.difficulty,
          });
        return;
      }
      startWithSaveGuard(dispatch, () => {
        getHistoryApi().replaceState(null, "", scenarioListUrl());
        const difficulty =
          store.getState().ui.previewDifficulty ??
          store.getState().game.difficulty;
        dispatch(quit());
        dispatch(delta({ difficulty }));
        dispatch(start(scenarioId));
      });
    },
  };
};

const NewGameDetailsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(NewGameDetails);

export default NewGameDetailsContainer;
