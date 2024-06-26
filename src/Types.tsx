import Redux from "redux";

export type AudioLoadingType = "UNLOADED" | "LOADING" | "ERROR" | "LOADED";
export interface AudioType {
  paused: boolean;
}

export type MonthType =
  | "Jan"
  | "Feb"
  | "Mar"
  | "Apr"
  | "May"
  | "Jun"
  | "Jul"
  | "Aug"
  | "Sep"
  | "Oct"
  | "Nov"
  | "Dec";
export type DifficultyType = "Intern" | "Employee" | "Manager" | "VP" | "CEO";
export type SpeedType = "PAUSED" | "SLOW" | "NORMAL" | "FAST";

export type LocationIdType = "PIT" | "SF" | "HNL" | "SJU";
export interface LocationType {
  id: LocationIdType;
  name: string;
  lat: number;
  long: number;
}

export type FuelNameType =
  | "Coal"
  | "Wind"
  | "Sun"
  | "Natural Gas"
  | "Uranium"
  | "Oil";
export interface FuelPricesType {
  [index: string]: number;
  "Natural Gas": number; // $/btu
  Coal: number; // $/btu
  Uranium: number; // $/btu
  Oil: number; // $/btu
}
export interface FuelProductionType {
  [index: string]: number | undefined;
  "Natural Gas"?: number; // wh
  Coal?: number; // wh
  Uranium?: number; // wh
  Oil?: number; // wh
  Sun?: number; // wh
  Wind?: number; //wh
}

export interface DifficultyMultipliersType {
  buildCost: number;
  expensesOM: number;
  buildTime: number;
  blackoutPenalty: number; // for each % of demand unfulfilled, how much the regional growth rate is reduced
}

export type CardNameType =
  | "BUILD_GENERATORS"
  | "BUILD_STORAGE"
  | "FACILITIES"
  | "FINANCES"
  | "FORECASTS"
  | "LOADING"
  | "MAIN_MENU"
  | "NEW_GAME"
  | "NEW_GAME_DETAILS"
  | "MANUAL"
  | "SETTINGS"
  | "CUSTOM_GAME";

export interface CardType {
  name: CardNameType;
  ts: number;
  history?: CardNameType[];
  toPrevious?: boolean;
}

export interface ScoreType {
  scenarioId: number;
  score: number;
  scoreBreakdown: any;
  difficulty: string;
  date: any; // serverTimestamp from Firestore
  uid: string;
}

export interface LocalStoragePlayedType {
  scenarioId: number;
  date: string; // Stringified new Date()
}

export interface DateType {
  minute: number;
  minuteOfDay: number; // 0 - 1439
  hourOfDay: number; // 0 - 23
  hourOfFullYear: number;
  percentOfMonth: number; // 0 - 1
  percentOfYear: number; // 0 - 1
  month: MonthType;
  monthNumber: number; // 1 - 12
  monthsEllapsed: number;
  year: number;
}

export interface RawWeatherType {
  YEAR: number;
  MONTH: number;
  TEMP_C: number;
  CLOUD_PCT: number; // 0 - 100
  WIND_KPH: number;
}

// All amounts are the average across the time window
export type TickPresentFutureType = Partial<FuelPricesType> &
  HistoryForecastShared & {
    minute: number;
    supplyW: number; // Watts
    demandW: number; // Watts
    solarIrradianceWM2: number;
    windKph: number;
    temperatureC: number;
    storedWh: number;
    supplyByFuel: FuelProductionType;
  };

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

export type FacilityOperatingType =
  | GeneratorOperatingType
  | StorageOperatingType;

export interface GeneratorOperatingType
  extends GeneratorShoppingType,
    LoanInfo {
  id: number; // Monotonically increasing
  currentW: number;
  yearsToBuildLeft: number;
  minuteCreated: number; // That the user clicked buy, not construction complete
  paused: boolean;
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
  locationId: LocationIdType;
  summary?: string;
  ownership: "Investor" | "Public";
  tutorialSteps?: TutorialStepType[];
  startingYear: number;
  cash: number;
  dollarsPerkWh: number;
  durationMonths: number;
  endTitle?: string;
  endMessage?: string;
  feePerKgCO2e: number;
  facilities: Array<Partial<FacilityShoppingType>>;
}

export interface GameType {
  seed: number;
  difficulty: DifficultyType;
  scenarioId: number;
  location: LocationType;
  speed: SpeedType;
  inGame: boolean;
  feePerKgCO2e: number;
  dollarsPerkWh: number;
  monthlyMarketingSpend: number;
  tutorialStep: number;
  date: DateType;
  startingYear: number;
  timeline: TickPresentFutureType[]; // anything before currentMinute is history, anything after is a forecast
  monthlyHistory: MonthlyHistoryType[]; // live updated; for calculation simplicity, 0 = most recent (prepend new entries)
  facilities: Array<StorageOperatingType | GeneratorOperatingType>;
}

export interface SettingsType {
  [index: string]: any;
  audioEnabled?: boolean;
}

export interface DialogType {
  message: string | JSX.Element | JSX.Element[];
  title: string;
  action?: (e: any) => void;
  actionLabel?: string;
  notCancellable?: boolean;
  closeText?: string;
  open: boolean;
}

export interface SnackbarType {
  action?: (e: any) => void;
  actionLabel?: string;
  open: boolean;
  message: string;
  timeout: number;
}

export interface UIType {
  dialog: DialogType;
  snackbar: SnackbarType;
}

export interface UserType {
  uid?: string;
}

export type TransitionClassType = "next" | "prev" | "instant" | "nav";

export interface AppStateType {
  card: CardType;
  game: GameType;
  settings: SettingsType;
  ui: UIType;
  user: UserType;
}
