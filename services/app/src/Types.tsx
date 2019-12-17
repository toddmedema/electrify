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

export interface BuildGeneratorAction extends Redux.Action {
  type: 'BUILD_GENERATOR';
  generator: GeneratorShoppingType;
}

export interface SellGeneratorAction extends Redux.Action {
  type: 'SELL_GENERATOR';
  id: number;
}

export interface ReprioritizeGeneratorAction extends Redux.Action {
  type: 'REPRIORITIZE_GENERATOR';
  spotInList: number;
  delta: number;
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

export interface SetSpeedAction extends Redux.Action {
  type: 'SET_SPEED';
  speed: SpeedType
}

export interface UiDeltaAction extends Redux.Action {
  type: 'UI_DELTA';
  delta: Partial<UIType>;
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

export type MonthType = 'Jan' | 'Feb' | 'Mar' | 'Apr' | 'May' | 'June' | 'July' | 'Aug' | 'Sept' | 'Oct' | 'Nov' | 'Dec';
export type FuelType = 'Coal' | 'Wind' | 'Sun';
export type DifficultyType = 'EASY' | 'NORMAL' | 'HARD' | 'IMPOSSIBLE';
export type SpeedType = 'PAUSED' | 'SLOW' | 'NORMAL' | 'FAST';

export interface DateType {
  minuteOfDay: number;
  hourOfFullYear: number;
  percentOfYear: number; // 0 - 1
  month: MonthType;
  year: number;
  sunrise: number;
  sunset: number;
}

export interface RawWeatherType {
  COOLING_HRS: number;
  HEATING_HRS: number;
  TEMP_C: number;
  CLOUD_PCT_NO: number; // 0 - 1
  CLOUD_PCT_FEW: number; // 0 - 1
  CLOUD_PCT_ALL: number; // 0 - 1
  WIND_KPH: number;
  WIND_PCT_CALM: number; // 0 - 1
}

// All amounts are the average across the time window
export interface TimelineType {
  minute: number;
  supplyW: number; // Watts
  demandW: number; // Watts
  sunlight: number; // 0-1 multiplier
  windKph: number;
  temperatureC: number;
}

export interface GameStateType {
  speed: SpeedType;
  inGame: boolean;
  seedPrefix: number; // actual seed is prefix + the first timestamp in timeline
    // and is supplied as the seed at the start of any function that uses randomness
  currentMinute: number;
  timeline: TimelineType[]; // anything before currentMinute is history, anything after is a forecast

  generators: GeneratorOperatingType[];

  cash: number;
}

export type CardNameType =
  'STORAGE' |
  'FINANCES' |
  'GENERATORS' |
  'MAIN_MENU' |
  'SETTINGS' |
  'TUTORIAL';

export interface CardType {
  name: CardNameType;
  ts: number;
  overrideDebounce?: boolean;
}

export interface GeneratorOperatingType extends GeneratorShoppingType {
  id: number;
}

export interface GeneratorShoppingType {
  name: string;
  fuel: FuelType;
  buildCost: number;
  description: string;
  annualOperatingCost: number;
  peakW: number;
  priority: number; // 1+, lower = higher priority, based on https://www.e-education.psu.edu/ebf200/node/151
  fuelConsumption?: number; // at peak
  spinMinutes?: number;
}

export interface SettingsType {
  [index: string]: any;
  audioEnabled: boolean;
  difficulty: DifficultyType;
  experimental: boolean;
  showHelp: boolean;
  vibration: boolean;
}

export interface UIType {
  snackbar: {
    action?: (e: any) => void;
    actionLabel?: string;
    open: boolean;
    message: string;
    timeout: number;
  }
}

export type TransitionClassType = 'next' | 'prev' | 'instant' | 'nav';

export interface AppStateType {
  audio: AudioType;
  audioData: AudioDataType;
  card: CardType;
  gameState: GameStateType;
  settings: SettingsType;
  ui: UIType;
}
