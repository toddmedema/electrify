import { createAction, createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  DialogType,
  SnackbarType,
  UIType,
  VictoryType,
  EvidenceTargetType,
  EvidenceRequestType,
} from "../Types";
import { launchRun, quit, start, resume, loaded } from "./GameActions";
import {
  manualHelpOpen,
  manualHelpClose,
  dialogOpen,
  dialogClose,
  snackbarOpen,
  victoryOpen,
  victoryClose,
} from "./GameActions";
import { navigate, navigateBack } from "./Card";

// Re-evaluate layout-dependent tutorial gates even while the simulation is paused.
export const layoutChanged = createAction("ui/layoutChanged");

export const initialUI: UIType = {
  dialog: {
    title: "",
    message: "",
    open: false,
  },
  snackbar: {
    message: "",
    open: false,
    timeout: 3500,
  },
  victory: null,
  selectedFacilityId: null,
  facilityDragActive: false,
};

export const uiSlice = createSlice({
  name: "ui",
  initialState: initialUI,
  reducers: {
    // Highlight the new row without expanding it: its controls are rarely the next decision
    facilityPurchased: (state, action: PayloadAction<number>) => {
      state.arrivingFacilityId = action.payload;
    },
    acknowledgeFacilityArrival: (state, action: PayloadAction<number>) => {
      if (state.arrivingFacilityId === action.payload) {
        delete state.arrivingFacilityId;
      }
    },
    requestEvidence: (state, action: PayloadAction<EvidenceTargetType>) => {
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
    delta: (state, action: PayloadAction<Partial<UIType>>) => {
      return { ...state, ...action.payload };
    },
    snackbarClose: (state) => {
      state.snackbar = { ...initialUI.snackbar };
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
    builder.addCase(manualHelpOpen, (state, action: PayloadAction<string>) => {
      state.manualHelpEntry = action.payload;
    });
    builder.addCase(manualHelpClose, (state) => {
      delete state.manualHelpEntry;
    });
    builder.addCase(
      snackbarOpen,
      (state, action: PayloadAction<string | SnackbarType>) => {
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
              overModal: action.payload.overModal,
            },
          };
        }
      },
    );
    builder.addCase(dialogOpen, (state, action: PayloadAction<DialogType>) => {
      state.dialog = { ...action.payload };
    });
    builder.addCase(dialogClose, (state) => {
      state.dialog = { ...initialUI.dialog };
    });
    builder.addCase(
      victoryOpen,
      (state, action: PayloadAction<VictoryType>) => {
        state.victory = { ...action.payload };
      },
    );
    builder.addCase(victoryClose, (state) => {
      state.victory = null;
    });
    builder.addCase(quit, (state) => {
      delete state.dataCenterGuideRequested;
      delete state.arrivingFacilityId;
      state.snackbar = { ...initialUI.snackbar };
      state.dialog = { ...initialUI.dialog };
      state.victory = null;
      delete state.manualHelpEntry;
      state.selectedFacilityId = null;
      state.facilityDragActive = false;
      delete state.evidenceRequest;
      delete state.insightsViewport;
      state.evidenceRunId = (state.evidenceRunId ?? 0) + 1;
    });
    builder.addMatcher(
      (action) =>
        [start.type, resume.type, launchRun.type].includes(action.type),
      (state) => {
        delete state.dataCenterGuideRequested;
      },
    );
    builder.addMatcher(
      (action) =>
        [
          start.type,
          resume.type,
          launchRun.type,
          loaded.type,
          "game/initGame",
        ].includes(action.type),
      (state) => {
        delete state.arrivingFacilityId;
        delete state.evidenceRequest;
        delete state.insightsViewport;
        state.evidenceRunId = (state.evidenceRunId ?? 0) + 1;
      },
    );
    builder.addMatcher(
      (action) =>
        action.type === navigate.type || action.type === navigateBack.type,
      (state) => {
        delete state.evidenceRequest;
      },
    );
  },
});

export {
  manualHelpOpen,
  manualHelpClose,
  dialogOpen,
  dialogClose,
  snackbarOpen,
  victoryOpen,
  victoryClose,
} from "./GameActions";
export const {
  facilityPurchased,
  acknowledgeFacilityArrival,
  requestEvidence,
  acknowledgeEvidence,
  delta,
  snackbarClose,
  selectFacility,
  setFacilityDragActive,
} = uiSlice.actions;

export default uiSlice.reducer;
