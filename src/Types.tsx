import type { FieldValue, Timestamp } from "firebase/firestore";
import type * as React from "react";
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

// Deliberately open rather than a union of the places that happen to ship today: a custom game
// may hold a location that isn't in LOCATIONS at all, so nothing is allowed to key off the
// closed set. Resolve one through getLocation / getScenarioLocation rather than indexing
// LOCATIONS directly, and check anything untrusted with isValidLocationId -- the id ends up in
// the path of a weather file.
export type LocationIdType = string;
export interface LocationType {
  id: LocationIdType;
  name: string;
  lat: number;
  long: number;
  // IANA zone, so sun times come out in the location's own local time rather than in whichever
  // one the player's computer happens to be set to
  timeZone: string;
}

export type FuelNameType =
  "Coal" | "Wind" | "Sun" | "Natural Gas" | "Uranium" | "Oil";
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
  description: string; // shown in a tooltip on the difficulty picker
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

// What the card reducer's navigate action accepts, beyond a bare card name
export interface NavigateActionType {
  name: CardNameType;
  dontRemember?: boolean;
  // Manual entry to open and scroll to, for deep links from terms the game shows elsewhere
  entry?: string;
}

export interface CardType {
  name: CardNameType;
  ts: number;
  history?: CardNameType[];
  toPrevious?: boolean;
  entry?: string;
}

// The per-category points that sum to `score`. Investor and public-ownership scenarios are
// scored on different categories (see reducers/Game), so the keys vary by scenario.
export type ScoreBreakdownType = Record<string, number>;

export interface ScoreType {
  scenarioId: number;
  score: number;
  scoreBreakdown: ScoreBreakdownType;
  difficulty: string;
  // A FieldValue on the way out (serverTimestamp() is resolved by Firestore, not by us) and a
  // Timestamp on the way back in
  date: Timestamp | FieldValue;
  uid: string;
  // Id of the document in the `replays` collection holding the run that set this score, when one
  // was small enough to keep. A reference rather than the replay itself, so that opening a
  // leaderboard downloads fifty scores instead of fifty replays
  replayId?: string;
}

// The player actions a replay has to reproduce. Everything else about a run -- weather, fuel
// prices, demand -- falls out of the seed, so this is the whole of what the player contributed.
export type ReplayActionNameType =
  | "buildFacility"
  | "sellFacility"
  | "togglePauseFacility"
  | "reprioritizeFacility"
  | "delta";

export interface ReplayActionType {
  // Game minute the action was taken at, which is always a tick boundary
  minute: number;
  type: ReplayActionNameType;
  // The reducer's own payload, verbatim. Untyped here because it differs per action and comes
  // back off the network as untrusted JSON; decodeReplay is what makes it safe to apply
  payload: unknown;
}

export interface ReplayType {
  version: number;
  appVersion: string; // For bug reports
  scenarioId: number;
  difficulty: DifficultyType;
  seed: number;
  startingYear: number;
  // Where the run was played. A scenario id no longer pins this down -- a custom game carries its
  // own location, and an authored one could be given a location that isn't in LOCATIONS -- so
  // without it a replay would silently be re-simulated against a different city's weather
  location: LocationType;
  durationMinutes: number; // How far the recorded run got
  actions: ReplayActionType[];
}

/**
 * A replay on its way to or from Firestore. `actions` is a JSON string rather than a real array
 * so that the nested payloads can't run into Firestore's rules about what may sit inside one, and
 * so that the size measured against the 1 MiB document limit is the size actually stored.
 */
export interface ReplayDocType extends Omit<ReplayType, "actions"> {
  actions: string;
}

// Where a replay has got to while it's being watched
export interface ReplayPlaybackType {
  actions: ReplayActionType[];
  index: number; // Next action to apply
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
  // Point in time rather than totals: what a new loan would cost, and what prices were doing,
  // as of this tick / the end of this month. Summing them would be meaningless, so reduceHistories
  // keeps the last one it sees, the way it does for cash and net worth.
  interestRate: number; // Annual, as a fraction. Prime plus the company's own credit premium
  inflationRate: number; // Annualised, as a fraction. Can be negative
}

export interface FuelType {
  // costPerBtu: number; // Measured from raw stock / before generator efficiency loss
  // all costs should be in that year's $ / not account for inflation when possible
  kgCO2ePerBtu: number; // Measured from raw stock / before generator efficiency loss
}

export type FacilityOperatingType =
  GeneratorOperatingType | StorageOperatingType;

export interface GeneratorOperatingType
  extends GeneratorShoppingType, LoanInfo {
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
  // The rate this particular loan was signed at, fixed for its whole 30 year life. Kept per
  // facility rather than read from the current rate so that a later spike cannot push a month's
  // interest above a payment that was struck years earlier, which would grow the balance forever.
  // 0 for anything bought outright.
  interestRate: number;
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
  // TODO remove: this defeats type checking on every shopping type, but the build and
  // facilities views index these by string and treat the Storage/Generator union as
  // interchangeable, so it cannot go until those are narrowed properly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  skipBeacon?: boolean;
  // The card this step's target lives on. Every step change navigates here, in both
  // directions, so stepping backwards over a step that navigated forwards still lands on
  // the card holding the target instead of leaving Joyride with nothing to point at
  card?: CardNameType | NavigateActionType;
  // A one-way side effect of leaving this step forwards, such as starting the clock. It
  // isn't replayed when stepping backwards, since nothing would undo it - navigation
  // belongs in `card`, which works in both directions
  onNext?: () => Redux.Action;
  target: string;
  content: React.JSX.Element;
  // Above the desktop breakpoint the bottom nav is hidden and Facilities / Finances /
  // Forecasts render side by side, so a step whose target lives in that nav - or whose
  // selector matches more than one pane - needs a different target there, and usually
  // different wording too, since there are no tabs left to switch between
  desktop?: {
    target: string;
    content?: React.JSX.Element;
  };
}

export interface ScenarioType {
  id: number;
  name: string;
  icon: string; // assumed to be images/<string>.svg
  locationId: LocationIdType;
  // The full location, for scenarios whose location isn't in LOCATIONS -- which is every custom
  // game, since the player may eventually pick a place no table knows about. When it's set it
  // wins over locationId; getScenarioLocation is the one place that resolves the two.
  location?: LocationType;
  summary?: string;
  ownership: "Investor" | "Public";
  tutorialSteps?: TutorialStepType[];
  // Pins the run's RNG so it plays out identically every time. Every authored scenario leaves
  // this off and draws a fresh seed each play; only the custom game screen sets it
  seed?: number;
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
  // The scenario the player assembled on the custom game screen. Authored scenarios live in
  // SCENARIOS, this one only ever exists here, so every lookup has to go through getScenario()
  customScenario?: ScenarioType;
  location: LocationType;
  speed: SpeedType;
  inGame: boolean;
  feePerKgCO2e: number;
  dollarsPerkWh: number;
  monthlyMarketingSpend: number;
  // What a loan signed right now would cost, and the multiplier on prime that gets there.
  // Both recomputed once a month. The premium is kept separately so that a forecast can price
  // future months against where prime is heading while holding the company's own creditworthiness
  // fixed -- what the player does next is exactly what the forecast cannot know.
  interestRate: number;
  creditPremium: number;
  tutorialStep: number;
  date: DateType;
  startingYear: number;
  timeline: TickPresentFutureType[]; // anything before currentMinute is history, anything after is a forecast
  monthlyHistory: MonthlyHistoryType[]; // live updated; for calculation simplicity, 0 = most recent (prepend new entries)
  facilities: Array<StorageOperatingType | GeneratorOperatingType>;
  // Every simulation-affecting thing the player has done this run, for the replay attached to a
  // high score. Undefined means the run isn't being recorded: before a game starts, while one is
  // being watched, after resuming a save from before replays existed, or once a run has grown
  // past MAX_REPLAY_ACTIONS. Persisted with the rest of the slice, so a replay survives a reload
  replayLog?: ReplayActionType[];
  // Set only while watching a replay. Doubles as the "this is a replay" flag: player controls are
  // hidden, nothing is autosaved, and no score is submitted while it's here
  replayPlayback?: ReplayPlaybackType;
}

export interface SettingsType {
  audioEnabled?: boolean;
}

export interface DialogType {
  message: string | React.JSX.Element | React.JSX.Element[];
  title: string;
  action?: (e: React.MouseEvent<HTMLElement>) => void;
  actionLabel?: string;
  // For dialogs where the second choice is an action of its own rather than "never mind" - the
  // end of a tutorial offers the next tutorial or the main menu, and neither is a dismissal.
  // Set alongside notCancellable, this replaces the close button rather than adding a third one
  secondaryAction?: (e: React.MouseEvent<HTMLElement>) => void;
  secondaryLabel?: string;
  notCancellable?: boolean;
  closeText?: string;
  open: boolean;
}

export interface SnackbarType {
  action?: (e: React.MouseEvent<HTMLElement>) => void;
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
