import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { startTutorial } from "../../reducers/Game";
import { quitSavedGame, runSaveTransition } from "../../SaveSession";
import { delta as uiDelta } from "../../reducers/UI";
import { navigate } from "../../reducers/Card";
import { scenarioDetailsUrl } from "../../ScenarioUrl";
import { AppStateType, GameType } from "../../Types";
import NewGame, { DispatchProps, StateProps } from "./NewGame";
import { coopControls } from "../../multiplayer/Registry";
import { store } from "../../Store";
import { getDesktop } from "../../Desktop";

// A co-op guest follows the host's screens, so its own clicks don't navigate.
const guest = () => store.getState().ui.coop?.role === "guest";
const coop = () => !!store.getState().ui.coop;

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    coop: state.ui.coop,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      if (coop()) coopControls()?.back();
      else void quitSavedGame();
    },
    onCustomGame: () => {
      if (!guest()) dispatch(navigate("CUSTOM_GAME"));
    },
    onCommunityScenarios:
      process.env.REACT_APP_DESKTOP === "true" && getDesktop()?.mods
        ? () => {
            if (!coop()) dispatch(navigate("MODS"));
          }
        : undefined,
    onDetails: (d: Partial<GameType>) => {
      if (guest()) return;
      dispatch(uiDelta({ scenarioPreview: d.scenarioId }));
      if (d.scenarioId !== undefined) {
        dispatch(
          navigate({
            name: "NEW_GAME_DETAILS",
            url: scenarioDetailsUrl(d.scenarioId),
          }),
        );
      }
    },
    onTutorial: (scenarioId: number) => {
      if (coop()) return;
      void runSaveTransition(() => startTutorial(dispatch, scenarioId));
    },
  };
};

const NewGameContainer = connect(mapStateToProps, mapDispatchToProps)(NewGame);

export default NewGameContainer;
