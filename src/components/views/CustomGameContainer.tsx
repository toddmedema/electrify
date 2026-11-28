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
import type { AppStateType, GameType, ScenarioType } from "../../Types";
import CoopBrowseBar from "../base/CoopBrowseBar";
import ScreenPage from "../base/ScreenPage";
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

type SetupProps = Omit<StateProps, "scenario"> & { scenario?: ScenarioType };

const DEFAULT_CUSTOM_SETUP: ScenarioType = {
  ...DEFAULT_CUSTOM_SCENARIO,
  startingFleetSource: "regional",
};

// An explicit second parameter lets connect observe synced unlock changes.
export const mapStateToProps = (
  state: AppStateType,
  ownProps?: { unlockedThrough: DifficultyType },
): SetupProps => {
  const coop = state.ui.coop;
  const unlockedThrough = unlockedForPlay(
    ownProps?.unlockedThrough ??
      unlockedDifficulty(achievementJournal.getSnapshot().progress),
    !!coop,
  );
  const game = {
    ...state.game,
    difficulty: playableDifficulty(
      state.ui.previewDifficulty ?? state.game.difficulty,
      unlockedThrough,
    ),
  };
  // The host can withdraw the setup while sizing a replacement fleet.
  if (coop?.role === "guest")
    return { coop, game, unlockedThrough, scenario: coop.custom };

  // Start from the player's last custom setup. Mod rules belong to their original scenario.
  const current = state.game.customScenario?.mod
    ? undefined
    : state.game.customScenario;
  return {
    coop,
    game,
    unlockedThrough,
    scenario: current ?? getCustomScenario(DEFAULT_CUSTOM_SETUP),
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

function CustomGameView({ scenario, ...props }: SetupProps & DispatchProps) {
  if (scenario) return <CustomGame {...props} scenario={scenario} />;
  return (
    <ScreenPage id="listCard" title="Custom setup" onBack={props.onBack}>
      <CoopBrowseBar coop={props.coop} offerSaves />
      <div className="scrollable">
        <p className="customSetupActions" role="status">
          Receiving scenario…
        </p>
      </div>
    </ScreenPage>
  );
}

const ConnectedCustomGame = connect(
  mapStateToProps,
  mapDispatchToProps,
)(CustomGameView);

export default function CustomGameContainer() {
  const unlockedThrough = useUnlockedDifficulty();
  return <ConnectedCustomGame unlockedThrough={unlockedThrough} />;
}
