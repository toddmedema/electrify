import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
} from "../../data/Scenarios";
import { getCustomScenario, recordCustomScenario } from "../../LocalStorage";
import { navigateBack } from "../../reducers/Card";
import { delta, start } from "../../reducers/Game";
import { startWithSaveGuard } from "./StartGame";
import { AppStateType, GameType, ScenarioType } from "../../Types";
import CustomGame, { DispatchProps, StateProps } from "./CustomGame";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    // The game the player set up last time, so tweaking one setting and replaying doesn't mean
    // re-entering all of them
    scenario:
      state.game.customScenario || getCustomScenario(DEFAULT_CUSTOM_SCENARIO),
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
    onStart: (scenario: ScenarioType) => {
      recordCustomScenario(scenario);
      startWithSaveGuard(dispatch, () => {
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
