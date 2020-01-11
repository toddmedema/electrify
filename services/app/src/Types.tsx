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
  financed: boolean;
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

export interface BuildStorageAction extends Redux.Action {
  type: 'BUILD_STORAGE';
  storage: StorageShoppingType;
  financed: boolean;
}

export interface SellStorageAction extends Redux.Action {
  type: 'SELL_STORAGE';
  id: number;
}

export interface ReprioritizeStorageAction extends Redux.Action {
  type: 'REPRIORITIZE_STORAGE';
  spotInList: number;
  delta: number;
}

export interface NavigateAction extends Redux.Action {
  type: 'NAVIGATE';
  to: CardType;
  dontRemember?: boolean;
}

export interface NavigateBackAction extends Redux.Action {
  type: 'NAVIGATE_BACK';
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

export interface QuitGameAction extends Redux.Action {
  type: 'GAME_EXIT';
}

export interface UiDeltaAction extends Redux.Action {
  type: 'UI_DELTA';
  delta: Partial<UIType>;
}

export interface NewGameAction extends Redux.Action {
  type: 'NEW_GAME';
  generators: Partial<GeneratorShoppingType>[];
  cash: number;
  regionPopulation: number;
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
export type FuelNameType = 'Coal' | 'Wind' | 'Sun' | 'Natural Gas' | 'Uranium';
export type DifficultyType = 'EASY' | 'NORMAL' | 'HARD' | 'IMPOSSIBLE';
export type SpeedType = 'PAUSED' | 'SLOW' | 'NORMAL' | 'FAST' | 'LIGHTNING';

export interface DifficultyMultipliersType {
  buildCost: number;
  expensesOM: number;
  buildTime: number;
  blackoutPenalty: number; // for each % of demand unfulfilled, how much the regional growth rate is reduced
}

export type CardNameType =
  'BUILD_GENERATORS' |
  'BUILD_STORAGE' |
  'FACILITIES' |
  'FINANCES' |
  'LOADING' |
  'MAIN_MENU' |
  'SETTINGS' |
  'GAME_SETUP';

export interface CardType {
  name: CardNameType;
  ts: number;
  overrideDebounce?: boolean;
  history: CardNameType[];
}

export interface DateType {
  minute: number;
  minuteOfDay: number;
  hourOfFullYear: number;
  percentOfYear: number; // 0 - 1
  month: MonthType;
  monthNumber: number; // 0 - 11
  year: number;
  sunrise: number;
  sunset: number;
}

export interface RawWeatherType {
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

export interface MonthlyHistoryType {
  year: number;
  month: number;
  supplyWh: number; // total
  demandWh: number; // total
  kgco2e: number; // total
  cash: number; // ending (this is a live value in the current month)
  netWorth: number; // ending
  revenue: number; // total
  expensesFuel: number; // total
  expensesOM: number; // total
  expensesTaxesFees: number; // total
  expensesInterest: number; // total - only the interest payments count as an expense, the rest is just a settling of balances between cash and liability
}




export interface FuelType {
  costPerBtu: number; // Measured from raw stock / before generator efficiency loss
    // all costs should be in that year's $ / not account for inflation when possible
  kgCO2ePerBtu: number; // Measured from raw stock / before generator efficiency loss
}

export interface GeneratorOperatingType extends GeneratorShoppingType, LoanInfo {
  id: number;
  currentW: number;
  yearsToBuildLeft: number;
}

export interface StorageOperatingType extends StorageShoppingType, LoanInfo {
  id: number;
  currentWh: number;
  yearsToBuildLeft: number;
}

interface LoanInfo {
  loanAmountTotal: number;
  loanAmountLeft: number;
  loanMonthlyPayment: number;
}

export interface StorageShoppingType extends SharedShoppingType {
  peakWh: number;
  maxPeakWh: number; // Maximum size the technology is currently buildable
  roundTripEfficiency: number; // 0 - 1, percentage (even though it's round trip, applied when inserting so capacity looks correct-to-user)
  hourlyLoss: number; // 0 - 1, percentage (water evaporation, heat loss, etc)
}

export interface GeneratorShoppingType extends SharedShoppingType {
  fuel: FuelNameType;
  maxPeakW: number; // Maximum size the technology is currently buildable
  capacityFactor: number; // 0 - 1, percent of theoretical output actually produced across a year
  spinMinutes: number; // 1 for renewables, to avoid eating up CPU on coersing to 1 in case it doesn't exist
  btuPerWh: number; // Heat Rate, but per W for less math per frame
}

interface SharedShoppingType {
  [index: string]: any;
  name: string;
  description: string;
  buildCost: number; // Partially fixed, partially variable (such as size dependent)
    // When more information is not available, assume that average costs = 1/4 fixed (for avg size), 3/4 variable
    // all costs should be in that year's $ / not account for inflation when possible
  annualOperatingCost: number;
    // all costs should be in that year's $ / not account for inflation when possible
  peakW: number;
  lifespanYears: number;
  yearsToBuild: number;
  priority: number; // 1+, lower = higher priority, based on https://www.e-education.psu.edu/ebf200/node/151
}




export interface GameStateType {
  difficulty: DifficultyType;
  speed: SpeedType;
  inGame: boolean;
  seedPrefix: number; // actual seed is prefix + the first timestamp in timeline
    // and is supplied as the seed at the start of any function that uses randomness
  date: DateType;
  timeline: TimelineType[]; // anything before currentMinute is history, anything after is a forecast
  monthlyHistory: MonthlyHistoryType[]; // live updated; for calculation simplicity, 0 = most recent (prepend new entries)
  generators: GeneratorOperatingType[];
  storage: StorageOperatingType[];
  regionPopulation: number;
}

export interface SettingsType {
  [index: string]: any;
  audioEnabled: boolean;
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
