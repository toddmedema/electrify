import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { logEvent } from "../../Globals";
import { initEconomy } from "../../data/Economy";
import { initFuelPrices } from "../../data/FuelPrices";
import { initWeather } from "../../data/Weather";
import { getScenarioLocation } from "../../helpers/Locations";
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
      // A replay is closer to a new game than a resumed one: nothing of the run is restored, it
      // is simulated again from the seed startReplay put on the slice
      const replaying = !!game.replayPlayback;
      if (!replaying) {
        logEvent("scenario_start", {
          id: game.scenarioId,
          difficulty: game.difficulty,
          resumed,
        });
      }
      const scenario = getScenario(game.scenarioId, game.customScenario);
      if (!scenario) {
        return alert("Unknown scenario ID " + game.scenarioId);
      }
      // A resumed game keeps the location it was saved with, so the weather CSV that gets loaded
      // is the one its forecasts were built from. A replay is the same story: startReplay put
      // the location the run was recorded in on the slice, which is the only thing that keeps a
      // replay from being re-simulated somewhere else
      const location =
        resumed || replaying ? game.location : getScenarioLocation(scenario);
      if (!location) {
        return alert("Unknown location ID " + scenario.locationId);
      }

      initWeather(location.id, (weatherFailure?: string) => {
        if (weatherFailure) {
          // Every city the picker offers has a file behind it, so this is a download that failed
          // rather than a place that was never fetched -- and starting anyway would hand back a
          // game where the weather never changes, which reads as the game being broken
          return alert(weatherFailure);
        }
        // The two records below have no fallback at all: a game started without them throws on
        // its first tick rather than playing oddly, so each one stops here the way weather does
        initFuelPrices((fuelFailure?: string) => {
          if (fuelFailure) {
            return alert(fuelFailure);
          }
          initEconomy((economyFailure?: string) => {
            if (economyFailure) {
              return alert(economyFailure);
            }
            if (!resumed) {
              // Otherwise, generate from scratch
              // TODO different scenarios - for example, start with Natural Gas if year is 2000+, otherwise coal
              dispatch(
                initGame({
                  facilities: scenario.facilities,
                  cash: scenario.cash,
                  customers: 1030000,
                  location,
                  // A replay has to run on the seed it was recorded with. Otherwise only the custom
                  // game screen sets one; every authored scenario leaves it undefined and draws a
                  // fresh seed
                  seed: replaying ? game.seed : scenario.seed,
                }),
              );
            }

            dispatch(loaded());

            // Tutorials are never autosaved, so a resumed game shouldn't restart a walkthrough
            if (scenario.tutorialSteps && !resumed && !replaying) {
              setTimeout(() => dispatch(delta({ tutorialStep: 0 })), 300);
            }
          });
        });
      });
    },
  };
};

const LoadingContainer = connect(mapStateToProps, mapDispatchToProps)(Loading);

export default LoadingContainer;
