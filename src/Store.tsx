import { configureStore, ThunkAction, Action } from '@reduxjs/toolkit';
import {card} from './reducers/Card';
import {gameState} from './reducers/GameState';
import settingsReducer from './reducers/Settings';
import {ui} from './reducers/UI';
import {user} from './reducers/User';

export const store = configureStore({
  reducer: {
    card,
    gameState,
    settings: settingsReducer,
    ui,
    user,
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