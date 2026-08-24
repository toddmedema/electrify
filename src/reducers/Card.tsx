import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { getHistoryApi, logEvent } from "../Globals";
import { NAVIGATION_DEBOUNCE_MS } from "../Constants";
import { CardNameType, CardType, NavigateActionType } from "../Types";
import { start, loaded, quit, resume, startReplay } from "./GameActions";
import type { RootState } from "../Store";

/**
 * ts: 0 solves an obscure bug (instead of Date.now()) where rapidly triggering navigations with undefined states
 * (specifically from the editor) wouldn't work b/c their ts diffs were < DEBOUNCE
 */
export const initialCard: CardType = {
  name: "MAIN_MENU" as CardNameType,
  ts: 0,
  history: ["MAIN_MENU"] as CardNameType[],
  toPrevious: false,
};

export const cardSlice = createSlice({
  name: "card",
  initialState: initialCard,
  reducers: {
    navigate: (state, action: PayloadAction<string | NavigateActionType>) => {
      let a = action.payload;
      if (typeof a === "string" || a == null) {
        a = { name: a } as NavigateActionType;
      }
      if (
        a.name === state.name &&
        Date.now() - state.ts < NAVIGATION_DEBOUNCE_MS
      ) {
        return state;
      }
      logEvent("card_view", { card: a.name });
      getHistoryApi().pushState(null, "", "#");
      // TODO better implementation for don't remember, right now it still makes an entry!
      return {
        ...state,
        name: a.name,
        // Cleared rather than carried over, so a plain visit to the manual doesn't reopen
        // whichever entry the last deep link pointed at
        entry: a.entry,
        history: [
          a.dontRemember ? state.name : a.name,
          ...(state.history || []),
        ],
        toPrevious: false,
      };
    },
    navigateBack: (state) => {
      return {
        name: (state.history || [])[1] || "MAIN_MENU", // Look 2 back since first is current card
        ts: Date.now(),
        history: (state.history || []).slice(1),
        toPrevious: true,
      };
    },
  },
  extraReducers: (builder) => {
    builder.addCase(start, (state) => {
      state = {
        name: "LOADING",
        ts: Date.now(),
        history: state.history, // Don't store loading screen in history
      };
      return state;
    });
    // A resumed game takes the same route as a new one: the loading screen is what re-reads the
    // weather and fuel price CSVs, which don't survive a reload
    builder.addCase(resume, (state) => {
      return {
        name: "LOADING" as CardNameType,
        ts: Date.now(),
        history: state.history,
      };
    });
    // Watching a replay goes the same way, since it re-runs the simulation from the seed
    builder.addCase(startReplay, (state) => {
      return {
        name: "LOADING" as CardNameType,
        ts: Date.now(),
        history: state.history,
      };
    });
    builder.addCase(loaded, (state) => {
      state = {
        name: "FACILITIES",
        ts: Date.now(),
        history: ["FACILITIES", ...(state.history || [])],
      };
      return state;
    });
    builder.addCase(quit, (state, action) => {
      if (action.payload && action.payload.toScenarioList) {
        return {
          name: "NEW_GAME" as CardNameType,
          ts: Date.now(),
          history: ["NEW_GAME", "MAIN_MENU"] as CardNameType[],
          toPrevious: false,
        };
      }
      state = { ...initialCard };
      return state;
    });
  },
});

export const { navigate, navigateBack } = cardSlice.actions;

export const selectCardName = (state: RootState) => state.card.name;

export default cardSlice.reducer;
