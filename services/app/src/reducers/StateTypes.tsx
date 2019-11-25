import {UserState as UserStateBase} from 'shared/auth/UserState';
import {AudioNode} from '../audio/AudioNode';
import {ThemeManager} from '../audio/ThemeManager';

export interface AnnouncementState {
  open: boolean;
  message: string;
  link?: string;
}

export interface ServerStatusState {
  announcement: AnnouncementState;
  isLatestAppVersion: boolean;
}

export interface UserState extends UserStateBase {
}

export type AudioLoadingType = 'UNLOADED' | 'LOADING' | 'ERROR' | 'LOADED';
export interface AudioState {
  loaded: AudioLoadingType;
  paused: boolean;
  intensity: number;
  peakIntensity: number;
  sfx: string|null;
  timestamp: number;
}

export interface AudioDataState {
  audioNodes: {[file: string]: AudioNode}|null;
  themeManager: ThemeManager|null;
}

export type DifficultyType = 'EASY' | 'NORMAL' | 'HARD' | 'IMPOSSIBLE';
export type FontSizeType = 'SMALL' | 'NORMAL' | 'LARGE';

export interface SettingsType {
  [index: string]: any;
  audioEnabled: boolean;
  difficulty: DifficultyType;
  experimental: boolean;
  fontSize: FontSizeType;
  showHelp: boolean;
  vibration: boolean;
}

export interface SnackbarState {
  action?: (e: any) => void;
  actionLabel?: string;
  open: boolean;
  message: string;
  timeout: number;
}

export type CardName =
  'TUTORIAL_QUESTS' |
  'SPLASH_CARD' |
  'SETTINGS';

export interface CardState {
  name: CardName;
  ts: number;
  key: string;
  overrideDebounce?: boolean;
}

export type TransitionClassType = 'next' | 'prev' | 'instant' | 'nav';

// AppStateBase is what's stored in AppState._history.
// It contains all the reduced state that should be restored
// to the redux main state when the "<" button is pressed in
// the UI. Notably, it excludes "permanent" attributes
// such as settings.
export interface AppStateBase {
  audio: AudioState;
  card: CardState;
}

export interface AppState extends AppStateBase {
  audioData: AudioDataState;
  serverstatus: ServerStatusState;
  settings: SettingsType;
  snackbar: SnackbarState;
  user: UserState;
}
