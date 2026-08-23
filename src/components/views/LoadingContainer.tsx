import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { logEvent } from "../../Globals";
import { initFuelPrices } from "../../data/FuelPrices";
import { initWeather } from "../../data/Weather";
import { LOCATIONS } from "../../Constants";
import { getScenario } from "../../data/Scenarios";
import { initGame, loaded, delta } from "../../reducers/Game";
import { isResumedGame } from "../../SaveGame";
import { AppStateType, GameType } from "../../Types";
import Loading, { DispatchProps, StateProps } from "./Loading";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

let lastLoad = performance.now();
const LOADING_DEBOUNCE_MS = 1000;

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    load: (game: GameType) => {
      if (performance.now() - lastLoad < LOADING_DEBOUNCE_MS) {
        // Compositor sometimes renders cards multiple times, no good for loading
        return;
      }

      lastLoad = performance.now();
      // resume() has already restored the whole slice by the time a saved game reaches this
      // screen, so all that's left is re-reading the CSVs it couldn't carry
      const resumed = isResumedGame(game);
      logEvent("scenario_start", {
        id: game.scenarioId,
        difficulty: game.difficulty,
        resumed,
      });
      const scenario = getScenario(game.scenarioId, game.customScenario);
      if (!scenario) {
        return alert("Unknown scenario ID " + game.scenarioId);
      }
      // A resumed game keeps the location it was saved with, so the weather CSV that gets loaded
      // is the one its forecasts were built from
      const location = resumed ? game.location : LOCATIONS[scenario.locationId];
      if (!location) {
        return alert("Unknown location ID " + scenario.locationId);
      }

      initWeather(location.id, () => {
        initFuelPrices(() => {
          if (!resumed) {
            // Otherwise, generate from scratch
            // TODO different scenarios - for example, start with Natural Gas if year is 2000+, otherwise coal
            dispatch(
              initGame({
                facilities: scenario.facilities,
                cash: scenario.cash,
                customers: 1030000,
                location,
                // Only ever set by the custom game screen; every authored scenario leaves it
                // undefined and draws a fresh seed
                seed: scenario.seed,
              }),
            );
          }

          dispatch(loaded());

          // Tutorials are never autosaved, so a resumed game shouldn't restart a walkthrough
          if (scenario.tutorialSteps && !resumed) {
            setTimeout(() => dispatch(delta({ tutorialStep: 0 })), 300);
          }
        });
      });
    },
  };
};

const LoadingContainer = connect(mapStateToProps, mapDispatchToProps)(Loading);

export default LoadingContainer;
