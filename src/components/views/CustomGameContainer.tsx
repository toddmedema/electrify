import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
} from "../../data/Scenarios";
import { getCustomScenario, recordCustomScenario } from "../../LocalStorage";
import { getHistoryApi } from "../../Globals";
import { customEventFromSearch, scenarioListUrl } from "../../ScenarioUrl";
import { navigateBack } from "../../reducers/Card";
import { delta, start, quit } from "../../reducers/Game";
import { store } from "../../Store";
import { delta as uiDelta } from "../../reducers/UI";
import { startWithSaveGuard } from "./StartGame";
import { AppStateType, GameType, ScenarioType } from "../../Types";
import CustomGame, { DispatchProps, StateProps } from "./CustomGame";
import { coopControls } from "../../multiplayer/Registry";

const coopRole = () => store.getState().ui.coop?.role;

const mapStateToProps = (state: AppStateType): StateProps => {
  const coop = state.ui.coop;
  // A co-op guest sees the host's setup rather than the one it played last.
  const scenario =
    (coop?.role === "guest" && coop.custom) ||
    state.game.customScenario ||
    getCustomScenario(DEFAULT_CUSTOM_SCENARIO);
  const eventId = customEventFromSearch(window.location.search);
  return {
    coop,
    game: {
      ...state.game,
      difficulty: state.ui.previewDifficulty ?? state.game.difficulty,
    },
    // The game the player set up last time, so tweaking one setting and replaying doesn't mean
    // re-entering all of them
    scenario:
      eventId === undefined
        ? scenario
        : { ...scenario, eventScenarioIds: [eventId] },
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      if (coopRole() === "guest") {
        coopControls()?.back();
        return;
      }
      if (customEventFromSearch(window.location.search) !== undefined) {
        getHistoryApi().back();
      } else {
        dispatch(navigateBack());
      }
    },
    onDelta: (d: Partial<GameType>) => {
      if (coopRole() === "guest") return;
      dispatch(uiDelta({ previewDifficulty: d.difficulty }));
    },
    onScenarioChange: (custom: ScenarioType) => {
      const coop = store.getState().ui.coop;
      if (coop?.role === "host")
        dispatch(uiDelta({ coop: { ...coop, custom } }));
    },
    onStart: (scenario: ScenarioType) => {
      const role = coopRole();
      if (role) {
        if (role === "host") {
          recordCustomScenario(scenario);
          coopControls()?.start({
            scenarioId: CUSTOM_SCENARIO_ID,
            difficulty:
              store.getState().ui.previewDifficulty ??
              store.getState().game.difficulty,
            customScenario: scenario,
          });
        }
        return;
      }
      recordCustomScenario(scenario);
      startWithSaveGuard(dispatch, () => {
        if (customEventFromSearch(window.location.search) !== undefined) {
          getHistoryApi().replaceState(null, "", scenarioListUrl());
        }
        const difficulty =
          store.getState().ui.previewDifficulty ??
          store.getState().game.difficulty;
        dispatch(quit());
        dispatch(delta({ difficulty }));
        // The scenario has to be on the slice before start(), since the loading screen resolves
        // it straight back out of there
        dispatch(
          delta({ scenarioId: CUSTOM_SCENARIO_ID, customScenario: scenario }),
        );
        dispatch(start(CUSTOM_SCENARIO_ID));
      });
    },
  };
};

const CustomGameContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(CustomGame);

export default CustomGameContainer;
