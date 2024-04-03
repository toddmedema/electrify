import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {UserType} from '../Types';
import {RootState} from '../Store';

export const initialUser: UserType = {};

export const userSlice = createSlice({
  name: 'user',
  initialState: initialUser,
  reducers: {
    delta: (state, action: PayloadAction<Partial<UserType>>) => {
      return {...state, ...action.payload};
    },
  },
});

export const { delta } = userSlice.actions;

export const selectUid = (state: RootState) => state.user.uid;

export default userSlice.reducer;
