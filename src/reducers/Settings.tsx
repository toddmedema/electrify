import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  getStorageBooleanOrUndefined,
  getStorageChoice,
  getStorageNumber,
  getStorageString,
  setStorageKeyValue,
} from "../LocalStorage";
import { SettingsType } from "../Types";
import { pause, resume } from "../data/Audio";
import { DEFAULT_UNIT_SYSTEM, UNIT_SYSTEMS } from "../helpers/Units";
import { THEME_CHOICES } from "../Theme";
import { isDesktopApp } from "../Desktop";
import { isInstalledWebApp } from "../InstalledApp";
import { getLocalStorage } from "../Globals";
import {
  migrateInterfaceScale,
  normalizeInterfaceScale,
} from "../InterfaceScale";
import { WORKSPACE_CHOICES, normalizeWorkspace } from "../WorkspaceLayout";
import {
  normalizeScreenEdgePadding,
  SCREEN_EDGE_PADDINGS,
} from "../ScreenEdgePadding";

function storedVolume(key: string): number {
  const value = getStorageNumber(key, 1);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function storedWorkspace(): SettingsType["workspace"] {
  const stored = getLocalStorage().getItem("workspace");
  if (stored !== null)
    return getStorageChoice("workspace", WORKSPACE_CHOICES, "automatic");
  const workspace =
    getStorageBooleanOrUndefined("tvMode") === true ? "single" : "automatic";
  setStorageKeyValue("workspace", workspace);
  return workspace;
}

function storedInterfaceScale(): number {
  const stored = getLocalStorage().getItem("interfaceScale");
  if (stored !== null) {
    try {
      return normalizeInterfaceScale(JSON.parse(stored));
    } catch (_error) {
      return 1;
    }
  }
  const scale = migrateInterfaceScale(
    getStorageString("textSize", "standard"),
    getStorageBooleanOrUndefined("tvMode"),
    getStorageNumber("tvScale", 1.5),
  );
  // Persist once so later layout changes cannot reinterpret old TV preferences.
  setStorageKeyValue("interfaceScale", scale);
  return scale;
}

function storedScreenEdgePadding(): SettingsType["screenEdgePadding"] {
  if (getLocalStorage().getItem("screenEdgePadding") !== null)
    return getStorageChoice("screenEdgePadding", SCREEN_EDGE_PADDINGS, 0);
  // TV padding was active only with an explicitly enabled TV layout. Keep its old
  // 2% default for those players, while new and ordinary desktop players start at zero.
  const padding =
    getStorageBooleanOrUndefined("tvMode") === true
      ? getStorageChoice(
          "tvInset",
          SCREEN_EDGE_PADDINGS,
          getLocalStorage().getItem("tvInset") === null ? 2 : 0,
        )
      : 0;
  setStorageKeyValue("screenEdgePadding", padding);
  return padding;
}

function normalizedChanges(
  payload: Partial<SettingsType>,
): Partial<SettingsType> {
  const changes = { ...payload };
  if (Object.prototype.hasOwnProperty.call(changes, "interfaceScale"))
    changes.interfaceScale = normalizeInterfaceScale(changes.interfaceScale);
  if (Object.prototype.hasOwnProperty.call(changes, "workspace"))
    changes.workspace = normalizeWorkspace(changes.workspace);
  if (Object.prototype.hasOwnProperty.call(changes, "screenEdgePadding"))
    changes.screenEdgePadding = normalizeScreenEdgePadding(
      changes.screenEdgePadding,
    );
  return changes;
}

export const initialSettings: SettingsType = {
  audioEnabled: getStorageBooleanOrUndefined("audioEnabled"),
  musicVolume: storedVolume("musicVolume"),
  soundEffectsVolume: storedVolume("soundEffectsVolume"),
  // getStorageChoice rather than getStorageString so a hand-edited or outdated value falls back
  // to metric instead of reaching the formatters as a system that does not exist
  units: getStorageChoice("units", UNIT_SYSTEMS, DEFAULT_UNIT_SYSTEM),
  // Following the OS is the only default that is right for both kinds of player without being
  // asked, and it is what every other app on their machine does
  theme: getStorageChoice("theme", THEME_CHOICES, "system"),
  interfaceScale: storedInterfaceScale(),
  workspace: storedWorkspace(),
  screenEdgePadding: storedScreenEdgePadding(),
};

// Installed apps start with sound enabled; a saved preference always wins.
if (
  (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) ||
  isInstalledWebApp()
) {
  initialSettings.audioEnabled ??= true;
}

if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
  initialSettings.controllerVibrationEnabled =
    getStorageBooleanOrUndefined("controllerVibrationEnabled") ?? false;
  initialSettings.steamTimelineEnabled =
    getStorageBooleanOrUndefined("steamTimelineEnabled") ?? false;
}

export const settingsSlice = createSlice({
  name: "settings",
  initialState: initialSettings,
  reducers: {
    change: (state, action: PayloadAction<Partial<SettingsType>>) => {
      const changes = normalizedChanges(action.payload);
      // Update values in local storage. Object.entries rather than keys + lookup so the value
      // stays tied to its key's type instead of needing a string index into SettingsType.
      Object.entries(changes).forEach(([key, value]) => {
        setStorageKeyValue(key, value);
      });
      return { ...state, ...changes };
    },
    // Seats share localStorage with the shell; projection must never replace its device choices.
    applyPresentation: (
      state,
      action: PayloadAction<Partial<SettingsType>>,
    ) => ({
      ...state,
      ...normalizedChanges(action.payload),
    }),
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

export const { change, applyPresentation, pauseAudio, resumeAudio } =
  settingsSlice.actions;

export default settingsSlice.reducer;
