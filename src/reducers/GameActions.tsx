import { createAction } from "@reduxjs/toolkit";

/**
 * The game actions that other slices react to, declared here rather than by the game slice so that
 * Card and UI can listen for them without importing the reducer.
 *
 * Game reaches out to Store (to dispatch follow-up actions) and to Scenarios (which imports Card),
 * so a direct Card -> Game import closes a cycle. Because Card needs these action creators while
 * its own slice is still being built, whichever module happened to load first would find them
 * undefined and the store would fail to assemble. This module imports nothing but Redux Toolkit,
 * so nothing can cycle back through it.
 *
 * The type strings are the ones createSlice generated for a slice named "game", so devtools traces
 * and anything matching on action type are unaffected.
 */
export const start = createAction<number>("game/start");
export const loaded = createAction("game/loaded");
export const quit = createAction("game/quit");
