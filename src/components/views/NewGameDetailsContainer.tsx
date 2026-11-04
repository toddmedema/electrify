import { useUnlockedDifficulty } from "../../achievements/useAchievements";
import { achievementJournal } from "../../achievements/Journal";
import {
  playableDifficulty,
  unlockedDifficulty,
} from "../../achievements/DifficultyUnlocks";
import type { DifficultyType } from "../../Types";
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

const difficultyAllowed = (difficulty: DifficultyType) =>
  playableDifficulty(
    difficulty,
    unlockedDifficulty(achievementJournal.getSnapshot().progress),
  ) === difficulty;
const selectedDifficulty = () =>
  playableDifficulty(
    store.getState().ui.previewDifficulty ?? store.getState().game.difficulty,
    unlockedDifficulty(achievementJournal.getSnapshot().progress),
  );

// Co-op guests follow the host's selection.
const coopRole = () => store.getState().ui.coop?.role;

// An explicit second parameter lets connect observe synced unlock changes.
export const mapStateToProps = (
  state: AppStateType,
  ownProps?: { unlockedThrough: DifficultyType },
): StateProps => {
  const unlockedThrough =
    ownProps?.unlockedThrough ??
    unlockedDifficulty(achievementJournal.getSnapshot().progress);
  return {
    game: {
      ...state.game,
      scenarioId: state.ui.scenarioPreview ?? state.game.scenarioId,
      difficulty:
        state.ui.coop?.role === "guest"
          ? (state.ui.previewDifficulty ?? state.game.difficulty)
          : playableDifficulty(
              state.ui.previewDifficulty ?? state.game.difficulty,
              unlockedThrough,
            ),
    },
    uid: state.user.uid,
    coop: state.ui.coop,
    unlockedThrough,
  };
};

export const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
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
      if (d.difficulty && !difficultyAllowed(d.difficulty)) return;
      dispatch(uiDelta({ previewDifficulty: d.difficulty }));
    },
    onStart: (scenarioId: number) => {
      const role = coopRole();
      if (role) {
        if (role === "host")
          coopControls()?.start({
            scenarioId,
            difficulty: selectedDifficulty(),
          });
        return;
      }
      startWithSaveGuard(dispatch, () => {
        getHistoryApi().replaceState(null, "", scenarioListUrl());
        const difficulty = selectedDifficulty();
        dispatch(quit());
        dispatch(delta({ difficulty }));
        dispatch(start(scenarioId));
      });
    },
  };
};

const ConnectedNewGameDetails = connect(
  mapStateToProps,
  mapDispatchToProps,
)(NewGameDetails);

export default function NewGameDetailsContainer() {
  const unlockedThrough = useUnlockedDifficulty();
  return <ConnectedNewGameDetails unlockedThrough={unlockedThrough} />;
}
