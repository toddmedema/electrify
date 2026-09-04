import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { delta, start, quit } from "../../reducers/Game";
import { navigate } from "../../reducers/Card";
import { scenarioDetailsUrl } from "../../ScenarioUrl";
import { AppStateType, GameType } from "../../Types";
import NewGame, { DispatchProps, StateProps } from "./NewGame";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      dispatch(quit());
    },
    onCustomGame: () => {
      dispatch(navigate("CUSTOM_GAME"));
    },
    onDetails: (d: Partial<GameType>) => {
      dispatch(delta(d));
      if (d.scenarioId !== undefined) {
        dispatch(
          navigate({
            name: "NEW_GAME_DETAILS",
            url: scenarioDetailsUrl(d.scenarioId),
          }),
        );
      }
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onTutorial: (scenarioId: number) => {
      dispatch(start(scenarioId));
    },
  };
};

const NewGameContainer = connect(mapStateToProps, mapDispatchToProps)(NewGame);

export default NewGameContainer;
