import type { Middleware } from "@reduxjs/toolkit";
import type { AppStateType } from "../Types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { getHistoryApi, logEvent } from "../Globals";
import { NAVIGATION_DEBOUNCE_MS } from "../Constants";
import { isDataCenterSetupSearch } from "../DataCenterUrl";
import { CardNameType, CardType, NavigateActionType } from "../Types";
import {
  launchRun,
  start,
  loaded,
  quit,
  resume,
  multiplayerSnapshot,
} from "./GameActions";
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

/**
 * A visitor following the data-center guide's link opens directly on its setup. Navigating there
 * after mount would first paint the main menu and then slide it away, which reads as a stray page
 * between the guide and the tool. The menu stays one step back, as it would after an in-app visit.
 */
function startupCard(): CardType {
  if (
    typeof window === "undefined" ||
    !isDataCenterSetupSearch(window.location.search)
  ) {
    return initialCard;
  }
  return {
    ...initialCard,
    name: "DATA_CENTER_SETUP",
    history: ["DATA_CENTER_SETUP", "MAIN_MENU"],
  };
}

export const cardSlice = createSlice({
  name: "card",
  initialState: startupCard,
  reducers: {
    navigate: (
      state,
      action: PayloadAction<CardNameType | NavigateActionType>,
    ) => {
      const a =
        typeof action.payload === "string"
          ? { name: action.payload }
          : action.payload;
      const now = Date.now();
      if (
        !a.replaceCurrentCard &&
        a.name === state.name &&
        a.entry === state.entry &&
        JSON.stringify(a.storyTarget) === JSON.stringify(state.storyTarget) &&
        a.url === state.url &&
        now - state.ts < NAVIGATION_DEBOUNCE_MS
      ) {
        return state;
      }
      if (!a.skipBrowserHistory) {
        getHistoryApi().pushState(null, "", a.url || "#");
      }
      // Following a link between manual entries is a step within the manual, like a wiki's: Back
      // (browser, device or Esc) retraces it, while the card history stays one manual visit deep
      if (a.fromEntry !== undefined && state.name === "MANUAL") {
        return {
          ...state,
          ts: now,
          entry: a.entry,
          manualTrail: [a.fromEntry, ...(state.manualTrail || [])],
        };
      }
      logEvent("card_view", { card: a.name });
      // TODO better implementation for don't remember, right now it still makes an entry!
      return {
        ...state,
        name: a.name,
        ts: now,
        url: a.url,
        // Cleared rather than carried over, so a plain visit to the manual doesn't reopen
        // whichever entry the last deep link pointed at
        entry: a.entry,
        manualTrail: undefined,
        storyTarget: a.storyTarget,
        history: [
          a.dontRemember ? state.name : a.name,
          ...(a.replaceCurrentCard
            ? (state.history || []).slice(1)
            : state.history || []),
        ],
        toPrevious: false,
      };
    },
    navigateBack: (state, _action: PayloadAction<CardNameType | undefined>) => {
      const [previousEntry, ...trail] = state.manualTrail || [];
      if (state.name === "MANUAL" && previousEntry !== undefined) {
        return {
          ...state,
          ts: Date.now(),
          entry: previousEntry,
          manualTrail: trail,
          toPrevious: true,
        };
      }
      return {
        name: (state.history || [])[1] || "MAIN_MENU", // Look 2 back since first is current card
        ts: Date.now(),
        history: (state.history || []).slice(1),
        toPrevious: true,
      };
    },
    // The manual header's back button leaves the manual outright, however many entries deep
    // the player followed links
    manualTrailCleared: (state) => {
      state.manualTrail = undefined;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(multiplayerSnapshot, (state) => {
      // A co-op match starts from the lobby or the screens its players chose it on together.
      if (
        [
          "MAIN_MENU",
          "LOADING",
          "NEW_GAME",
          "NEW_GAME_DETAILS",
          "CUSTOM_GAME",
          "MODS",
        ].includes(state.name)
      ) {
        state.name = "FACILITIES";
        state.history = ["FACILITIES", "MAIN_MENU"];
        state.ts = Date.now();
      }
    });
    builder.addCase(launchRun, (state) => {
      state.history = ["LOADING"];
      state.name = "LOADING";
      state.ts = Date.now();
    });
    builder.addCase(start, (state) => {
      state = {
        name: "LOADING",
        ts: Date.now(),
        // Reserve a loading slot. Completion replaces it in place, preserving screens
        // opened meanwhile and keeping Back safe while data is still pending.
        history: ["LOADING", ...(state.history || [])],
      };
      return state;
    });
    // A resumed game takes the same route as a new one: the loading screen is what re-reads the
    // weather and fuel price CSVs, which don't survive a reload
    builder.addCase(resume, (state) => {
      return {
        name: "LOADING" as CardNameType,
        ts: Date.now(),
        history: ["LOADING", ...(state.history || [])],
      };
    });
    builder.addCase(loaded, (state) => {
      const history = (state.history || []).map((card) =>
        card === "LOADING" ? "FACILITIES" : card,
      );
      // Loading may finish after the player opens another screen (for example an
      // achievement notification). Complete the game without taking navigation back.
      if (state.name !== "LOADING") {
        state.history = history;
        return;
      }
      state = {
        name: "FACILITIES",
        ts: Date.now(),
        history,
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

export const { navigate, navigateBack, manualTrailCleared } = cardSlice.actions;

export const selectCardName = (state: RootState) => state.card.name;

export default cardSlice.reducer;

/** Resolve Back before reducing, so the game knows whether its destination still blocks play. */
export const navigationDestinationMiddleware: Middleware<
  object,
  AppStateType
> = (api) => (next) => (action) => {
  if (navigateBack.match(action)) {
    const card = api.getState().card;
    return next({
      ...action,
      payload:
        card.name === "MANUAL" && card.manualTrail?.length
          ? "MANUAL"
          : card.history?.[1] || "MAIN_MENU",
    });
  }
  return next(action);
};
