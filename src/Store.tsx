import { configureStore, ThunkAction, Action } from '@reduxjs/toolkit';
import cardReducer from './reducers/Card';
import gameReducer from './reducers/Game';
import settingsReducer from './reducers/Settings';
import uiReducer from './reducers/UI';
import userReducer from './reducers/User';

export const store = configureStore({
  reducer: {
    card: cardReducer,
    game: gameReducer,
    settings: settingsReducer,
    ui: uiReducer,
    user: userReducer,
  },
});

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
export type AppThunk<ReturnType = void> = ThunkAction<
  ReturnType,
  RootState,
  unknown,
  Action<string>
>;