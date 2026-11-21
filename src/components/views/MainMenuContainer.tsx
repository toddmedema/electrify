import { unlockAudio } from "../../data/Audio";
import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { AppStateType, SaveMetadata } from "../../Types";
import { store } from "../../Store";
import { TUTORIALS } from "../../data/Scenarios";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { navigate } from "../../reducers/Card";
import { startTutorial } from "../../reducers/Game";
import { change as changeSettings } from "../../reducers/Settings";
import { feedbackOpen } from "../../reducers/UI";
import { selectContinueSave } from "../../SaveModel";
import { showMultiplayerLobby } from "../../multiplayer/Registry";
import { resumeSavedGame, runSaveTransition } from "../../SaveSession";
import MainMenu, { DispatchProps, StateProps } from "./MainMenu";

function getNextTutorial() {
  const played = getPlayedScenarioIds();
  return TUTORIALS.find((tutorial) => !played.includes(tutorial.id));
}

const mapStateToProps = (state: AppStateType): StateProps => {
  const saved = selectContinueSave(state.saves?.entries || []);
  return {
    audioEnabled: state.settings.audioEnabled,
    hasSavedGame: !!saved,
    hasSavedGames: !!state.saves?.entries.length,
    hasUnfinishedTutorials: !!getNextTutorial(),
  };
};

export const mapDispatchToProps = (
  dispatch: AppDispatch,
  getEntries: () => SaveMetadata[] = () => store.getState().saves.entries,
): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      if (v) unlockAudio();
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onContinue: () => {
      const saved = selectContinueSave(getEntries());
      if (saved) void resumeSavedGame(saved.id);
    },
    onPlayWithFriends: showMultiplayerLobby,
    onSavedGames: () => {
      dispatch(navigate("SAVED_GAMES"));
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onFeedback: () => {
      dispatch(feedbackOpen({ source: "game-menu" }));
    },
    onSettings: () => {
      dispatch(navigate("SETTINGS"));
    },
    onMods: () => {
      dispatch(navigate("MODS"));
    },
    onAchievements: () => {
      dispatch(navigate("ACHIEVEMENTS"));
    },
    onStart: () => {
      dispatch(navigate("NEW_GAME"));
    },
    onTutorials: () => {
      const tutorial = getNextTutorial();
      if (tutorial)
        void runSaveTransition(() => startTutorial(dispatch, tutorial.id));
    },
  };
};

const MainMenuContainer = connect(mapStateToProps, (dispatch: AppDispatch) =>
  mapDispatchToProps(dispatch),
)(MainMenu);

export default MainMenuContainer;
