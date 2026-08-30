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
  // State / province / first-level subdivision from the city catalogue. Demand profiles use it
  // for location-specific structural trends such as Virginia data centers and Texas growth.
  admin?: string;
  // Curated cities carry an IANA zone. An arbitrary coordinate may not, in which case local time
  // is derived from longitude rather than from the player's computer.
  timeZone?: string;
  region?: string;
  country?: string;
  elevation?: number;
  // A curated upstream record used by conventional hydro. Locations without one use their own
  // precipitation, which keeps arbitrary custom locations playable without inventing a basin.
  watershedId?: LocationIdType;
  watershedName?: string;
  // Whether the loaded weather record includes a curated offshore wind site for this location.
  offshore?: boolean;
  // Explicit resource knowledge wins over the regional fallback. This keeps an arbitrary point
  // honest: coordinates alone cannot tell us whether a usable river or geothermal field exists.
  resources?: {
    geothermal?: boolean;
    hydro?: boolean;
  };
}

export type FuelNameType =
  | "Coal"
  | "Biomass"
  | "Wind"
  | "Offshore Wind"
  | "Airborne Wind"
  | "Sun"
  | "Natural Gas"
  | "Uranium"
  | "Oil"
  | "Geothermal"
  | "Hydro";
export interface FuelPricesType {
  [index: string]: number;
  Biomass: number; // $/btu
  "Natural Gas": number; // $/btu
  Coal: number; // $/btu
  Uranium: number; // $/btu
  Oil: number; // $/btu
}
export interface FuelProductionType {
  [index: string]: number | undefined;
  Biomass?: number; // wh
  "Natural Gas"?: number; // wh
  Coal?: number; // wh
  Uranium?: number; // wh
  Oil?: number; // wh
  Sun?: number; // wh
  Wind?: number; //wh
  "Offshore Wind"?: number; // wh
  "Airborne Wind"?: number; // wh
  Geothermal?: number; // wh
  Hydro?: number; // wh
}

/** The five high-level end-use groups used by the demand model and its stacked chart. */
export type DemandTypeNameType =
  | "Residential"
  | "Commercial"
  | "Industrial"
  | "Transportation"
  | "Data centers";

export type DemandByTypeType = Record<DemandTypeNameType, number>;

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
  | "INSIGHTS"
  | "EVENTS"
  | "LOADING"
  | "MAIN_MENU"
  | "NEW_GAME"
  | "NEW_GAME_DETAILS"
  | "MANUAL"
  | "SETTINGS"
  | "CUSTOM_GAME";

export type ConceptNameType =
  | "money"
  | "supply"
  | "demand"
  | "blackout"
  | "customers"
  | "generator"
  | "storage"
  | "build"
  | "buy"
  | "reorder"
  | "pause"
  | "play"
  | "time"
  | "construction"
  | "finances"
  | "forecast"
  | "rate"
  | "fuel"
  | "weather"
  | "danger"
  | "goal";

export type StoryActionTargetType =
  | {
      card: "FACILITIES";
      view?: "FLEET" | "BUILD_GENERATORS";
      fuel?: FuelNameType;
    }
  | {
      card: "INSIGHTS";
      layer?: "FINANCES" | "SUPPLY_DEMAND" | "FUEL_PRICES";
    }
  | { card: "EVENTS" };

// What the card reducer's navigate action accepts, beyond a bare card name
export interface NavigateActionType {
  name: CardNameType;
  dontRemember?: boolean;
  // Manual entry to open and scroll to, for deep links from terms the game shows elsewhere
  entry?: string;
  storyTarget?: StoryActionTargetType;
}

export interface CardType {
  name: CardNameType;
  ts: number;
  history?: CardNameType[];
  toPrevious?: boolean;
  entry?: string;
  storyTarget?: StoryActionTargetType;
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
  // The player's leaderboard name as it was when the score was set, denormalized so that
  // rendering a board is one query rather than one plus a profile read per row. Absent on scores
  // set before display names existed, and those fall back to Anonymous
  displayName?: string;
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
  // Recorded for bug reports, alongside appVersion, and deliberately not read back: playback
  // reloads the scenario and takes the year from it, so a replay that disagreed with its own
  // scenario would be describing a run that could not be reproduced anyway. Not required on the
  // way in for the same reason
  startingYear?: number;
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
  monthsElapsed: number;
  year: number;
}

export interface RawWeatherType {
  YEAR: number;
  MONTH: number;
  TEMP_C: number;
  CLOUD_PCT: number; // 0 - 100
  WIND_KPH: number;
  // Present only in v2 weather files whose catalogue entry has an offshore sampling point.
  WIND_OFFSHORE_KPH?: number;
  // Hydro turns this into watershed snowpack, runoff and reservoir inflow. Other downstream
  // effects such as snow sitting on panels and thermal-plant cooling water remain out of scope.
  PRECIP_MM: number; // in that hour
}

// All amounts are the average across the time window
export type TickPresentFutureType = Partial<FuelPricesType> &
  HistoryForecastShared & {
    minute: number;
    supplyW: number; // Watts
    demandW: number; // Watts
    // Components sum to demandW. Kept on forecast ticks so Insights can explain what is driving
    // load without bloating the long-lived monthly history in saves.
    demandByType: DemandByTypeType;
    solarIrradianceWM2: number;
    windKph: number;
    windOffshoreKph?: number;
    // Wind at the Airborne Wind curve's 100m reference height. Kept separate from windKph,
    // whose legacy onshore siting multiplier is already baked in.
    windAirborneKph: number;
    temperatureC: number;
    storedWh: number;
    precipitationMm: number; // Representative month's total over the hydro watershed
    snowpackMm: number; // Snow-water equivalent remaining in that watershed
    hydroRunoffMm: number; // Rain plus snowmelt available after catchment losses this month
    hydroReservoirWh: number; // Conventional-hydro reservoir energy, separate from storage
    hydroReservoirCapacityWh: number;
    hydroSpillWh: number; // Water above reservoir capacity lost during this tick
    hydroMandatedReleaseW: number; // Must-run water-rights flow through turbines
    storageLossWh: number; // Self-discharge / evaporation during this simulated tick
    // The exponentially smoothed bill customers respond to, rather than the slider's latest value
    customerRate: number;
    supplyByFuel: FuelProductionType;
    // The unconstrained dispatch request for each facility in the most recent forecast pass.
    // Kept on forecast ticks so minimum-load generators can decide whether avoiding a future
    // start is worth remaining online; it is intentionally not copied into monthly history.
    dispatchTargetWByFacility: Record<number, number>;
  };

export type DerivedHistoryKeysType = Exclude<
  NonNullable<
    {
      [Key in keyof DerivedHistoryType]: DerivedHistoryType[Key] extends number
        ? Key
        : never;
    }[keyof DerivedHistoryType]
  >,
  "minimumSupplyMarginW"
>;
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
  // Persisted simulation facts used by story checkpoints. These are deliberately raw totals,
  // not narrative classifications such as "reliable" or "gas-heavy".
  deliveredWhByFuel: FuelProductionType;
  peakDemandW: number;
  // The tightest instantaneous reserve in the month. Negative means supply fell short. Kept so
  // scenario debriefs can explain an event without retaining every tick for the whole run.
  minimumSupplyMarginW?: number;
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
  extends GeneratorShoppingType, LoanInfo, LifetimeTotals {
  id: number; // Monotonically increasing
  currentW: number;
  yearsToBuildLeft: number;
  minuteCreated: number; // That the user clicked buy, not construction complete
  // Set when construction completes; absent while the facility is still being built.
  minuteOperational?: number;
  paused: boolean;
  // Unit commitment is distinct from instantaneous output: a plant ramps through outputs below
  // its stable minimum while starting and stopping, but cannot remain there indefinitely.
  committed?: boolean;
  // Last real-tick state for start edge detection. Forecast/pre-roll dispatch mutates currentW,
  // so currentW alone cannot distinguish a player-visible start from a synthetic one. For
  // minimum-load plants this records commitment rather than a literal positive currentW.
  generatingLastRealTick?: boolean;
  reservoirWh?: number;
  hydroLastInflowWh?: number;
  hydroLastSpillWh?: number;
  hydroLastMandatedReleaseWh?: number;
  hydroLastBypassWh?: number;
}

export interface StorageOperatingType
  extends StorageShoppingType, LoanInfo, LifetimeTotals {
  id: number; // Monotonically increasing
  currentWh: number;
  yearsToBuildLeft: number;
  minuteCreated: number; // That the user clicked buy, not construction complete
  minuteOperational?: number;
}

/**
 * What one facility has actually done since it came online, so a row can report whether it is
 * earning its keep rather than only what it cost to build. Accumulated per tick by
 * updateSupplyFacilitiesFinances, and only while the game is really ticking -- a forecast runs
 * against a deep clone of the fleet and throws the clone away, so its ticks never land here.
 */
export interface LifetimeTotals {
  lifetimeWh: number; // Delivered to the grid. Storage counts discharge only, not charging
  // What it could have delivered running flat out over the same span, ie the denominator of its
  // capacity factor. Accrues from the moment construction finishes, so pauses and idle hours
  // count against it the way they do for a real plant
  lifetimePotentialWh: number;
  lifetimeRevenue: number; // Its pro-rata share of what the company sold
  lifetimeExpenses: number; // Its own fuel, O&M, carbon fees and loan interest
  // Representative starts: one on/off edge in the sampled day stands for every day in its month.
  // Present only for generators whose maintenance model tracks starts.
  lifetimeStarts?: number;
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
  // Fraction of nameplate output permanently lost each operating year. Optional because most
  // generator types do not have a well-supported secular output decline.
  annualOutputDegradation?: number;
  spinMinutes: number; // 1 for renewables, avoiding repeated fallback coercion in the tick loop
  btuPerWh: number; // Heat Rate, but per W for less math per frame
  // Lowest steady output as a fraction of nameplate. Starting and shutdown ramps may pass below
  // it transiently; an online unit otherwise produces at least this much.
  minimumStableOutput?: number;
  // Explicit because neither purchased fuel nor a start charge identifies every thermal plant:
  // geothermal buys no fuel, while the Oil facility is an internal-combustion generator.
  tracksStarts?: boolean;
  // Non-fuel expense charged for one physical start. Only present when the technology's source
  // case reports a transferable amount separately from fixed and output-dependent O&M.
  costPerStart?: number;
  // Non-fuel O&M charged against actual generation. Technologies without a separately sourced
  // variable component annualize all non-fuel operating expense into annualOperatingCost.
  variableOperatingCostPerMWh?: number;
  // Conventional hydro only. whPerMm is calibrated against the loaded watershed record so that
  // long-run inflow lands on capacityFactor without flattening wet and dry years.
  reservoirCapacityWh?: number;
  hydroWhPerMm?: number;
  hydroMeanMonthlyInflowWh?: number;
}

interface SharedShoppingType {
  // Facility reducers and presentation components read technology-specific fields through the
  // generator/storage union. Keep that established structural API localized here; code that
  // dynamically selects known fields should use a keyed union instead.
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
  // Present only for technologies whose geography imposes a finite number of project sites.
  // Includes projects under construction because choosing to build has already claimed the site.
  viableLocationsRemaining?: number;
  lifespanYears: number;
  yearsToBuild: number;
}

export interface TutorialStepType {
  skipBeacon?: boolean;
  // The card this step's target lives on. Every step change navigates here, in both
  // directions, so stepping backwards over a step that navigated forwards still lands on
  // the card holding the target instead of leaving the objective pointing at absent UI
  card?: CardNameType | NavigateActionType;
  // A one-way side effect of leaving this step forwards, such as starting the clock. It
  // isn't replayed when stepping backwards, since nothing would undo it - navigation
  // belongs in `card`, which works in both directions
  onNext?: () => Redux.Action;
  // Optional for unguided capstones: ordinary objectives can point at a control for a restrained
  // outline, while a capstone deliberately leaves the player to find the answer themselves.
  target?: string;
  content: React.JSX.Element;
  // Player-requested help. Kept outside content so the objective HUD never reveals it before the
  // player asks, and so hiding/showing it does not affect the underlying objective gate.
  hint?: React.ReactNode;
  // Present = the step is action-gated ("play, don't tell"): the HUD shows a "complete
  // objective" status instead of a Next button, and the walkthrough advances the moment this
  // returns true. Evaluated after every dispatch - including every tick - so keep it to
  // cheap field reads. Tutorial scenarios have fixed authored starting states, so
  // predicates are absolute (e.g. facilities.length >= 2), never relative to step entry
  advanceOn?: (state: AppStateType) => boolean;
  // Gate for deeds that leave no distinguishable state behind (a drag re-order, a pause
  // toggle): advance when an action with one of these types is dispatched. Either gate
  // field alone makes the step gated; both may be combined (OR)
  advanceOnAction?: string | string[];
  // An independent application check. Entering one restarts the authored scenario at this step,
  // giving it a deterministic, retryable state instead of inheriting whatever the guided portion
  // changed. Success advances normally; failure pauses for consequence-specific feedback.
  capstone?: {
    // Optional authored checkpoint overrides. The normal tutorial and its capstone can therefore
    // teach with different starting economics while still rebuilding the whole Game slice through
    // initGame on entry/retry. Anything omitted inherits the mission's scenario-level value.
    checkpoint?: {
      cash?: number;
      dollarsPerkWh?: number;
      facilities?: ScenarioFacilityType[];
      startingCustomers?: number;
    };
    success: (state: AppStateType) => boolean;
    failure?: (state: AppStateType) => boolean;
    successMessage: string;
    failureMessage: string;
  };
  // Above the desktop breakpoint the bottom nav is hidden and Facilities / Insights render
  // side by side, so a step whose target lives in that nav - or whose
  // selector matches more than one pane - needs a different target there, and usually
  // different wording too, since there are no tabs left to switch between
  desktop?: {
    target: string;
    content?: React.JSX.Element;
  };
}

export function isGatedStep(step: TutorialStepType): boolean {
  return !!(step.advanceOn || step.advanceOnAction || step.capstone);
}

// A walkthrough moving between two steps. Both ends are named because Back and Next need
// telling apart: a step's onNext only applies to leaving it forwards
export interface TutorialStepChangeType {
  fromStep: number;
  toStep: number;
  tutorialSteps: TutorialStepType[] | undefined;
  scenarioId: number;
  currentCard: CardNameType;
}

export type ScenarioBriefingToneType =
  "transition" | "boom" | "island" | "innovation" | "storm" | "legacy";

/**
 * The authored promise of a scenario, kept beside its simulation setup so the mission list and
 * briefing screen tell the same story. Each scenario's dedicated icon supplies the visual tone.
 */
export interface ScenarioBriefingType {
  tone: ScenarioBriefingToneType;
  fantasy: string;
  objective: string;
  constraint: string;
  threat: string;
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
  briefing?: ScenarioBriefingType;
  ownership: "Investor" | "Public";
  tutorialSteps?: TutorialStepType[];
  // Pins the run's RNG so it plays out identically every time. Every authored scenario leaves
  // this off and draws a fresh seed each play; only the custom game screen sets it
  seed?: number;
  startingYear: number;
  cash: number;
  // When absent, the location profile supplies the starting grid size.
  startingCustomers?: number;
  // Customer count and utility-scale load are not interchangeable. Authored scenarios can
  // calibrate the ordinary customer-driven baseline while the absent default preserves every
  // legacy scenario and custom game.
  startingDemandScale?: number;
  // Absolute loads owned by this scenario. A Data centers schedule replaces the generic regional
  // data-center curve instead of stacking on top of it.
  loadAdditions?: ScenarioLoadAdditionType[];
  /** Optional mission gate evaluated at the authored end date. */
  minimumCustomerRetention?: number;
  dollarsPerkWh: number;
  durationMonths: number;
  endTitle?: string;
  endMessage?: string;
  feePerKgCO2e: number;
  facilities: ScenarioFacilityType[];
}

/** An authored starting asset may already have spent years in service when a scenario opens. */
export type ScenarioFacilityType = Partial<FacilityShoppingType> & {
  initialAgeYears?: number;
  /** Optional player-facing name for an authored aggregate or gameplay proxy. */
  label?: string;
};

export interface ScenarioLoadAdditionType {
  id: string;
  label: string;
  startsYear: number;
  /** Calendar month, 1-12. Defaults to January. */
  startsMonth?: number;
  /** Maximum total load after the start date, never an annual increment. */
  peakW: number;
  loadFactor: number;
  demandType: "Data centers";
}

/**
 * What kind of thing happened, which is all the event log's icons and colours are keyed off.
 * The text itself is written where the event is raised, since that's the only place that knows
 * how much energy went unserved or which fuel moved.
 */
export type GameEventKindType =
  | "BLACKOUT"
  | "BLACKOUT_OVER"
  | "CONSTRUCTION"
  | "BUILD"
  | "SELL"
  | "LOAN"
  | "FUEL_PRICE"
  | "FUEL_CROSSOVER"
  | "WORLD_EVENT";

export type GameEventImportanceType = "ROUTINE" | "NOTABLE" | "CRITICAL";

/**
 * One line of the company's history.
 *
 * A blackout used to be a toolbar that pulsed and then stopped, a finished plant a toast that
 * lasted four seconds - so a player who was looking at another pane, or away from the screen,
 * had no way to find out what had happened to them. These are kept instead.
 */
export interface GameEventType {
  // Monotonic within a run, so React has a key that doesn't move when the log is trimmed
  id: number;
  kind: GameEventKindType;
  // When it happened, as the game clock read it at the time ("Mar 2024")
  label: string;
  message: string;
  // Most entries are passive history. Important entries can interrupt the clock, stand out in
  // the log and take the player to the screen where the consequence can be investigated.
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
  title?: string;
  details?: string;
  concept?: ConceptNameType;
  storyPhaseKey?: string;
  turningPointPriority?: number;
}

export type StoryAttributeValueType =
  string | number | boolean | string[] | number[];

export interface WorldEventEffectsType {
  fuelPriceMultipliers?: Partial<Record<FuelNameType, number>>;
  temperatureOffsetC?: number;
  demandMultiplier?: number;
  // An override rather than a multiplier. Content validation rejects overlapping policy phases.
  carbonFeePerKgCO2e?: number;
  buildCostMultipliersByFuel?: Partial<Record<FuelNameType, number>>;
  operatingCostMultipliersByFuel?: Partial<Record<FuelNameType, number>>;
  facilityOutputMultipliersByFuel?: Partial<Record<FuelNameType, number>>;
  facilityOutputMultipliersById?: Record<string, number>;
}

/** Pure simulation summary exposed to authored story phases. */
export interface StorySnapshotType {
  deliveredWhByFuel12m: Partial<Record<FuelNameType, number>>;
  demandWh12m: number;
  unservedWh12m: number;
  netIncome12m: number;
  peakDemandW12m: number;
  firmPeakW: number;
  storagePeakW: number;
  storagePeakWh: number;
  facilities: Array<{
    id: number;
    name: string;
    fuel?: FuelNameType;
    ageYears: number;
    peakW: number;
    operational: boolean;
  }>;
}

/** A pure summary of an event's completed monthly window. */
export interface StoryPeriodSnapshotType {
  deliveredWhByFuel: Partial<Record<FuelNameType, number>>;
  demandWh: number;
  unservedWh: number;
  netIncome: number;
  peakDemandW: number;
}

/** One deterministic, time-bounded occurrence created by the world-event engine. */
export interface ActiveWorldEventType {
  // Definition id plus location/date, stable across a replay of the same run
  key: string;
  definitionId: string;
  startsMinute: number;
  endsMinute: number;
  attributes: Record<string, StoryAttributeValueType>;
  effects: WorldEventEffectsType;
}

export interface WorldEventStateType {
  active: ActiveWorldEventType[];
  // Resolved live occurrences survive expiry so recovery copy, saves, replays, matrix reports,
  // and debrief selection can refer to the exact onset-time attributes and facility IDs.
  occurrences: ActiveWorldEventType[];
  // A bounded record of month/definition checks prevents a save resumed in the same month from
  // drawing (and announcing) the same occurrence twice.
  checkedKeys: string[];
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
  // Customer price competition starts from the scenario's rate and half of this addressable pool.
  // customerRate is the three-month bill average carried between monthly forecast windows.
  customerMarketSize: number;
  customerRate: number;
  // Copied from the scenario at init so saves carry the exact demand contract they started with.
  startingDemandScale: number;
  loadAdditions: ScenarioLoadAdditionType[];
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
  // Newest first, capped at MAX_EVENTS.
  eventLog: GameEventType[];
  // Keys outlive the capped event log: a once-per-run lesson must not repeat just because its
  // original row was the 101st one and fell off the visible history.
  reportedEventKeys: string[];
  eventLogReadThroughId: number;
  // All-in $/MWh by fuel at the last monthly rollover, used to edge-detect cost-order changes.
  fuelCostSnapshot?: Partial<Record<FuelNameType, number>>;
  worldEvents: WorldEventStateType;
  // Headless balance harness only: baseline matrix cells run the identical strategy with authored
  // effects disabled. Undefined means enabled and is what every browser save/replay uses.
  storyEffectsDisabled?: boolean;
  facilities: Array<StorageOperatingType | GeneratorOperatingType>;
  // Every simulation-affecting thing the player has done this run, for the replay attached to a
  // high score. Undefined means the run isn't being recorded: before a game starts, while one is
  // being watched, or once a run has grown past MAX_REPLAY_ACTIONS. Persisted with the rest of the
  // slice, so a replay survives a reload.
  replayLog?: ReplayActionType[];
  // Set only while watching a replay. Doubles as the "this is a replay" flag: player controls are
  // hidden, nothing is autosaved, and no score is submitted while it's here
  replayPlayback?: ReplayPlaybackType;
}

// Which units the player reads. Only ever affects display: everything the game stores and
// simulates is metric, and helpers/Units converts on the way out. See base/UnitsContext.
export type UnitSystemType = "metric" | "imperial";

// Which of the two palettes is being painted. See Theme.tsx (the charts, which draw to a canvas)
// and the custom properties at the top of app.scss (everything else)
export type ThemeModeType = "light" | "dark";

// What the player asked for, which is a third thing: "system" is a standing instruction to
// follow the OS rather than a palette of its own, and it can change while the game is open
export type ThemeChoiceType = ThemeModeType | "system";

export interface SettingsType {
  audioEnabled?: boolean;
  // Independent buses: zero mutes one without silencing the other. audioEnabled is the master
  // switch and remains undefined until the player grants first-run audio permission.
  musicVolume: number;
  soundEffectsVolume: number;
  units: UnitSystemType;
  theme: ThemeChoiceType;
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

/**
 * The end of a run, which the victory dialog turns into a score screen. Everything here is known
 * the moment the scenario ends; the rank and the score write are enrichment that lands later.
 */
export interface VictoryType {
  scenarioId: number;
  scenarioName: string;
  difficulty: DifficultyType;
  score: number;
  // The per-category points behind `score`, in the order they should be listed
  breakdown: ScoreBreakdownType;
  endTitle?: string;
  endMessage?: string;
  // Whether the run counts for the leaderboard. A custom game (every one shares an id) or a
  // replay of someone else's run gets the breakdown without a rank or a personal best
  ranked: boolean;
  // The player's best on this scenario BEFORE this run, read at the moment the scenario ended so
  // that "was 640" reports the run before this one rather than the one just finished
  previousBest?: number;
  // A failed run still earns and submits a score, but the score screen must not celebrate it as a
  // completed mission or let the terminal game resume and submit the same run again
  outcome?: "completed" | "bankrupt" | "fired";
  debrief?: VictoryDebriefType;
}

export interface VictoryFleetCapacityType {
  fuel: FuelNameType;
  watts: number;
}

/** A compact, serializable story of the run captured before the reducer's Immer draft expires. */
export interface VictoryDebriefType {
  startingFleet: VictoryFleetCapacityType[];
  finalFleet: VictoryFleetCapacityType[];
  startingCash: number;
  finalCash: number;
  finalCustomers: number;
  reliability: number;
  unservedWh: number;
  kgco2e: number;
  scenarioMetrics?: Array<{
    label: string;
    value: string;
    concept: ConceptNameType;
  }>;
  highlights: Array<
    Pick<GameEventType, "kind" | "label" | "message" | "importance">
  >;
}

export interface UIType {
  dialog: DialogType;
  snackbar: SnackbarType;
  // True only while the player is physically reordering the fleet. Expensive sibling panes can
  // defer their next projection until the drop, when the temporarily suspended clock resumes.
  facilityDragActive: boolean;
  // The facility the player has clicked in the fleet list, or null for none. UI rather than game
  // state: it changes nothing about the simulation, and it is read by all three panes -- the
  // fleet row expands, Supply by Fuel dims everything it doesn't burn, and Insights reports what
  // it has earned. Cleared when the run ends, or when the facility is sold out from under it
  selectedFacilityId: number | null;
  // The score screen for a run that just ended, or null when none has. Its own slot rather than a
  // `dialog`, because the shared dialog only holds a title and a message and this one fills
  // itself in as async results arrive
  victory: VictoryType | null;
}

// A player's best run on one scenario, mirrored from users/{uid}.bests so that the victory dialog
// can compare against it without a read
export interface BestScoreType {
  score: number;
  difficulty: string;
  // Epoch ms rather than a Timestamp: this one is read back into a plain Redux slice
  date: number;
}

export interface UserType {
  uid?: string;
  // The leaderboard name, once one has been claimed
  displayName?: string;
  // The name the identity provider knows them by. Kept only to seed the name dialog -- it is
  // never what the board shows, since it is neither unique nor within the board's charset
  googleDisplayName?: string;
  // Keyed by scenario id as a string, which is how it comes back out of Firestore
  bests?: { [scenarioId: string]: BestScoreType };
  // Set once users/{uid} has been read or created, so the UI can tell "this player has no name"
  // apart from "we have not looked yet"
  profileLoaded?: boolean;
  // Whether to prompt for a display name. Set on first login, and by the Settings card's
  // "Change name"; cleared once the dialog is answered or dismissed
  needsDisplayName?: boolean;
}

export type TransitionClassType = "next" | "prev" | "instant" | "nav";

export interface AppStateType {
  card: CardType;
  game: GameType;
  settings: SettingsType;
  ui: UIType;
  user: UserType;
}
