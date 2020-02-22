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

export interface BuildFacilityAction extends Redux.Action {
  type: 'BUILD_FACILITY';
  facility: FacilityShoppingType;
  financed: boolean;
}

export interface SellFacilityAction extends Redux.Action {
  type: 'SELL_FACILITY';
  id: FacilityOperatingType["id"];
}

export interface ReprioritizeFacilityAction extends Redux.Action {
  type: 'REPRIORITIZE_FACILITY';
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
  timeout?: number;
}

export interface SnackbarCloseAction extends Redux.Action {
  type: 'SNACKBAR_CLOSE';
}

export interface DialogOpenAction extends Redux.Action {
  type: 'DIALOG_OPEN';
  dialog: DialogType;
}

export interface DialogCloseAction extends Redux.Action {
  type: 'DIALOG_CLOSE';
}

export interface SetSpeedAction extends Redux.Action {
  type: 'SET_SPEED';
  speed: SpeedType
}

export interface QuitGameAction extends Redux.Action {
  type: 'GAME_EXIT';
}

export interface StartGameAction extends Redux.Action {
  type: 'GAME_START';
  delta: Partial<GameStateType>;
}

export interface UiDeltaAction extends Redux.Action {
  type: 'UI_DELTA';
  delta: Partial<UIType>;
}

export interface NewGameAction extends Redux.Action {
  type: 'NEW_GAME';
  facilities: Partial<FacilityShoppingType>[];
  cash: number;
  customers: number;
}

export type AudioLoadingType = 'UNLOADED' | 'LOADING' | 'ERROR' | 'LOADED';
export interface AudioType {
  loaded: AudioLoadingType;
  paused: boolean;
  intensity: number;
  sfx: string|null;
  timestamp: number;
}

export interface AudioDataType {
  audioNodes: {[file: string]: AudioNode}|null;
  themeManager: ThemeManager|null;
}

export type MonthType = 'Jan' | 'Feb' | 'Mar' | 'Apr' | 'May' | 'Jun' | 'Jul' | 'Aug' | 'Sep' | 'Oct' | 'Nov' | 'Dec';
export type DifficultyType = 'Intern' | 'Employee' | 'Manager' | 'VP' | 'CEO';
export type SpeedType = 'PAUSED' | 'SLOW' | 'NORMAL' | 'FAST';

export type FuelNameType = 'Coal' | 'Wind' | 'Sun' | 'Natural Gas' | 'Uranium';
export interface FuelPricesType {
  [index: string]: number;
  'Natural Gas': number; // $/btu
  Coal: number; // $/btu
  Uranium: number; // $/btu
}

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
  'FORECASTS' |
  'LOADING' |
  'MAIN_MENU' |
  'NEW_GAME' |
  'NEW_GAME_DETAILS' |
  'MANUAL' |
  'SETTINGS' |
  'TUTORIALS' |
  'CUSTOM_GAME';

export interface CardType {
  name: CardNameType;
  ts: number;
  history: CardNameType[];
  overrideDebounce?: boolean;
  toPrevious?: boolean;
}

export interface ScoreType {
  scenarioId: number;
  score: number;
  difficulty: string;
  date: string;
  username?: string;
}

export interface LocalStoragePlayedType {
  scenarioId: number;
  date: string; // Stringified new Date()
}

export interface DateType {
  minute: number;
  minuteOfDay: number;
  hourOfFullYear: number;
  percentOfMonth: number; // 0 - 1
  percentOfYear: number; // 0 - 1
  month: MonthType;
  monthNumber: number; // 1 - 12
  monthsEllapsed: number;
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
export type TickPresentFutureType = Partial<FuelPricesType> & HistoryForecastShared & {
  minute: number;
  supplyW: number; // Watts
  demandW: number; // Watts
  sunlight: number; // 0-1 multiplier
  windKph: number;
  temperatureC: number;
}

export type DerivedHistoryKeysType = keyof DerivedHistoryType;
export interface DerivedHistoryType extends MonthlyHistoryType {
  profit: number;
  profitPerkWh: number;
  revenuePerkWh: number;
  expenses: number;
  kgco2ePerMWh: number;
}

// Basically, downsample per-tick information so that I can store it for the entire game, which could go 100+ years
export interface MonthlyHistoryType extends HistoryForecastShared {
  year: number;
  month: number;
  supplyWh: number; // total
  demandWh: number; // total
}

interface HistoryForecastShared {
  cash: number;
  customers: number;
  netWorth: number;
  revenue: number; // total
  expensesFuel: number; // total
  expensesOM: number; // total
  expensesCarbonFee: number; // total
  expensesInterest: number; // total - only the interest payments count as an expense, the rest is just a settling of balances between cash and liability
  expensesMarketing: number; // total
  kgco2e: number; // total
}




export interface FuelType {
  // costPerBtu: number; // Measured from raw stock / before generator efficiency loss
    // all costs should be in that year's $ / not account for inflation when possible
  kgCO2ePerBtu: number; // Measured from raw stock / before generator efficiency loss
}

export type FacilityOperatingType = GeneratorOperatingType | StorageOperatingType;

export interface GeneratorOperatingType extends GeneratorShoppingType, LoanInfo {
  id: number; // Monotonically increasing
  currentW: number;
  yearsToBuildLeft: number;
  minuteCreated: number; // That the user clicked buy, not construction complete
}

export interface StorageOperatingType extends StorageShoppingType, LoanInfo {
  id: number; // Monotonically increasing
  currentWh: number;
  yearsToBuildLeft: number;
  minuteCreated: number; // That the user clicked buy, not construction complete
}

interface LoanInfo {
  loanAmountTotal: number;
  loanAmountLeft: number;
  loanMonthlyPayment: number;
}

export type FacilityShoppingType = StorageShoppingType | GeneratorShoppingType;

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
  available: boolean;
  buildCost: number; // Partially fixed, partially variable (such as size dependent)
    // When more information is not available, assume that average costs = 1/4 fixed (for avg size), 3/4 variable
    // all costs should be in that year's $ / not account for inflation when possible
  annualOperatingCost: number;
    // all costs should be in that year's $ / not account for inflation when possible
  peakW: number;
  lifespanYears: number;
  yearsToBuild: number;
}

export interface TutorialStepType {
  disableBeacon?: boolean;
  onNext?: () => Redux.Action;
  target: string;
  content: JSX.Element;
}

export interface ScenarioType {
  id: number;
  name: string;
  icon: string; // assumed to be images/<string>.svg
  summary?: string;
  tutorialSteps?: TutorialStepType[];
  startingYear: number;
  durationMonths: number;
  endTitle?: string;
  endMessage?: string;
  feePerKgCO2e: number;
  facilities: Partial<FacilityShoppingType>[];
}




export interface GameStateType {
  difficulty: DifficultyType;
  scenarioId: number;
  speed: SpeedType;
  inGame: boolean;
  feePerKgCO2e: number;
  monthlyMarketingSpend: number;
  tutorialStep: number;
  seedPrefix: number; // actual seed is prefix + the first timestamp in timeline
    // and is supplied as the seed at the start of any function that uses randomness
  date: DateType;
  startingYear: number;
  timeline: TickPresentFutureType[]; // anything before currentMinute is history, anything after is a forecast
  monthlyHistory: MonthlyHistoryType[]; // live updated; for calculation simplicity, 0 = most recent (prepend new entries)
  facilities: (StorageOperatingType|GeneratorOperatingType)[];
}

export interface SettingsType {
  [index: string]: any;
  audioEnabled: boolean;
  experimental: boolean;
  showHelp: boolean;
  vibration: boolean;
}

export interface DialogType {
  message: string | JSX.Element | JSX.Element[];
  title: string;
  action?: (e: any) => void;
  actionLabel?: string;
  notCancellable?: boolean;
  closeText?: string;
  open: boolean,
}

export interface UIType {
  dialog: DialogType,
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
