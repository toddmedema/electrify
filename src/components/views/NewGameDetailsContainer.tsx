import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { start, delta, quit, startReplay } from "../../reducers/Game";
import { getHistoryApi } from "../../Globals";
import { scenarioListUrl } from "../../ScenarioUrl";
import { store } from "../../Store";
import { delta as uiDelta, snackbarOpen } from "../../reducers/UI";
import { startWithSaveGuard } from "./StartGame";
import { AppStateType, GameType, ReplayType } from "../../Types";
import NewGameDetails, { DispatchProps, StateProps } from "./NewGameDetails";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: {
      ...state.game,
      scenarioId: state.ui.scenarioPreview ?? state.game.scenarioId,
      difficulty: state.ui.previewDifficulty ?? state.game.difficulty,
    },
    uid: state.user.uid,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      // Consuming the details entry keeps the address bar and Redux's popstate navigation in
      // lockstep. Direct links are bootstrapped with a catalog entry immediately behind them.
      getHistoryApi().back();
    },
    onDelta: (d: Partial<GameType>) => {
      dispatch(uiDelta({ previewDifficulty: d.difficulty }));
    },
    onStart: (scenarioId: number) => {
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
    // Watching a replay simulates a whole game, but never writes one, so unlike onStart it has
    // no autosave to clobber and needs no confirmation
    onWatchReplay: (replay: ReplayType) => {
      getHistoryApi().replaceState(null, "", scenarioListUrl());
      dispatch(startReplay(replay));
    },
    onReplayError: (message: string) => {
      dispatch(snackbarOpen(message));
    },
  };
};

const NewGameDetailsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(NewGameDetails);

export default NewGameDetailsContainer;
