import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { SCENARIOS } from "../../data/Scenarios";
import { navigateBack } from "../../reducers/Card";
import { start, delta } from "../../reducers/Game";
import { dialogClose, dialogOpen } from "../../reducers/UI";
import { readSave } from "../../SaveGame";
import { AppStateType, GameType } from "../../Types";
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
      // Autosave keeps one slot, so a new game replaces whatever's in it. Tutorials aren't saved,
      // which is why the other entry point into start() doesn't need this.
      const save = readSave();
      const saved = save
        ? SCENARIOS.find((s) => s.id === save.game.scenarioId)
        : undefined;
      if (!save || !saved) {
        return dispatch(start(scenarioId));
      }
      dispatch(
        dialogOpen({
          title: "Start a new game?",
          message: `Your saved game (${saved.name}, ${save.game.date.year}) will be replaced.`,
          open: true,
          closeText: "Cancel",
          actionLabel: "Start new game",
          // The dialog's action button doesn't close the dialog on its own
          action: () => {
            dispatch(dialogClose());
            dispatch(start(scenarioId));
          },
        }),
      );
    },
  };
};

const NewGameDetailsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(NewGameDetails);

export default NewGameDetailsContainer;
