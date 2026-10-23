import type { DifficultyType } from "./Types";
// Compile-time switch: web production builds set REACT_APP_DESKTOP=false, so webpack drops
// desktop branches and the chunks they import. Webpack can only evaluate the env var itself,
// not an imported constant, so call sites test `process.env.REACT_APP_DESKTOP === "true"`
// inline before calling isDesktopApp().
export const DESKTOP_BUILD = process.env.REACT_APP_DESKTOP === "true";

export interface DesktopDisplay {
  fullscreen: boolean;
  width: number;
  height: number;
  resolutions: { width: number; height: number }[];
}
export interface DesktopPowerState {
  phase: "awake" | "suspended" | "resuming";
  generation: number;
}
export interface DesktopState {
  power?: DesktopPowerState;
  display: DesktopDisplay;
  steam: {
    available: boolean;
    online: boolean;
    steamId?: string;
    displayName?: string;
    cloudEnabled: boolean;
    timelineSupported?: boolean;
  };
}
export interface DesktopScore {
  steamId: string;
  displayName: string;
  score: number;
  rank: number;
  scenarioId: number;
  difficulty: DifficultyType;
}
export type DesktopCloudState = "disabled" | "offline" | "ready" | "failed";
export interface DesktopActivity {
  phase:
    "loading" | "menu" | "playing" | "paused" | "replay" | "victory" | "ended";
  scenarioId?: number;
  year?: number;
  totalYears?: number;
  timelineEnabled: boolean;
}
export interface DesktopTimelineEvent {
  runId: string;
  eventId: string;
  kind: "construction" | "blackout" | "recovery" | "victory";
  scenarioId: number;
  year: number;
}
export type DesktopInputContext = "Menu" | "Gameplay";
export type DesktopInputAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "pause"
  | "speedUp"
  | "speedDown"
  | "previousPane"
  | "nextPane"
  | "build"
  | "previousChart"
  | "nextChart";
export interface DesktopInputFrame {
  connected: boolean;
  disconnected?: boolean;
  actions: DesktopInputAction[];
  glyphs: Partial<
    Record<DesktopInputAction, { label: string; image?: string }>
  >;
}
export interface DesktopTextInput {
  description: string;
  text: string;
  maxLength: number;
  multiline: boolean;
  password: boolean;
}
export type DesktopTextInputResult =
  | { status: "submitted"; text: string }
  | { status: "cancelled" | "unavailable" };
export interface DesktopBridge {
  // Optional methods are feature-detected by the renderer, so adding one never bumps apiVersion.
  // apiVersion changes only when an existing method changes incompatibly.
  mods?(
    input: import("./mods/Types").ModRequest,
  ): Promise<import("./mods/Types").ModLibrary>;
  setInputContext?(context: DesktopInputContext): Promise<DesktopInputFrame>;
  onPowerStateChanged?(
    callback: (power: DesktopPowerState) => void,
  ): () => void;
  readyAfterResume?(generation: number): Promise<void>;
  onInput?(callback: (frame: DesktopInputFrame) => void): () => void;
  showTextInput?(input: DesktopTextInput): Promise<DesktopTextInputResult>;
  multiplayerRequest?(
    input: import("./multiplayer/Native").NativeRequest,
  ): Promise<unknown>;
  onMultiplayerEvent?(
    callback: (event: import("./multiplayer/Native").NativeEvent) => void,
  ): () => void;
  apiVersion: 1;
  getState(): Promise<DesktopState>;
  setDisplay(
    display: Pick<DesktopDisplay, "fullscreen" | "width" | "height">,
  ): Promise<DesktopDisplay>;
  onStateChanged(callback: (state: DesktopState) => void): () => void;
  onGameFocusChanged(callback: (focused: boolean) => void): () => void;
  quit(): Promise<void>;
  onBeforeQuit(callback: () => void): () => void;
  readyToQuit(success?: boolean): void;
  readSaveLibrary(): Promise<{
    local: unknown | null;
    cloud: unknown | null;
    cloudCopies?: unknown[];
    cloudState: DesktopCloudState;
  }>;
  writeSaveLibrary(
    library: unknown,
    syncCloud?: boolean,
  ): Promise<{ cloudState: DesktopCloudState }>;
  getLeaderboard(request: {
    scenarioId: number;
    difficulty?: DifficultyType;
    scope: "global" | "friends" | "player";
    challengeId?: string;
  }): Promise<DesktopScore[]>;
  submitScore(score: {
    appVersion?: string;
    scenarioId: number;
    difficulty: DifficultyType;
    score: number;
    challengeId?: string;
  }): Promise<void>;
  openFriends(): Promise<void>;
  submitAchievements?(intent: {
    earned: string[];
    completion?: { scenarioId: number; difficulty: DifficultyType };
  }): Promise<void>;
  readAchievements?(): Promise<
    import("./achievements/Progress").AchievementRecord
  >;
  setActivity?(activity: DesktopActivity): Promise<void>;
  addTimelineEvent?(event: DesktopTimelineEvent): Promise<void>;
}

declare global {
  interface Window {
    electrifyDesktop?: DesktopBridge;
  }
}

/** The isolated preload is the only native capability available to the renderer. */
export function getDesktop(): DesktopBridge | undefined {
  if (!DESKTOP_BUILD) return undefined;
  return typeof window !== "undefined" &&
    window.electrifyDesktop?.apiVersion === 1
    ? window.electrifyDesktop
    : undefined;
}
export const isDesktopApp = DESKTOP_BUILD
  ? (): boolean => !!getDesktop()
  : (): boolean => false;
