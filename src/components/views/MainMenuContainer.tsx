import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { AppStateType, SaveMetadata } from "../../Types";
import { store } from "../../Store";
import { TUTORIALS } from "../../data/Scenarios";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { navigate } from "../../reducers/Card";
import { start } from "../../reducers/Game";
import { change as changeSettings } from "../../reducers/Settings";
import { selectContinueSave } from "../../SaveModel";
import { resumeSavedGame, runSaveTransition } from "../../SaveSession";
import MainMenu, { DispatchProps, StateProps } from "./MainMenu";

const mapStateToProps = (state: AppStateType): StateProps => {
  const saved = selectContinueSave(state.saves?.entries || []);
  return {
    audioEnabled: state.settings.audioEnabled,
    hasSavedGame: !!saved,
    hasSavedGames: !!state.saves?.entries.length,
    savedGameName: saved?.name,
    savedGameDescription: saved
      ? `${saved.scenarioName} · ${saved.date.month} ${saved.date.year}`
      : undefined,
  };
};

export const mapDispatchToProps = (
  dispatch: AppDispatch,
  getEntries: () => SaveMetadata[] = () => store.getState().saves.entries,
): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onContinue: () => {
      const saved = selectContinueSave(getEntries());
      if (saved) void resumeSavedGame(saved.id);
    },
    onSavedGames: () => {
      dispatch(navigate("SAVED_GAMES"));
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onSettings: () => {
      dispatch(navigate("SETTINGS"));
    },
    onStart: () => {
      // A brand-new player jumps straight into Mission 1.
      const played = getPlayedScenarioIds();
      const anyTutorialDone = TUTORIALS.some(
        (t) => played.indexOf(t.id) !== -1,
      );
      if (!anyTutorialDone && !selectContinueSave(getEntries())) {
        void runSaveTransition(() => dispatch(start(TUTORIALS[0].id)));
      } else {
        dispatch(navigate("NEW_GAME"));
      }
    },
  };
};

const MainMenuContainer = connect(mapStateToProps, (dispatch: AppDispatch) =>
  mapDispatchToProps(dispatch),
)(MainMenu);

export default MainMenuContainer;
