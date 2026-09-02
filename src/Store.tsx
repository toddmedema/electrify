import { configureStore, ThunkAction, Action } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import { registerStore } from "./StoreRegistry";
import cardReducer from "./reducers/Card";
import gameReducer from "./reducers/Game";
import settingsReducer from "./reducers/Settings";
import { tutorialGateMiddleware } from "./reducers/Tutorial";
import uiReducer from "./reducers/UI";
import userReducer from "./reducers/User";

export const store = configureStore({
  reducer: {
    card: cardReducer,
    game: gameReducer,
    settings: settingsReducer,
    ui: uiReducer,
    user: userReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Timeline/history dominate the state by several orders of magnitude and are replaced only
      // by reducer-owned simulation code. Walking every tick of both after every 1x/20x action
      // made development builds spend more time validating forecasts than running them.
      immutableCheck: {
        ignoredPaths: ["game.timeline", "game.monthlyHistory"],
      },
      // The shared dialog/snackbar layer predates this store and deliberately carries React
      // content and click callbacks. Those values never leave the live UI state, but Redux
      // Toolkit otherwise reports them on every simulation tick, burying actionable warnings
      // under hundreds of identical messages. Keep serializability checks everywhere else.
      serializableCheck: {
        ignoredActions: ["ui/dialogOpen", "ui/snackbarOpen"],
        ignoredPaths: [
          "ui.dialog.message",
          "ui.dialog.action",
          "ui.dialog.secondaryAction",
          "ui.snackbar.action",
          "game.timeline",
          "game.monthlyHistory",
          "game.replayLog",
        ],
      },
    }).concat(tutorialGateMiddleware),
});

export type AppStore = typeof store;

// Lets the game reducer dispatch follow-up actions without importing this module back
registerStore(store);

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
export type AppThunk<ReturnType = void> = ThunkAction<
  ReturnType,
  RootState,
  unknown,
  Action<string>
>;
