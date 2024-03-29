import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {getStorageBoolean, getStorageBooleanOrUndefined, setStorageKeyValue} from '../LocalStorage';
import {SettingsType} from '../Types';

export const initialSettings: SettingsType = {
  audioEnabled: getStorageBooleanOrUndefined('audioEnabled'),
  showHelp: getStorageBoolean('showHelp', true),
  vibration: getStorageBoolean('vibration', true),
};

export const settingsSlice = createSlice({
  name: 'settings',
  initialState: initialSettings,
  reducers: {
    change: (state, action: PayloadAction<Partial<SettingsType>>) => {
      const changes = action.payload || {};
      // Update values in local storage
      Object.keys(changes).forEach((key: string) => {
        setStorageKeyValue(key, changes[key]);
      });
      return {...state, ...changes};
    },
  },
});

export const { change } = settingsSlice.actions;

export default settingsSlice.reducer;