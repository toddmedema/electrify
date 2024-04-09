import Redux from "redux";
import { connect } from "react-redux";
import { logEvent } from "../../Globals";
import { initFuelPrices } from "../../data/FuelPrices";
import { initWeather } from "../../data/Weather";
import { LOCATIONS } from "../../Constants";
import { SCENARIOS } from "../../Scenarios";
import { initGame, loaded, delta } from "../../reducers/Game";
import { AppStateType, GameType } from "../../Types";
import Loading, { DispatchProps, StateProps } from "./Loading";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    load: (game: GameType) => {
      logEvent("scenario_start", {
        id: game.scenarioId,
        difficulty: game.difficulty,
      });
      const scenario = SCENARIOS.find((s) => s.id === game.scenarioId);
      if (!scenario) {
        return alert("Unknown scenario ID " + game.scenarioId);
      }
      const location = LOCATIONS.find((s) => s.id === scenario.locationId);
      if (!location) {
        return alert("Unknown location ID " + scenario.locationId);
      }

      initWeather(location.id, () => {
        // TODO load game state from localstorage if loading

        initFuelPrices(() => {
          // Otherwise, generate from scratch
          // TODO different scenarios - for example, start with Natural Gas if year is 2000+, otherwise coal
          dispatch(
            initGame({
              facilities: scenario.facilities,
              cash: scenario.cash,
              customers: 1030000,
              location,
            }),
          );

          dispatch(loaded());

          if (scenario.tutorialSteps) {
            setTimeout(() => dispatch(delta({ tutorialStep: 0 })), 300);
          }
        });
      });
    },
  };
};

const LoadingContainer = connect(mapStateToProps, mapDispatchToProps)(Loading);

export default LoadingContainer;
