import { useUnlockedDifficulty } from "../../achievements/useAchievements";
import { achievementJournal } from "../../achievements/Journal";
import {
  playableDifficulty,
  unlockedDifficulty,
  unlockedForPlay,
} from "../../achievements/DifficultyUnlocks";
import type { DifficultyType } from "../../Types";
import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
} from "../../data/Scenarios";
import { getCustomScenario, recordCustomScenario } from "../../LocalStorage";
import { navigateBack } from "../../reducers/Card";
import { launchCustomScenario } from "../../reducers/Game";
import { withoutMod } from "../../helpers/ScenarioMod";
import { store } from "../../Store";
import { delta as uiDelta } from "../../reducers/UI";
import { startWithSaveGuard } from "./StartGame";
import { AppStateType, GameType, ScenarioType } from "../../Types";
import CustomGame, { DispatchProps, StateProps } from "./CustomGame";
import { coopControls } from "../../multiplayer/Registry";

// Co-op guests follow the host's selection.
const coopRole = () => store.getState().ui.coop?.role;

// A lobby can play any difficulty; only a solo run is limited to what its player has unlocked.
const unlockedNow = () =>
  unlockedForPlay(
    unlockedDifficulty(achievementJournal.getSnapshot().progress),
    !!coopRole(),
  );
const difficultyAllowed = (difficulty: DifficultyType) =>
  playableDifficulty(difficulty, unlockedNow()) === difficulty;
const selectedDifficulty = () =>
  playableDifficulty(
    store.getState().ui.previewDifficulty ?? store.getState().game.difficulty,
    unlockedNow(),
  );

// An explicit second parameter lets connect observe synced unlock changes.
export const mapStateToProps = (
  state: AppStateType,
  ownProps?: { unlockedThrough: DifficultyType },
): StateProps => {
  const coop = state.ui.coop;
  const unlockedThrough = unlockedForPlay(
    ownProps?.unlockedThrough ??
      unlockedDifficulty(achievementJournal.getSnapshot().progress),
    !!coop,
  );
  // A co-op guest sees the host's setup rather than the one it played last.
  // A modded run is not a setup to tweak: its rules belong to the mod, so fall back to the
  // last custom setup instead.
  const current = state.game.customScenario?.mod
    ? undefined
    : state.game.customScenario;
  const scenario =
    (coop?.role === "guest" && coop.custom) ||
    current ||
    getCustomScenario(DEFAULT_CUSTOM_SCENARIO);
  return {
    coop,
    unlockedThrough,
    game: {
      ...state.game,
      difficulty: playableDifficulty(
        state.ui.previewDifficulty ?? state.game.difficulty,
        unlockedThrough,
      ),
    },
    // The game the player set up last time, so tweaking one setting and starting again doesn't mean
    // re-entering all of them
    scenario,
  };
};

export const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      const role = coopRole();
      // Online play confirms leaving the lobby. Local co-op returns to join.
      if (role) {
        coopControls()?.back();
        return;
      }
      dispatch(navigateBack());
    },
    onDelta: (d: Partial<GameType>) => {
      if (coopRole() === "guest") return;
      if (d.difficulty && !difficultyAllowed(d.difficulty)) return;
      dispatch(uiDelta({ previewDifficulty: d.difficulty }));
    },
    onScenarioChange: (custom) => {
      const coop = store.getState().ui.coop;
      if (coop?.role === "host")
        dispatch(uiDelta({ coop: { ...coop, custom } }));
    },
    onStart: (setup: ScenarioType) => {
      const scenario = withoutMod(setup);
      const role = coopRole();
      if (role) {
        if (role === "host") {
          recordCustomScenario(scenario);
          coopControls()?.start({
            scenarioId: CUSTOM_SCENARIO_ID,
            difficulty: selectedDifficulty(),
            customScenario: scenario,
          });
        }
        return;
      }
      recordCustomScenario(scenario);
      startWithSaveGuard(dispatch, () => {
        const difficulty = selectedDifficulty();
        launchCustomScenario(dispatch, scenario, difficulty);
      });
    },
  };
};

const ConnectedCustomGame = connect(
  mapStateToProps,
  mapDispatchToProps,
)(CustomGame);

export default function CustomGameContainer() {
  const unlockedThrough = useUnlockedDifficulty();
  return <ConnectedCustomGame unlockedThrough={unlockedThrough} />;
}
