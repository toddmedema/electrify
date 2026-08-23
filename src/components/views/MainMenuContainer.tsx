import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import { SCENARIOS } from "../../data/Scenarios";
import { navigate } from "../../reducers/Card";
import { resume } from "../../reducers/Game";
import { change as changeSettings } from "../../reducers/Settings";
import { readSave } from "../../SaveGame";
import MainMenu, {
  DispatchProps,
  SavedGameSummary,
  StateProps,
} from "./MainMenu";

// mapStateToProps runs on every dispatch, and connect compares its result shallowly, so a fresh
// summary object each time would re-render the menu constantly. readSave is memoized and hands back
// the same save until it changes, which makes it a usable cache key.
let summarizedSave: ReturnType<typeof readSave>;
let summary: SavedGameSummary | undefined;

// A save whose scenario no longer exists can't be resumed, so it may as well not be offered
function savedGameSummary(): SavedGameSummary | undefined {
  const save = readSave();
  if (save === summarizedSave) {
    return summary;
  }
  summarizedSave = save;
  const scenario = save
    ? SCENARIOS.find((s) => s.id === save.game.scenarioId)
    : undefined;
  summary =
    save && scenario
      ? { scenarioName: scenario.name, year: save.game.date.year }
      : undefined;
  return summary;
}

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    audioEnabled: state.settings.audioEnabled,
    savedGame: savedGameSummary(),
    uid: state.user.uid,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onContinue: () => {
      const save = readSave();
      if (save) {
        // Card sends this to LOADING, which re-reads the CSVs and then dispatches loaded()
        dispatch(resume(save.game));
      }
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onSettings: () => {
      dispatch(navigate("SETTINGS"));
    },
    onStart: () => {
      dispatch(navigate("NEW_GAME"));
    },
  };
};

const MainMenuContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(MainMenu);

export default MainMenuContainer;
