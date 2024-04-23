import { configureStore, ThunkAction, Action } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import cardReducer from "./reducers/Card";
import gameReducer from "./reducers/Game";
import settingsReducer from "./reducers/Settings";
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
});

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
