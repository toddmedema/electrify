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
import { waitForLoad } from "../../helpers/WaitForLoad";
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
  restorePane = true,
): void {
  const destination = tutorialSteps[tutorialStep]?.card;
  // When loading still owns navigation, loaded() mounts Facilities first. Restore the authored pane after
  // a capstone reset so Finances/Pricing retries do not strand their HUD on the fleet, and so
  // future capstones can safely start anywhere.
  if (destination && restorePane) {
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
    const state = getState();
    const current = state.game;
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
      // Still initialize the objective, but never dismiss a screen opened since loaded().
      state.card.name === "FACILITIES",
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
      logEvent("scenario_start", {
        id: game.scenarioId,
        difficulty: game.difficulty,
        resumed,
      });
      const scenario = activeScenario(game);
      if (!scenario) {
        reportError("Mission not found. Choose another from the mission list.");
        if (loadingGeneration === request) loadingGeneration = undefined;
        loadListeners = [];
        return;
      }
      // Resume and challenge runs keep the location their forecasts were built from.
      const location =
        resumed || game.runIdentity
          ? game.location
          : getScenarioLocation(scenario);
      if (!location) {
        reportError("We couldn't find the location data for this mission.");
        if (loadingGeneration === request) loadingGeneration = undefined;
        loadListeners = [];
        return;
      }

      reportProgress("Loading weather and market data…");
      try {
        const task = dataLoading
          .catch(() => undefined)
          .then(async () => {
            if (!isCurrentLoadingGeneration(request)) return;
            await Promise.all([
              waitForLoad((done) => initWeather(location, done)),
              waitForLoad(initFuelPrices),
              waitForLoad(initEconomy),
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
              // Challenge runs keep their seed; ordinary missions draw a fresh seed.
              seed: game.runIdentity ? game.seed : scenario.seed,
            }),
          );
        }

        if (!(await completeSaveLoading(request))) return;
        dispatch(loaded());

        // Tutorials are never autosaved, so a resumed game shouldn't restart a walkthrough
        if (scenario.tutorialSteps && !resumed) {
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
            : "Couldn't load game data. Check your connection and try again.",
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
