import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigateBack } from "../../reducers/Card";
import { start, delta, startReplay } from "../../reducers/Game";
import { snackbarOpen } from "../../reducers/UI";
import { startWithSaveGuard } from "./StartGame";
import { AppStateType, GameType, ReplayType } from "../../Types";
import NewGameDetails, { DispatchProps, StateProps } from "./NewGameDetails";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    uid: state.user.uid,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigateBack());
    },
    onDelta: (d: Partial<GameType>) => {
      dispatch(delta(d));
    },
    onStart: (scenarioId: number) => {
      startWithSaveGuard(dispatch, () => dispatch(start(scenarioId)));
    },
    // Watching a replay simulates a whole game, but never writes one, so unlike onStart it has
    // no autosave to clobber and needs no confirmation
    onWatchReplay: (replay: ReplayType) => {
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
