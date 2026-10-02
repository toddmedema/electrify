import { activeScenario } from "../../helpers/GameSelectors";
import type { Dispatch, UnknownAction } from "@reduxjs/toolkit";
import type { AppDispatch, AppThunk } from "../../Store";
import { connect } from "react-redux";
import { logEvent } from "../../Globals";
import { initEconomy } from "../../data/Economy";
import { initFuelPrices } from "../../data/FuelPrices";
import { initWeather } from "../../data/Weather";
import { getStartingCustomers } from "../../data/LocationProfiles";
import { getScenarioLocation } from "../../helpers/Locations";
import { navigate } from "../../reducers/Card";
import { initGame, loaded, delta } from "../../reducers/Game";
import { isResumedGame } from "../../SaveGame";
import {
  completeSaveLoading,
  failSaveLoading,
  getLoadingGeneration,
  isCurrentLoadingGeneration,
} from "../../SaveSession";
import { AppStateType, GameType, TutorialStepType } from "../../Types";
import Loading, { DispatchProps, StateProps } from "./Loading";

export function restoreTutorialAfterLoading(
  dispatch: Dispatch<UnknownAction>,
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

// A previous load's delayed callback can outlive a quick capstone retry. Do not
// navigate away from the new loading screen or rewind a step the player has left.
export function restoreLoadedTutorial(
  requestedGame: GameType,
  tutorialSteps: TutorialStepType[],
): AppThunk {
  return (dispatch, getState) => {
    const current = getState().game;
    if (
      !current.inGame ||
      current.scenarioId !== requestedGame.scenarioId ||
      current.tutorialStep !== requestedGame.tutorialStep
    ) {
      return;
    }
    restoreTutorialAfterLoading(
      dispatch,
      tutorialSteps,
      requestedGame.tutorialStep >= 0 ? requestedGame.tutorialStep : 0,
    );
  };
}

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

let loadingGeneration: number | undefined;
// Simulation data caches are shared. Finish an older download before starting a newer
// location, otherwise a stale completion could overwrite the current mission’s cache.
let dataLoading: Promise<void> = Promise.resolve();
let loadListeners: Array<{
  onProgress: (message: string) => void;
  onError: (message: string) => void;
}> = [];

export const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    load: async (
      game: GameType,
      onProgress: (message: string) => void,
      onError: (message: string) => void,
    ) => {
      const request = getLoadingGeneration();
      if (loadingGeneration !== request) loadListeners = [];
      loadListeners.push({ onProgress, onError });
      if (loadingGeneration === request) {
        // StrictMode and card transitions can mount the loading view twice. Both renders share
        // this module, so only the first one starts the downloads.
        return;
      }
      loadingGeneration = request;
      const reportProgress = (message: string) => {
        if (isCurrentLoadingGeneration(request))
          loadListeners.forEach((listener) => listener.onProgress(message));
      };
      const reportError = (message: string) => {
        if (isCurrentLoadingGeneration(request))
          loadListeners.forEach((listener) => listener.onError(message));
      };
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
      const scenario = activeScenario(game);
      if (!scenario) {
        reportError("Mission not found. Choose another from the mission list.");
        if (loadingGeneration === request) loadingGeneration = undefined;
        loadListeners = [];
        return;
      }
      // A resumed game keeps the location it was saved with, so the weather CSV that gets loaded
      // is the one its forecasts were built from. A replay is the same story: startReplay put
      // the location the run was recorded in on the slice, which is the only thing that keeps a
      // replay from being re-simulated somewhere else
      const location =
        resumed || replaying || game.runIdentity
          ? game.location
          : getScenarioLocation(scenario);
      if (!location) {
        reportError("We couldn't find the location data for this mission.");
        if (loadingGeneration === request) loadingGeneration = undefined;
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
        const task = dataLoading
          .catch(() => undefined)
          .then(async () => {
            if (!isCurrentLoadingGeneration(request)) return;
            await Promise.all([
              callbackLoad((done) => initWeather(location, done)),
              callbackLoad(initFuelPrices),
              callbackLoad(initEconomy),
            ]);
          });
        dataLoading = task;
        await task;
        if (!isCurrentLoadingGeneration(request)) return;
        reportProgress("Starting your mission…");
        if (!resumed) {
          // A new game uses the scenario's authored opening fleet.
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
              seed: replaying || game.runIdentity ? game.seed : scenario.seed,
            }),
          );
        }

        if (!(await completeSaveLoading(request))) return;
        dispatch(loaded());

        // Tutorials are never autosaved, so a resumed game shouldn't restart a walkthrough
        if (scenario.tutorialSteps && !resumed && !replaying) {
          // A capstone retry comes through the same clean scenario-start path with its authored
          // step already selected. Preserve it; a normal tutorial still arrives with -1 and
          // starts at the first objective after the card transition has mounted its controls.
          setTimeout(() => {
            if (isCurrentLoadingGeneration(request))
              dispatch(restoreLoadedTutorial(game, scenario.tutorialSteps!));
          }, 300);
        }
      } catch (error) {
        await failSaveLoading(request, error);
        reportError(
          error instanceof Error
            ? error.message
            : "Could not load game data. Check your connection and retry.",
        );
      } finally {
        if (loadingGeneration === request) {
          loadingGeneration = undefined;
          loadListeners = [];
        }
      }
    },
  };
};

const LoadingContainer = connect(mapStateToProps, mapDispatchToProps)(Loading);

export default LoadingContainer;
