import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {getHistoryApi, logEvent} from '../Globals';
import {NAVIGATION_DEBOUNCE_MS} from '../Constants';
import {CardNameType, CardType, NavigateAction} from '../Types';
import {RootState} from '../Store';

/**
 * ts: 0 solves an obscure bug (instead of Date.now()) where rapidly triggering navigations with undefined states
 * (specifically from the editor) wouldn't work b/c their ts diffs were < DEBOUNCE
 */
export const initialCard: CardType = {
  name: 'MAIN_MENU' as CardNameType,
  ts: 0,
  history: ['MAIN_MENU'] as CardNameType[],
  toPrevious: false,
};

export const cardSlice = createSlice({
  name: 'card',
  initialState: initialCard,
  reducers: {
    navigate: (state, action: PayloadAction<NavigateAction>) => {
      const a = action.payload || {};
      if (a.name === state.name && Date.now() - state.ts < NAVIGATION_DEBOUNCE_MS) {
        return state;
      }
      logEvent('card_view', {card: a.name});
      getHistoryApi().pushState(null, '', '#');
      // TODO better implementation for don't remember, right now it still makes an entry!
      return {
        ...state,
        name: a.name,
        history: [(a.dontRemember) ? state.name : a.name, ...(state.history || [])],
        toPrevious: false,
      };
    },
    navigateBack: (state) => {
      return {
        name: (state.history || [])[1] || 'MAIN_MENU', // Look 2 back since first is current card
        ts: Date.now(),
        history: (state.history || []).slice(1),
        toPrevious: true,
      };
    },
    gameStart: (state) => {
      return {
        name: 'LOADING',
        ts: Date.now(),
        history: state.history, // Don't store loading screen in history
      };
    },
    gameLoaded: (state) => {
      return {
        name: 'FACILITIES',
        ts: Date.now(),
        history: ['FACILITIES', ...(state.history || [])],
      };
    },
    gameExit: () => {
      return {
        ...initialCard,
      };
    }
  },
});

export const { navigate, navigateBack, gameStart, gameLoaded, gameExit } = cardSlice.actions;

export const selectCardName = (state: RootState) => state.card.name;

export default cardSlice.reducer;