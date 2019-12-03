import Redux from 'redux';
import {AudioNode} from './audio/AudioNode';
import {ThemeManager} from './audio/ThemeManager';

export interface AudioSetAction extends Redux.Action {
  type: 'AUDIO_SET';
  delta: Partial<AudioType>;
}

export interface AudioDataSetAction extends Redux.Action {
  type: 'AUDIO_DATA_SET';
  data: Partial<AudioDataType>;
}

export interface NavigateAction extends Redux.Action {
  type: 'NAVIGATE';
  to: CardType;
  dontUpdateUrl: boolean;
}

export interface ChangeSettingsAction extends Redux.Action {
  type: 'CHANGE_SETTINGS';
  settings: Partial<SettingsType>;
}

export interface SnackbarOpenAction extends Redux.Action {
  type: 'SNACKBAR_OPEN';
  message: string;
  action?: (e: any) => void;
  actionLabel?: string;
}

export interface SnackbarCloseAction extends Redux.Action {
  type: 'SNACKBAR_CLOSE';
}

export type AudioLoadingType = 'UNLOADED' | 'LOADING' | 'ERROR' | 'LOADED';
export interface AudioType {
  loaded: AudioLoadingType;
  paused: boolean;
  intensity: number;
  peakIntensity: number;
  sfx: string|null;
  timestamp: number;
}

export interface AudioDataType {
  audioNodes: {[file: string]: AudioNode}|null;
  themeManager: ThemeManager|null;
}

export type SeasonType = 'Spring' | 'Summer' | 'Fall' | 'Winter';

// All amounts are the average for the whole hour
export interface ForecastType {
  hour: number;
  supply: number;
  demand: number;
  solarOutput: number; // 0-1 multiplier
  windOutput: number; // 0-1 multiplier
  temperature: number;
}

export interface GameStateType {
  generators: GeneratorType[];
  cash: number;
  season: SeasonType;
  seedPrefix: number; // actual seed is prefix + turn
    // and is supplied as the seed at the start of any function that uses randomness
  turn: number;
  turnMax: number;
}

export type CardNameType =
  'DEMAND' |
  'FINANCES' |
  'SUPPLY' |
  'MAIN_MENU' |
  'SETTINGS' |
  'SIMULATE' |
  'TUTORIAL';

export interface CardType {
  name: CardNameType;
  ts: number;
  overrideDebounce?: boolean;
}

export type FuelType = 'Coal' | 'Wind' | 'Sun';

export interface GeneratorType {
  name: string;
  fuel: FuelType;
  cost: number;
  peakMW: number;
  fuelConsumption?: number; // at peak
  spinMinutes?: number;
}

export type DifficultyType = 'EASY' | 'NORMAL' | 'HARD' | 'IMPOSSIBLE';

export interface SettingsType {
  [index: string]: any;
  audioEnabled: boolean;
  difficulty: DifficultyType;
  experimental: boolean;
  showHelp: boolean;
  vibration: boolean;
}

export interface SnackbarType {
  action?: (e: any) => void;
  actionLabel?: string;
  open: boolean;
  message: string;
  timeout: number;
}

export type TransitionClassType = 'next' | 'prev' | 'instant' | 'nav';

export interface AppStateType {
  audio: AudioType;
  audioData: AudioDataType;
  card: CardType;
  gameState: GameStateType;
  settings: SettingsType;
  snackbar: SnackbarType;
}
