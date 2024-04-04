import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {UserType, ScoreType} from '../Types';
import {RootState} from '../Store';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'; 
import {getDb} from '../Globals';

export const initialUser: UserType = {};

export const userSlice = createSlice({
  name: 'user',
  initialState: initialUser,
  reducers: {
    delta: (state, action: PayloadAction<Partial<UserType>>) => {
      return {...state, ...action.payload};
    },
    submitHighscore: (state, action: PayloadAction<Partial<ScoreType>>) => {
      if (state.uid) {
        const scoreSubmission = {
          score: action.payload.score,
          scoreBreakdown: action.payload.scoreBreakdown, // For analytics purposes only
          scenarioId: action.payload.scenarioId,
          difficulty: action.payload.difficulty,
          date: serverTimestamp(),
          uid: state.uid,
        } as ScoreType;
        addDoc(collection(getDb(), 'scores'), scoreSubmission);
      }
    }
  },
});

export const { delta, submitHighscore } = userSlice.actions;

export const selectUid = (state: RootState) => state.user.uid;

export default userSlice.reducer;
