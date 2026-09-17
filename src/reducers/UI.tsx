import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  DialogType,
  SnackbarType,
  UIType,
  VictoryType,
  EvidenceTargetType,
  EvidenceRequestType,
} from "../Types";
import { quit, start, resume, startReplay, loaded } from "./GameActions";
import { navigate, navigateBack } from "./Card";

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
    requestEvidence: (state, action: PayloadAction<EvidenceTargetType>) => {
      delete state.evidenceJourney;
      delete state.insightsRestore;
      const id = (state.evidenceSequence ?? 0) + 1;
      state.evidenceSequence = id;
      state.evidenceRequest = {
        id,
        runId: state.evidenceRunId ?? 0,
        target: action.payload,
      };
    },
    acknowledgeEvidence: (
      state,
      action: PayloadAction<Pick<EvidenceRequestType, "id" | "runId">>,
    ) => {
      if (
        state.evidenceRequest?.id === action.payload.id &&
        state.evidenceRequest.runId === action.payload.runId
      ) {
        delete state.evidenceRequest;
      }
    },
    manualHelpOpen: (state, action: PayloadAction<string>) => {
      state.manualHelpEntry = action.payload;
    },
    manualHelpClose: (state) => {
      delete state.manualHelpEntry;
    },
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
      delete state.manualHelpEntry;
      state.selectedFacilityId = null;
      state.facilityDragActive = false;
      delete state.evidenceRequest;
      delete state.evidenceJourney;
      delete state.evidenceJourneyMarker;
      delete state.insightsRestore;
      state.evidenceRunId = (state.evidenceRunId ?? 0) + 1;
    });
    builder.addMatcher(
      (action) =>
        [
          start.type,
          resume.type,
          startReplay.type,
          loaded.type,
          "game/initGame",
        ].includes(action.type),
      (state) => {
        delete state.evidenceRequest;
        delete state.evidenceJourney;
        delete state.evidenceJourneyMarker;
        delete state.insightsRestore;
        state.evidenceRunId = (state.evidenceRunId ?? 0) + 1;
      },
    );
    builder.addMatcher(
      (action) =>
        action.type === navigate.type || action.type === navigateBack.type,
      (state, action) => {
        delete state.evidenceRequest;
        const payload = (
          action as PayloadAction<import("../Types").NavigateActionType>
        ).payload;
        if (
          !payload?.journeyMarker ||
          payload.journeyMarker.id !== state.evidenceJourney?.id
        )
          delete state.evidenceJourney;
        delete state.insightsRestore;
      },
    );
  },
});

export const {
  requestEvidence,
  acknowledgeEvidence,
  manualHelpOpen,
  manualHelpClose,
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
