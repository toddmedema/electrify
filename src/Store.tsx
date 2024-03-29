import { configureStore, ThunkAction, Action } from '@reduxjs/toolkit';
import {audio} from './reducers/Audio';
import {audioData} from './reducers/AudioData';
import {card} from './reducers/Card';
import {gameState} from './reducers/GameState';
import {settings} from './reducers/Settings';
import {ui} from './reducers/UI';
import {user} from './reducers/User';

export const store = configureStore({
  reducer: {
    audio,
    audioData,
    card,
    gameState,
    settings,
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