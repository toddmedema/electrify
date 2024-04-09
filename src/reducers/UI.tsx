import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DialogType, SnackbarType, UIType } from "../Types";
import { quit } from "./Game";

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
  },
  extraReducers: (builder) => {
    builder.addCase(quit, (state) => {
      state.snackbar = { ...initialUI.snackbar };
      state.dialog = { ...initialUI.dialog };
    });
  },
});

export const { delta, snackbarOpen, snackbarClose, dialogOpen, dialogClose } =
  uiSlice.actions;

export default uiSlice.reducer;
