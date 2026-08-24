import { createAction } from "@reduxjs/toolkit";
import type { GameType, ReplayType } from "../Types";

/**
 * The game actions that other slices react to, declared here rather than by the game slice so that
 * Card and UI can listen for them without importing the reducer.
 *
 * Game reaches out to Store (to dispatch follow-up actions) and to Scenarios (which imports Card),
 * so a direct Card -> Game import closes a cycle. Because Card needs these action creators while
 * its own slice is still being built, whichever module happened to load first would find them
 * undefined and the store would fail to assemble. This module imports nothing but Redux Toolkit
 * and types, so nothing can cycle back through it.
 *
 * The type strings are the ones createSlice generated for a slice named "game", so devtools traces
 * and anything matching on action type are unaffected.
 */
export const start = createAction<number>("game/start");
export const loaded = createAction("game/loaded");
/**
 * Ends the scenario. Pass { toScenarioList: true } to land on the scenario list rather than the
 * title screen - what you want after finishing (or failing) a scenario, since the next thing a
 * player wants is another scenario.
 */
export const quit = createAction<{ toScenarioList?: boolean } | undefined>(
  "game/quit",
);
/**
 * Restores a saved game slice, then routes to the loading screen the same way start does so that
 * the weather and fuel price CSVs are back in memory before the first tick.
 */
export const resume = createAction<GameType>("game/resume");
/**
 * Starts watching a replay. Takes the same route as start and resume -- the loading screen is
 * what re-reads the weather and fuel price CSVs, and it's initGame, with the replay's own seed,
 * that rebuilds the run the actions will be applied to.
 */
export const startReplay = createAction<ReplayType>("game/startReplay");
