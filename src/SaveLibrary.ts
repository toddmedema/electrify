import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { IncompatibleCloudSave, SaveMetadata } from "./Types";

export interface SaveLibraryState {
  entries: SaveMetadata[];
  loading: boolean;
  error?: string;
  activeId?: string;
  pendingName?: string;
  saveState: "idle" | "saving" | "saved" | "failed";
  savedAt?: string;
  saveError?: string;
  mutationId?: string;
  transitioning?: boolean;
  unavailable?: Record<string, { revision: number; message: string }>;
  cloudState?:
    "initializing" | "signedOut" | "syncing" | "synced" | "offline" | "failed";
  cloudError?: string;
  cloudUid?: string;
  cloudConflicts?: boolean;
  incompatibleCloudSaves?: IncompatibleCloudSave[];
  cloudPromptRequested?: boolean;
}

export const initialSaveLibrary: SaveLibraryState = {
  entries: [],
  loading: true,
  saveState: "idle",
  cloudState: "initializing",
};

const slice = createSlice({
  name: "saves",
  initialState: initialSaveLibrary,
  reducers: {
    libraryLoading: (state) => {
      state.loading = true;
    },
    libraryLoaded: (state, action: PayloadAction<SaveMetadata[]>) => {
      state.entries = action.payload;
      state.loading = false;
      delete state.error;
      for (const id of Object.keys(state.unavailable || {})) {
        if (
          !action.payload.some(
            (entry) =>
              entry.id === id &&
              entry.revision === state.unavailable?.[id].revision,
          )
        )
          delete state.unavailable?.[id];
      }
    },
    libraryFailed: (state, action: PayloadAction<string>) => {
      state.loading = false;
      state.error = action.payload;
    },
    saveUnavailable: (
      state,
      action: PayloadAction<{ id: string; revision: number; message: string }>,
    ) => {
      const { id, revision, message } = action.payload;
      if (
        state.entries.some(
          (entry) => entry.id === id && entry.revision === revision,
        )
      ) {
        state.unavailable ||= {};
        state.unavailable[id] = { revision, message };
      }
    },
    sessionChanged: (
      state,
      action: PayloadAction<Partial<SaveLibraryState>>,
    ) => {
      Object.assign(state, action.payload);
    },
  },
});

export const {
  libraryLoading,
  libraryLoaded,
  libraryFailed,
  sessionChanged,
  saveUnavailable,
} = slice.actions;
export default slice.reducer;
