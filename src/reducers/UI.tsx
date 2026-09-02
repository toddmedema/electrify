import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DialogType, SnackbarType, UIType, VictoryType } from "../Types";
import { quit } from "./GameActions";

export const initialUI: UIType = {
  dialog: {
    title: "",
    message: "",
    open: false,
  },
  snackbar: {
    message: "",
    open: false,
    timeout: 6000,
  },
  victory: null,
  selectedFacilityId: null,
  facilityDragActive: false,
};

export const uiSlice = createSlice({
  name: "ui",
  initialState: initialUI,
  reducers: {
    delta: (state, action: PayloadAction<Partial<UIType>>) => {
      return { ...state, ...action.payload };
    },
    snackbarOpen: (state, action: PayloadAction<string | SnackbarType>) => {
      if (typeof action.payload === "string") {
        return {
          ...state,
          snackbar: {
            message: action.payload,
            open: true,
            timeout: initialUI.snackbar.timeout,
          },
        };
      } else if (action.payload.message && action.payload.message !== "") {
        return {
          ...state,
          snackbar: {
            message: action.payload.message,
            open: true,
            timeout: action.payload.timeout || initialUI.snackbar.timeout,
            action: action.payload.action,
            actionLabel: action.payload.actionLabel,
          },
        };
      }
    },
    snackbarClose: (state) => {
      state.snackbar = { ...initialUI.snackbar };
    },
    dialogOpen: (state, action: PayloadAction<DialogType>) => {
      state.dialog = { ...action.payload };
    },
    dialogClose: (state) => {
      state.dialog = { ...initialUI.dialog };
    },
    // The score screen for a run that just ended. Separate from dialogOpen because the victory
    // dialog is a component rather than a title and a message: it fills in the personal best and
    // the global rank as those resolve, which a snapshot of JSX cannot do
    victoryOpen: (state, action: PayloadAction<VictoryType>) => {
      state.victory = { ...action.payload };
    },
    victoryClose: (state) => {
      state.victory = null;
    },
    // Null deselects. Clicking the row that's already selected sends null rather than its own id,
    // so the pane doesn't need a second action to close itself
    selectFacility: (state, action: PayloadAction<number | null>) => {
      state.selectedFacilityId = action.payload;
    },
    setFacilityDragActive: (state, action: PayloadAction<boolean>) => {
      state.facilityDragActive = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(quit, (state) => {
      state.snackbar = { ...initialUI.snackbar };
      state.dialog = { ...initialUI.dialog };
      state.victory = null;
      state.selectedFacilityId = null;
      state.facilityDragActive = false;
    });
  },
});

export const {
  delta,
  snackbarOpen,
  snackbarClose,
  dialogOpen,
  dialogClose,
  victoryOpen,
  victoryClose,
  selectFacility,
  setFacilityDragActive,
} = uiSlice.actions;

export default uiSlice.reducer;
