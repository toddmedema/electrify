import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  getStorageBooleanOrUndefined,
  getStorageChoice,
  setStorageKeyValue,
} from "../LocalStorage";
import { SettingsType } from "../Types";
import { pause, resume } from "../data/Audio";
import { DEFAULT_UNIT_SYSTEM, UNIT_SYSTEMS } from "../helpers/Units";

export const initialSettings: SettingsType = {
  audioEnabled: getStorageBooleanOrUndefined("audioEnabled"),
  // getStorageChoice rather than getStorageString so a hand-edited or outdated value falls back
  // to metric instead of reaching the formatters as a system that does not exist
  units: getStorageChoice("units", UNIT_SYSTEMS, DEFAULT_UNIT_SYSTEM),
};

export const settingsSlice = createSlice({
  name: "settings",
  initialState: initialSettings,
  reducers: {
    change: (state, action: PayloadAction<Partial<SettingsType>>) => {
      const changes = action.payload || {};
      // Update values in local storage. Object.entries rather than keys + lookup so the value
      // stays tied to its key's type instead of needing a string index into SettingsType.
      Object.entries(changes).forEach(([key, value]) => {
        setStorageKeyValue(key, value);
      });
      return { ...state, ...changes };
    },
    pauseAudio: () => {
      pause();
    },
    resumeAudio: (state) => {
      if (state.audioEnabled) {
        resume();
      }
    },
  },
});

export const { change, pauseAudio, resumeAudio } = settingsSlice.actions;

export default settingsSlice.reducer;
