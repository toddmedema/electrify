import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { logEvent } from "../../Globals";
import { initEconomy } from "../../data/Economy";
import { initFuelPrices } from "../../data/FuelPrices";
import { initWeather } from "../../data/Weather";
import { getStartingCustomers } from "../../data/LocationProfiles";
import { getScenarioLocation } from "../../helpers/Locations";
import { getScenario } from "../../data/Scenarios";
import { navigate } from "../../reducers/Card";
import { initGame, loaded, delta } from "../../reducers/Game";
import { isResumedGame } from "../../SaveGame";
import { AppStateType, GameType, TutorialStepType } from "../../Types";
import Loading, { DispatchProps, StateProps } from "./Loading";

export function restoreTutorialAfterLoading(
  dispatch: AppDispatch,
  tutorialSteps: TutorialStepType[],
  tutorialStep: number,
): void {
  const destination = tutorialSteps[tutorialStep]?.card;
  // loaded() always mounts Facilities first. Reapply the selected objective's authored pane after
  // a capstone reset so Finances/Pricing retries do not strand their HUD on the fleet, and so
  // future capstones can safely start anywhere.
  if (destination) {
    dispatch(navigate(destination));
  }
  dispatch(delta({ tutorialStep }));
}

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

let loadInProgress = false;
let loadListeners: Array<{
  onProgress: (message: string) => void;
  onError: (message: string) => void;
}> = [];

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    load: async (
      game: GameType,
      onProgress: (message: string) => void,
      onError: (message: string) => void,
    ) => {
      loadListeners.push({ onProgress, onError });
      if (loadInProgress) {
        // StrictMode and card transitions can mount the loading view twice. Both renders share
        // this module, so only the first one starts the downloads.
        return;
      }
      loadInProgress = true;
      const reportProgress = (message: string) =>
        loadListeners.forEach((listener) => listener.onProgress(message));
      const reportError = (message: string) =>
        loadListeners.forEach((listener) => listener.onError(message));
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
        reportError(
          "We couldn't find that mission. Return to the mission list and try another.",
        );
        loadInProgress = false;
        loadListeners = [];
        return;
      }
      // A resumed game keeps the location it was saved with, so the weather CSV that gets loaded
      // is the one its forecasts were built from. A replay is the same story: startReplay put
      // the location the run was recorded in on the slice, which is the only thing that keeps a
      // replay from being re-simulated somewhere else
      const location =
        resumed || replaying ? game.location : getScenarioLocation(scenario);
      if (!location) {
        reportError("We couldn't find the location data for this mission.");
        loadInProgress = false;
        loadListeners = [];
        return;
      }

      const callbackLoad = (
        start: (done: (failure?: string) => void) => void,
      ) =>
        new Promise<void>((resolve, reject) => {
          start((failure?: string) =>
            failure ? reject(new Error(failure)) : resolve(),
          );
        });

      reportProgress("Loading weather and market data…");
      try {
        await Promise.all([
          callbackLoad((done) => initWeather(location, done)),
          callbackLoad(initFuelPrices),
          callbackLoad(initEconomy),
        ]);
        reportProgress("Starting your mission…");
        if (!resumed) {
          // Otherwise, generate from scratch
          // TODO different scenarios - for example, start with Natural Gas if year is 2000+, otherwise coal
          dispatch(
            initGame({
              facilities: scenario.facilities,
              cash: scenario.cash,
              customers:
                scenario.startingCustomers || getStartingCustomers(location),
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
          // A capstone retry comes through the same clean scenario-start path with its authored
          // step already selected. Preserve it; a normal tutorial still arrives with -1 and
          // starts at the first objective after the card transition has mounted its controls.
          const tutorialStep = game.tutorialStep >= 0 ? game.tutorialStep : 0;
          setTimeout(
            () =>
              restoreTutorialAfterLoading(
                dispatch,
                scenario.tutorialSteps!,
                tutorialStep,
              ),
            300,
          );
        }
      } catch (error) {
        reportError(
          error instanceof Error
            ? error.message
            : "The game data couldn't be loaded. Check your connection and retry.",
        );
      } finally {
        loadInProgress = false;
        loadListeners = [];
      }
    },
  };
};

const LoadingContainer = connect(mapStateToProps, mapDispatchToProps)(Loading);

export default LoadingContainer;
