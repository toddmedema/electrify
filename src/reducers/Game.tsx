import { combinedUtilityDemandProfile } from "../helpers/CombinedUtilityDemand";
import {
  isUtilityExpansionGame,
  ownedUtilityConnection,
} from "../helpers/ExpansionContext";
import { areaBaselineDemand } from "../helpers/AreaDemand";
import { utilityNetworkAnnualOM } from "../data/UtilityExpansion";
import { acquireUtility } from "./GameActions";
import {
  acquisitionQuote,
  expansionNetWorth,
  expansionRetentionBaseline,
  ownedUtility,
  transferUtility,
  entitlementSources,
} from "../helpers/Expansion";
import {
  BLACKOUT_OVER_TOAST,
  BLACKOUT_TOAST_PREFIX,
  blackoutToastCanShow,
} from "../helpers/BlackoutToast";
import {
  matchesStartingFacility,
  startingFacilitySearch,
  startingFacilityQuote,
} from "../helpers/StartingFacilities";
import { customEventContext } from "../helpers/CustomScenarioEvents";
import { validScenarioMod } from "../helpers/ScenarioMod";
import {
  scenarioRules,
  scenarioRulesIdentity,
  isOfficialCatalogRules,
} from "../helpers/ScenarioRules";
import { canonicalRuleJson } from "../helpers/RuleIdentity";
import { getScenarioLocation } from "../helpers/Locations";
import { getStartingCustomers } from "../data/LocationProfiles";
import {
  scenarioRuleChoiceLoadPlan,
  scenarioRuleLoadOrder,
  scenarioRuleReplacedLoadIds,
} from "../helpers/ScenarioRuleDecisions";
import type {
  CompiledRuleChoice,
  CompiledRuleOption,
  CompiledScenarioRules,
} from "../data/ScenarioRules";
import {
  captureRuleReportObservation,
  ruleConditionMet,
  ruleEffectsForOccurrence,
  ruleLoadKey,
  ruleEvents,
  scenarioRuleForecastOccurrences,
} from "../helpers/ScenarioRuleRuntime";
import { desktopSimulationHooks } from "../achievements/SimulationHooks";
import {
  gasConversionQuote,
  completeGasConversion,
  GAS_CONVERSION_MINUTES,
} from "../helpers/GasConversion";
import { accessContextForGame, corridorsForGame } from "../data/IntertieAccess";
import { beginIntertieStress, cloudSavePromptVisible } from "./GameActions";
import {
  getHydroAvailability,
  getHydroInventoryKey,
  isConventionalHydro,
  resolveStartingHydroSites,
} from "../data/HydroSites";
import {
  captureRunIdentity,
  projectAuthoredRunReference,
} from "../helpers/RunIdentity";
import { launchRun } from "./GameActions";
import {
  generatorsAboveDemandFloor,
  mothballAdvice,
} from "../helpers/Mothball";
import {
  runFailure,
  initializeGameObjectiveProgress,
  recordGameObjectiveMonth,
  gameObjectiveResults,
  rebaseGameRetentionBaseline,
} from "../helpers/ObjectiveRules";
import { chooseScenarioResponse } from "./GameActions";
import {
  validBuildFacility,
  validRetrofitFacility,
} from "../helpers/BuildValidation";
import { defaultDispatchIndex } from "../helpers/DispatchOrder";
import { startingFacilityStarts } from "../helpers/StartingFacilityStarts";
import {
  pendingScenarioChoice,
  pendingScenarioRuleChoice,
  scenarioChoicesForGame,
  isBulkWinterizationChoice,
  validScenarioResponse,
} from "../helpers/ScenarioChoices";
import { getViableLocationCount } from "../data/FacilitySites";
import {
  advancePolicies,
  applyPolicyDemand,
  applyPeakDemand,
  customerBillingRate,
  emptyPolicies,
  policyAvailable,
  validPolicyChange,
  samePolicyChoice,
  isOperatingPolicy,
  buildoutComplete,
  programCustomers,
  policyPeakHour,
  policyStartHour,
} from "../helpers/Policies";
import { POLICIES, POLICY_IDS } from "../data/Policies";
import {
  isFlexibilityPolicy,
  flexibilityAvailable,
} from "../helpers/CustomerFlexibility";
import { shiftThermalDemand } from "../helpers/ThermalFlexibility";
import { shiftManagedCharging } from "../helpers/ManagedCharging";
import { MANAGED_CHARGING } from "../data/ElectricVehicles";
import {
  customerBatteryFleet,
  dispatchCustomerBattery,
  EMPTY_CUSTOMER_BATTERY_FLEET,
  EMPTY_CUSTOMER_BATTERY_DISPATCH,
} from "../helpers/CustomerBatteries";
import { policyChoiceLabel } from "../helpers/PolicyWindow";
import {
  schedulePolicy,
  cancelPolicy,
  openPolicyDecision,
  closePolicyDecision,
  pageHidden,
  systemSuspend,
  pageVisible,
} from "./GameActions";
import type { AppDispatch } from "../Store";
import cloneDeep from "lodash.clonedeep";
import {
  createSlice,
  current,
  isDraft,
  original,
  PayloadAction,
} from "@reduxjs/toolkit";
import { submitHighscore } from "./User";
import {
  getDateFromMinute,
  getMonthYearFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeHistory,
  summarizeTimeline,
} from "../helpers/DateTime";
import {
  facilityCashBack,
  getCreditInputs,
  getCreditPremium,
  purchaseTerms,
  facilityLoanMonths,
  getPaymentInterest,
  facilityOutputFactor,
  estimatedAnnualOperatingCost,
} from "../helpers/Financials";
import {
  getCostTableIndex,
  getInflationIndex,
  getInflationRate,
  getPrimeRate,
  getRateInflationIndex,
  hasEconomy,
} from "../data/Economy";
import {
  CUSTOMER_MARKET_MULTIPLIER,
  customerMarketSizeAt,
  getMarketRate,
  nextCustomerCount,
  publicRateCap,
  updateCustomerRate,
} from "../helpers/Customers";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
} from "../helpers/Format";
import { arrayMove, newSeed } from "../helpers/Math";
import {
  computeScoreBreakdown,
  competitiveBest,
  SCORE_VERSION,
  startingDollarRevenue,
  totalScore,
} from "../helpers/Scoring";
import { formatLargeMass } from "../helpers/Units";
import { buildStartedMessage } from "../helpers/BuildConsequences";
import { buildVictoryDebrief } from "../helpers/Debrief";
import {
  buildStoryPeriodSnapshot,
  buildStorySnapshot,
  storyOutputMultiplier,
} from "../helpers/Story";
import {
  isMaterialCapacityDecision,
  recordMeaningfulDecision,
} from "../helpers/MeaningfulDecisions";
import {
  getAirborneWindOutputFactor,
  getAirborneWindReferenceKph,
  getOffshoreWindOutputFactor,
  getSolarOutputFactor,
  getWindOutputFactor,
} from "../helpers/Energy";
import { getFuelPricesPerMBTU } from "../data/FuelPrices";
import {
  adjacentMarketForCorridor,
  corridorById,
  emptyTransmissionState,
  intertiesEnabledForScenario,
} from "../data/AdjacentMarkets";
import { importEmissionsKgco2ePerMWh } from "../data/ImportEmissions";
import {
  adjacentMarketPricePerMWh,
  allocateIntertieFlows,
  intertieOfferLimits,
  clearTransmissionMarket,
  supplyAtDemandBoundary,
  intertieContextForGame,
  intertieYear,
  intertieUpgradeQuote,
  intertieBuildQuote,
  IntertieOffer,
  transmissionRatingW,
} from "../helpers/Transmission";
import { DEMAND_TYPES, demandByTypeAt } from "../data/DemandProfiles";
import { combineStoryEffects, resolveStoryAtDate } from "../data/WorldEvents";
import { getRawSolarIrradianceWM2, getWeather } from "../data/Weather";
import { createWeatherForecast } from "../helpers/WeatherForecast";
import { COLD_MAX_GAS_PRICE_MULTIPLIER } from "../data/Hazards";
import {
  activeWeatherHazardsFor,
  COLD_DEFINITION_ID,
  HAIL_DEFINITION_ID,
  hailOccurs,
  hazardEventKey,
  isWeatherHazardEligible,
  oneTimeCostMinute,
  oneTimeWorldEventCost,
  representativeMinTempC,
  resolveColdImpact,
  RETROFIT_DOWNTIME_MINUTES,
  retrofitCost,
  bulkWinterizationQuote,
  retrofitOutputMultiplier,
  retrofittedResilience,
  sampleHailImpacts,
  trackerOutputMultiplier,
  upgradeInProgress,
  isUpgradingAt,
} from "../helpers/Hazards";
import {
  getHydroConditions,
  HYDRO_DEADPOOL_FRACTION,
  mandatedReleaseFraction,
} from "../helpers/Hydro";
import {
  manualHelpOpen,
  manualHelpClose,
  dialogOpen,
  dialogClose,
  snackbarOpen,
  victoryOpen,
  victoryClose,
} from "./UI";
import { navigate, navigateBack } from "./Card";
import {
  DAYS_PER_YEAR,
  DIFFICULTIES,
  FUELS,
  feeableKgCO2ePerBtu,
  GAME_TO_REAL_YEARS,
  INTEREST_RATE_YEARLY,
  ORGANIC_GROWTH_MAX_ANNUAL,
  TICK_MINUTES,
  TICK_MS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
  YEARS_PER_TICK,
  LOCATIONS,
  WEATHER_DEPENDENT_FUELS,
} from "../Constants";
import {
  GENERATORS,
  IRON_AIR_AVAILABLE_YEAR,
  STORAGE,
  windAnnualOutputDegradation,
} from "../data/Facilities";
import {
  copyCommitmentMetadata,
  hasPreparedGeneratorCommitment,
  prepareGeneratorCommitment,
  recordDispatchTarget,
  shouldKeepGeneratorCommitted,
} from "../helpers/Commitment";
import { getViableLocationsRemaining } from "../data/FacilitySites";
import { logEvent } from "../Globals";
import { recordScenarioPlayed } from "../LocalStorage";
import {
  CUSTOM_SCENARIO_ID,
  getNextTutorial,
  getScenario,
  getTutorialStep,
  SCENARIOS,
  TUTORIALS,
} from "../data/Scenarios";
import { getStore } from "../StoreRegistry";
import {
  start,
  loaded,
  quit,
  resume,
  multiplayerSnapshot,
} from "./GameActions";
import { currentRunSaveEffects, RunSaveEffects } from "../SaveEffects";
import {
  ActiveWorldEventType,
  ConstructionEmissions,
  DateType,
  DifficultyType,
  FacilityOperatingType,
  FacilityShoppingType,
  FuelPricesType,
  FuelNameType,
  GameEventKindType,
  GameEventImportanceType,
  GameEventType,
  LocationType,
  GameType,
  GeneratorOperatingType,
  MonthlyHistoryType,
  PeerPlan,
  PeerSettlement,
  ScenarioFacilityType,
  ScenarioType,
  ScoreBreakdownType,
  SpeedType,
  TickPresentFutureType,
  FuelProductionType,
  FacilityUpgradeType,
  RetrofitFacilityAction,
  TradingPolicyType,
  TransmissionLineOperatingType,
  VictoryType,
  WorldEventEffectsType,
  isStorage,
} from "../Types";
import { pow } from "../helpers/Pow";
import {
  isPeerCorridorId,
  PEER_TRADE_BASE_PRICE_PER_MWH,
  PEER_TRADE_GAS_HEAT_RATE,
  PEER_TRADE_MIN_PRICE_PER_MWH,
  PEER_TRADE_RESERVE_FRACTION,
} from "../data/Multiplayer";

interface BuildFacilityAction {
  facility: FacilityShoppingType;
  financed: boolean;
}

interface ReprioritizeAction {
  spotInList: number;
  delta: number;
}

interface UpgradeTransmissionLineAction {
  corridorId: string;
  financed: boolean;
}
interface BuildTransmissionLineAction {
  corridorId: string;
  financed: boolean;
  tier?: number;
}

interface NewGameAction {
  facilities: ScenarioFacilityType[];
  cash: number;
  customers: number;
  location: LocationType;
  seed?: number; // Omitted in normal play; pin it to get a reproducible run (headless sim, bug repros)
}

let previousTickMs = 0;
let accumulatedTickMs = 0;
// Only for environments without requestAnimationFrame; a browser presents at its display rate.
const MIN_PRESENTATION_INTERVAL_MS = 1000 / 60;
// A frame gap this long means the page was frozen, not slow, so the clock resumes where it
// stopped instead of fast-forwarding through the absence. This is the backstop for freezes that
// skip every hide event, such as an Android screen lock. The slowest real frame, a phone's month
// rollover, measured about 370 ms in the dev build (docs/perf-plan.md).
const MAX_FRAME_GAP_MS = 1000;
// A frame whose accumulated time is within this fraction of a step of a whole number of steps
// runs that whole number. Display timestamps jitter by a fraction of a millisecond, and without
// the snap a step that divides the frame evenly would still run 0, 2, 1, 1, 0, 2... ticks a frame.
// The remainder carries (briefly negative), so the long-run rate stays exact.
const TICK_SNAP = 0.25;
// Only for restoring speed after a blocking dialog (bankrupt/fired/win) closes -- NOT used to
// decide whether the tick loop needs restarting, since state.speed can change without going
// through setSpeed (e.g. dialogClose below), which would desync a "previous speed" comparison.
let speedBeforeDialog = "PAUSED" as SpeedType;
let dialogBlocksSpeed = false;
// Same idea for full-screen decision cards over a game that would otherwise keep ticking.
// Undefined whenever a card isn't what paused us, so leaving one never resumes a deliberate
// pause. Construction catalogs belong here too: the quote should not change while it is read.
let speedBeforeBlockingCard: SpeedType | undefined;
// The construction catalogs show the speed control, so the player may change speed while one is
// open. Every other blocking card keeps the clock frozen until it closes.
let blockingCardAllowsSpeed = false;
let speedBeforeManualHelp: SpeedType | undefined;
let speedBeforeCloudSavePrompt: SpeedType | undefined;
// While hidden, pause owners read and update this foreground speed; the real clock stays
// paused even if a dialog or card opens or closes before the page returns.
let speedBeforeHidden: SpeedType | undefined;
const BLOCKING_CARDS = new Set([
  "MAIN_MENU",
  "ACHIEVEMENTS",
  "SAVED_GAMES",
  "MODS",
  "MANUAL",
  "BUILD_GENERATORS",
  "BUILD_STORAGE",
  "BUILD_INTERTIES",
  "CHALLENGE",
  "NEW_GAME",
  "NEW_GAME_DETAILS",
  "CUSTOM_GAME",
  "DATA_CENTER_SETUP",
]);
// Tracks whether the self-rescheduling tick() loop is currently alive, so that any transition
// out of PAUSED (manual speed click, tutorial script, dialog closing) reliably restarts it.
let tickLoopRunning = false;
// Last month's fuel prices, to compare this month's against. Undefined before the first
// rollover of a run, and after resuming a save - the first month back reports no move rather
// than inventing one against prices from whenever the game was last open
let previousFuelPrices: FuelPricesType | undefined;
// How much history the log keeps. Long enough to cover the run a player is likely to scroll
// back through, short enough that it never becomes the biggest thing in a save file
const MAX_EVENTS = 100;

/**
 * How long a blackout lasted, in whichever unit reads honestly at that length.
 *
 * The game simulates one day per month, so an outage that runs into a second day has already
 * crossed a month boundary -- reporting that as "27h" reads as a bad night rather than as the
 * quarter of a year the calendar above it just moved through.
 */
function blackoutLength(minutes: number): string {
  if (minutes >= MINUTES_PER_MONTH) {
    const months = Math.round(minutes / MINUTES_PER_MONTH);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  return `${Math.max(1, Math.round(minutes / 60))}h`;
}

/**
 * Records something that happened to the company, newest first.
 *
 * Only ever called from a real tick or a player action: the forecast runs the same code over
 * months that haven't happened, and a log full of blackouts the player was never in would be
 * worse than no log at all.
 */
function logGameEvent(
  state: GameType,
  kind: GameEventKindType,
  message: string,
  options: {
    importance?: GameEventImportanceType;
    actionTarget?: GameEventType["actionTarget"];
    title?: string;
    concept?: GameEventType["concept"];
    storyPhaseKey?: string;
    turningPointPriority?: number;
    reportedKey?: string;
    pause?: boolean;
  } = {},
): boolean {
  if (
    options.reportedKey &&
    state.reportedEventKeys.includes(options.reportedKey)
  ) {
    return false;
  }
  const log = state.eventLog;
  log.unshift({
    id: (log.length > 0 ? log[0].id : 0) + 1,
    kind,
    label: `${state.date.month} ${state.date.year}`,
    message,
    importance: options.importance,
    actionTarget: options.actionTarget,
    title: options.title,
    concept: options.concept,
    storyPhaseKey: options.storyPhaseKey,
    turningPointPriority: options.turningPointPriority,
  });
  if (options.reportedKey) {
    state.reportedEventKeys.push(options.reportedKey);
  }
  if (log.length > MAX_EVENTS) {
    log.length = MAX_EVENTS;
  }
  // An important event creates a decision point and pauses the clock.
  if (options.pause) {
    state.speed = "PAUSED";
  }
  return true;
}

// How far a fuel has to move in a month to be worth a line in the log. Prices wander a percent
// or two on their own; this is the size of move that changes which plant is cheapest to run
const FUEL_PRICE_SPIKE = 0.15;

/**
 * Logs the fuels that moved sharply this month, for the fuels the fleet actually burns.
 *
 * A coal spike is not news to a company running on wind, and the fuel price chart in Forecasts
 * already draws every fuel for the player who wants them all.
 */
function logFuelPriceMoves(
  state: GameType,
  storyPriceFuels: ReadonlySet<FuelNameType> = new Set(),
) {
  const prices = getEffectiveFuelPrices(state.date, state);
  const previous = previousFuelPrices;
  previousFuelPrices = prices;
  if (!previous) {
    return;
  }
  const burned = new Set<FuelNameType>();
  state.facilities.forEach((f: FacilityOperatingType) => {
    if (f.fuel) {
      burned.add(f.fuel);
    }
  });
  burned.forEach((fuel) => {
    const before = previous[fuel];
    const after = prices[fuel];
    // Wind and sun are fuels the game names but nobody prices
    if (
      before === undefined ||
      after === undefined ||
      storyPriceFuels.has(fuel)
    ) {
      return;
    }
    const change = (after - before) / before;
    if (Math.abs(change) < FUEL_PRICE_SPIKE) {
      return;
    }
    logGameEvent(
      state,
      "FUEL_PRICE",
      `${fuel} ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% to ${formatMoneyConcise(after)}/MMBtu`,
    );
  });
}

const HOURS_PER_YEAR = 8760;
const WH_PER_MWH = 1000000;
const FUEL_CROSSOVER_MINIMUM_DIFFERENCE = 1;

/** All-in operating cost at expected annual output, excluding financing and sunk build cost. */
function generatorCostPerMWh(
  generator: GeneratorOperatingType,
  prices: FuelPricesType,
  feePerKgCO2e: number,
  operatingCostMultiplier = 1,
): number | undefined {
  if (
    generator.yearsToBuildLeft > 0 ||
    generator.peakW <= 0 ||
    generator.capacityFactor <= 0
  ) {
    return undefined;
  }
  const annualMWh =
    (generator.peakW * generator.capacityFactor * HOURS_PER_YEAR) / WH_PER_MWH;
  const fuelPrice = prices[generator.fuel];
  const fuelCost =
    generator.btuPerWh > 0 && fuelPrice !== undefined
      ? generator.btuPerWh * fuelPrice
      : 0;
  const carbonCost =
    generator.btuPerWh *
    WH_PER_MWH *
    feeableKgCO2ePerBtu(generator.fuel) *
    feePerKgCO2e;
  return (
    (estimatedAnnualOperatingCost(generator) * operatingCostMultiplier) /
      annualMWh +
    fuelCost +
    carbonCost
  );
}

function currentFuelCosts(
  state: GameType,
): Partial<Record<FuelNameType, number>> {
  const costs: Partial<Record<FuelNameType, number>> = {};
  const prices = getEffectiveFuelPrices(state.date, state);
  const operatingCostMultipliers = storyEffectsAt(
    state.date,
    state,
  ).operatingCostMultipliersByFuel;
  state.facilities.forEach((facility: FacilityOperatingType) => {
    if (isStorage(facility)) {
      return;
    }
    const cost = generatorCostPerMWh(
      facility,
      prices,
      effectiveCarbonFee(state.date, state),
      operatingCostMultipliers?.[facility.fuel] || 1,
    );
    if (cost === undefined) {
      return;
    }
    // A fuel can have several plants. The cheapest one is the one dispatch order can actually
    // choose at the margin, and avoids plant size turning the comparison into an average.
    costs[facility.fuel] = Math.min(costs[facility.fuel] ?? Infinity, cost);
  });
  return costs;
}

/** Reports only the first cheaper-to-dearer ordering change for each fuel in a run. */
export function logFuelCrossovers(state: GameType) {
  const current = currentFuelCosts(state);
  const previous = state.fuelCostSnapshot;
  state.fuelCostSnapshot = current;
  if (!previous) {
    return;
  }
  (Object.entries(current) as [FuelNameType, number][]).forEach(
    ([fuel, cost]) => {
      if (cost === undefined || (FUELS[fuel]?.kgCO2ePerBtu || 0) <= 0) {
        return;
      }
      const previousCost = previous[fuel];
      if (previousCost === undefined) {
        return;
      }
      const crossed = (Object.entries(current) as [FuelNameType, number][])
        .filter(([otherFuel, otherCost]) => {
          const previousOther = previous[otherFuel];
          return (
            otherFuel !== fuel &&
            otherCost !== undefined &&
            previousOther !== undefined &&
            previousCost <= previousOther &&
            cost - otherCost >= FUEL_CROSSOVER_MINIMUM_DIFFERENCE
          );
        })
        // If one fuel passed several in the same month, name the cheapest comparator: that is
        // the clearest dispatch consequence and the largest gap the player can act on.
        .sort((a, b) => a[1] - b[1])[0];
      if (!crossed || crossed[1] === undefined) {
        return;
      }
      const otherFuel = crossed[0];
      logGameEvent(
        state,
        "FUEL_CROSSOVER",
        `${fuel} is now more expensive than ${otherFuel}: ${formatMoneyConcise(cost)}/MWh vs ${formatMoneyConcise(crossed[1])}/MWh`,
        {
          importance: "NOTABLE",
          actionTarget: { card: "FACILITIES", view: "FLEET" },
          // News rather than a turning point: the UI toasts it, the clock keeps running
          reportedKey: `fuel-crossover:${fuel}`,
        },
      );
    },
  );
}

const MAX_WORLD_EVENT_CHECKS = 2400;

/** All story entry points share the same definitions, activation facts and observations. */
function storyContextAt(state: GameType, date = state.date) {
  const rules = scenarioRules(
    getScenario(state.scenarioId, state.customScenario),
    state,
  );
  return {
    rules,
    seed: state.seed,
    scenarioId: state.scenarioId,
    customEvents: customEventContext(state.customScenario),
    difficulty: state.difficulty,
    date,
    location: state.location,
    snapshot: buildStorySnapshot(
      state.monthlyHistory,
      state.facilities,
      date.minute,
    ),
    occurrences:
      rules && date.minute > state.date.minute
        ? scenarioRuleForecastOccurrences(
            rules,
            state.worldEvents.occurrences,
            date.monthsElapsed,
          )
        : state.worldEvents.occurrences,
    monthlyHistory: state.monthlyHistory,
    completedMonths: state.date.monthsElapsed,
    startingRateDollarsPerKWh: getScenario(
      state.scenarioId,
      state.customScenario,
    )?.dollarsPerkWh,
    endingRateDollarsPerKWh: state.dollarsPerkWh,
  };
}

function openingRuleTransactions(state: GameType) {
  return state.worldEvents.occurrences
    .filter(
      (event) =>
        event.attributes.ruleEvent === true &&
        event.startsMinute === state.date.minute,
    )
    .reduce(
      (sum, event) =>
        sum +
        Number(event.attributes.upfrontGrant ?? 0) -
        Number(event.attributes.cost ?? 0),
      0,
    );
}

/** A standing program must outlive the bounded historical event log that records its changes. */
function trimWorldEventOccurrences(state: GameType) {
  const occurrences = state.worldEvents.occurrences;
  if (occurrences.length <= MAX_WORLD_EVENT_CHECKS) return;
  const retained = occurrences.slice(-MAX_WORLD_EVENT_CHECKS);
  // Rules are bounded at compilation. Their receipts and onset identities are run facts,
  // independent of the rolling regional-hazard log.
  const retainedSet = new Set(retained);
  const rules = scenarioRules(
    getScenario(state.scenarioId, state.customScenario),
    state,
  );
  const declaredKeys = new Set(
    rules ? ruleEvents(rules).map((event) => event.key) : [],
  );
  state.worldEvents.occurrences = occurrences.filter(
    (event) =>
      retainedSet.has(event) ||
      declaredKeys.has(event.key) ||
      event.attributes.ruleEvent === true ||
      event.attributes.ruleEventEnd === true ||
      event.attributes.ruleObservation === true ||
      (rules &&
        event.attributes.scenarioChoice === true &&
        !event.key.startsWith("wildfire:")),
  );
}

/** Starts/ends authored events before this month's forecast is built. */
function updateWorldEvents(state: GameType): Set<FuelNameType> {
  const storyPriceFuels = new Set<FuelNameType>();
  state.worldEvents.active.forEach((event) => {
    if (event.endsMinute <= state.date.minute) {
      Object.keys(event.effects.fuelPriceMultipliers || {}).forEach((fuel) =>
        storyPriceFuels.add(fuel as FuelNameType),
      );
    }
  });
  state.worldEvents.active = state.worldEvents.active.filter(
    (event) => event.endsMinute > state.date.minute,
  );
  if (
    state.storyEffectsDisabled ||
    (!scenarioRules(
      getScenario(state.scenarioId, state.customScenario),
      state,
    ) &&
      !state.customScenario?.eventScenarioIds?.length)
  ) {
    return storyPriceFuels;
  }
  const context = storyContextAt(state);
  captureRuleReportObservation(state, context);
  const resolved = resolveStoryAtDate({
    ...context,
    periodSnapshots: Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((months) => [
        months,
        buildStoryPeriodSnapshot(state.monthlyHistory, months),
      ]),
    ),
  });
  resolved.occurrences.forEach((occurrence) => {
    if (
      state.worldEvents.checkedKeys.includes(occurrence.key) ||
      state.worldEvents.occurrences.some(
        (event) => event.key === occurrence.key,
      )
    ) {
      return;
    }
    state.worldEvents.checkedKeys.push(occurrence.key);
    state.worldEvents.active.push(occurrence);
    state.worldEvents.occurrences.push(occurrence);
    Object.keys(occurrence.effects.fuelPriceMultipliers || {}).forEach((fuel) =>
      storyPriceFuels.add(fuel as FuelNameType),
    );
    logGameEvent(state, occurrence.kind, occurrence.message, {
      importance: occurrence.importance,
      actionTarget: occurrence.actionTarget,
      title: occurrence.title,
      concept: occurrence.concept,
      storyPhaseKey: occurrence.key,
      turningPointPriority: occurrence.turningPointPriority,
      reportedKey: occurrence.key,
      // The timeline showed these coming, so their arrival is the decision point the player was
      // waiting for. A phase the timeline never announced only stops the clock if it's critical
      pause:
        occurrence.forecastable !== false ||
        occurrence.importance === "CRITICAL",
    });
  });
  if (state.worldEvents.checkedKeys.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.checkedKeys.splice(
      0,
      state.worldEvents.checkedKeys.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  trimWorldEventOccurrences(state);
  if (context.rules) {
    const replaced = scenarioRuleReplacedLoadIds(
      context.rules,
      state.worldEvents.occurrences,
    );
    for (const load of context.rules.loads) {
      const key = ruleLoadKey(context.rules, load.id);
      if (
        replaced.has(key) ||
        !ruleConditionMet(
          load.requiresChoice,
          context.rules,
          state.worldEvents.occurrences,
        ) ||
        state.loadAdditions.some((existing) => existing.id === key)
      )
        continue;
      const {
        eventId: _eventId,
        startMonth: _startMonth,
        requiresChoice: _requiresChoice,
        ...addition
      } = load;
      state.loadAdditions.push({ ...addition, id: key });
    }
    state.loadAdditions = scenarioRuleLoadOrder(state.loadAdditions);
  }
  return storyPriceFuels;
}

/** Keeps the hazard dedupe and occurrence records bounded, like the authored-story path. */
function trimWorldEventRecords(state: GameType) {
  if (state.worldEvents.checkedKeys.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.checkedKeys.splice(
      0,
      state.worldEvents.checkedKeys.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  trimWorldEventOccurrences(state);
}

// Below this share of the solar fleet, hail on hail-resistant panels is logged without pausing.
const NEGLIGIBLE_RESISTANT_HAIL_SHARE = 0.05;

function formatDays(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Hail and extreme-cold checks at monthly rollover, after the authored story, before
 * the month's forecast is built. Each check is keyed by (hazard, location, absolute month) and
 * every draw is addressed, so saving, forecasting or reordering the fleet cannot reroll it and a
 * resumed month cannot announce twice. Hail persists one occurrence per damaged solar facility,
 * lasting until its repair ends and charging its repair cost once; cold persists one occurrence
 * for the month that derates under-rated gas plants and, when regional, raises gas prices.
 * Returns the fuels whose price this changed, for the month's fuel-price log.
 */
function updateWeatherHazards(state: GameType): Set<FuelNameType> {
  const priceFuels = new Set<FuelNameType>();
  const locationId = state.location.id;
  const monthsElapsed = state.date.monthsElapsed;
  const startsMinute = monthsElapsed * MINUTES_PER_MONTH;
  if (isWeatherHazardEligible(state, "HAIL")) {
    const key = hazardEventKey("HAIL", locationId, monthsElapsed);
    if (!state.worldEvents.checkedKeys.includes(key)) {
      state.worldEvents.checkedKeys.push(key);
      if (hailOccurs(state, key, state.date.monthNumber - 1)) {
        recordHailStorm(state, key, startsMinute);
      }
    }
  }
  if (isWeatherHazardEligible(state, "EXTREME_COLD")) {
    const key = hazardEventKey("EXTREME_COLD", locationId, monthsElapsed);
    if (!state.worldEvents.checkedKeys.includes(key)) {
      state.worldEvents.checkedKeys.push(key);
      if (recordColdSnap(state, key, startsMinute)) {
        priceFuels.add("Natural Gas");
      }
    }
  }
  trimWorldEventRecords(state);
  return priceFuels;
}

function recordHailStorm(state: GameType, key: string, startsMinute: number) {
  const impacts = sampleHailImpacts({ game: state, key });
  // A storm that misses every array is not news to the company.
  if (!impacts.length) return;
  const chargeMinute = oneTimeCostMinute(startsMinute);
  const occurrences: ActiveWorldEventType[] = impacts.map((impact) => ({
    key: `${key}:f${impact.facilityId}`,
    definitionId: HAIL_DEFINITION_ID,
    startsMinute,
    endsMinute: startsMinute + impact.repairMinutes,
    forecastable: false,
    title: "Hail damage",
    message: `Hail damaged ${Math.round(impact.damagedFraction * 100)}% of ${impact.facilityName}.`,
    concept: "severeWeather",
    importance: "CRITICAL",
    actionTarget: { card: "FACILITIES", view: "FLEET" },
    attributes: {
      hazard: "HAIL",
      eventKey: key,
      facilityId: impact.facilityId,
      facilityName: impact.facilityName,
      damagedFraction: impact.damagedFraction,
      repairDays: impact.repairDays,
      repairCost: impact.repairCost,
      hailResistant: impact.hailResistant,
      oneTimeCost: impact.repairCost,
      oneTimeCostMinute: chargeMinute,
    },
    effects: {
      facilityOutputMultipliersById: {
        [String(impact.facilityId)]: 1 - impact.damagedFraction,
      },
    },
  }));
  state.worldEvents.active.push(...occurrences);
  state.worldEvents.occurrences.push(...occurrences);
  const solarW = state.facilities
    .filter((f) => f.fuel === "Sun" && f.yearsToBuildLeft <= 0)
    .reduce((total, f) => total + f.peakW, 0);
  const damagedW = impacts.reduce((total, impact) => {
    const facility = state.facilities.find(
      ({ id }) => id === impact.facilityId,
    );
    return total + (facility?.peakW || 0) * impact.damagedFraction;
  }, 0);
  const share = solarW > 0 ? damagedW / solarW : 0;
  const repairCost = impacts.reduce((total, i) => total + i.repairCost, 0);
  const repairDays = Math.max(...impacts.map((i) => i.repairDays));
  const negligible =
    impacts.every((i) => i.hailResistant) &&
    share < NEGLIGIBLE_RESISTANT_HAIL_SHARE;
  const percent = Math.max(1, Math.round(share * 100));
  const terms = `Repairs cost ${formatMoneyConcise(repairCost)} and take about ${formatDays(repairDays)}.`;
  const message = negligible
    ? `Hail-resistant panels held damage to ${percent}% of your solar fleet. ${terms}`
    : `Hail damaged ${percent}% of your solar fleet. ${terms}`;
  logGameEvent(state, "WORLD_EVENT", message, {
    importance: negligible ? "NOTABLE" : "CRITICAL",
    actionTarget: { card: "FACILITIES", view: "FLEET" },
    title: negligible ? "Minor hail damage" : "Hail damage",
    concept: "severeWeather",
    storyPhaseKey: key,
    turningPointPriority: negligible ? undefined : 110,
    reportedKey: key,
    pause: !negligible,
  });
}

/** Persists and announces this month's cold snap; returns whether gas prices spiked. */
function recordColdSnap(
  state: GameType,
  key: string,
  startsMinute: number,
): boolean {
  const minTempC = representativeMinTempC(
    state.date,
    state.seed,
    storyEffectsAt(state.date, state).temperatureOffsetC || 0,
  );
  const impact = resolveColdImpact({ game: state, key, minTempC });
  if (!impact) return false;
  // An authored gas shock this month already prices in some of the strain, so the cold snap only
  // lifts the combined multiple to the same cap a deep freeze alone could reach.
  const storyGasMultiplier =
    storyEffectsAt(state.date, state).fuelPriceMultipliers?.["Natural Gas"] ??
    1;
  const gasPriceMultiplier = impact.regional
    ? Math.max(
        1,
        Math.min(
          impact.gasPriceMultiplier,
          COLD_MAX_GAS_PRICE_MULTIPLIER / Math.max(1, storyGasMultiplier),
        ),
      )
    : 1;
  const raisesGasPrice = gasPriceMultiplier > 1;
  const affectedIds = impact.derates.map((d) => d.facilityId);
  const affectedNames = impact.derates.map((d) => d.facilityName);
  const effects: WorldEventEffectsType = {};
  if (raisesGasPrice) {
    effects.fuelPriceMultipliers = { "Natural Gas": gasPriceMultiplier };
  }
  if (impact.derates.length) {
    effects.facilityOutputMultipliersById = Object.fromEntries(
      impact.derates.map((d) => [String(d.facilityId), d.availableFraction]),
    );
  }
  // The temperature stays in the attributes: the log text cannot follow the player's unit setting.
  const parts: string[] = [];
  if (raisesGasPrice) {
    parts.push(
      `Gas prices are ${gasPriceMultiplier.toFixed(1)}× normal this month as regional supply strains`,
    );
  } else if (impact.regional) {
    parts.push("Regional gas supply is strained");
  }
  if (impact.derates.length) {
    const lowest = Math.min(...impact.derates.map((d) => d.availableFraction));
    const percent = Math.round(lowest * 100);
    parts.push(
      affectedNames.length === 1
        ? `${affectedNames[0]} is limited to ${percent}% output`
        : `${affectedNames.join(", ")} are limited to as little as ${percent}% output`,
    );
  }
  const protectedNames = impact.protectedFacilityIds
    .map((id) => state.facilities.find((f) => f.id === id)?.name)
    .filter((name): name is string => !!name);
  const protectedNote = protectedNames.length
    ? ` Cold-weather packages kept ${protectedNames.join(", ")} running.`
    : "";
  // The log title already says "Extreme cold", so the message starts with what it means.
  const message = `${parts.join("; ")}.${protectedNote}`;
  const burnsGas = state.facilities.some(
    (f) => f.fuel === "Natural Gas" && f.yearsToBuildLeft <= 0,
  );
  const critical = impact.derates.length > 0 || (impact.regional && burnsGas);
  const occurrence: ActiveWorldEventType = {
    key,
    definitionId: COLD_DEFINITION_ID,
    startsMinute,
    endsMinute: startsMinute + MINUTES_PER_MONTH,
    forecastable: false,
    title: "Extreme cold",
    message,
    concept: "severeWeather",
    importance: critical ? "CRITICAL" : "NOTABLE",
    actionTarget: { card: "FACILITIES", view: "FLEET" },
    attributes: {
      hazard: "EXTREME_COLD",
      eventKey: key,
      minTempC,
      regional: impact.regional,
      gasPriceMultiplier,
      affectedFacilityIds: affectedIds,
      affectedFacilityNames: affectedNames,
      protectedFacilityIds: impact.protectedFacilityIds,
    },
    effects,
  };
  state.worldEvents.active.push(occurrence);
  state.worldEvents.occurrences.push(occurrence);
  logGameEvent(state, "WORLD_EVENT", message, {
    importance: occurrence.importance,
    actionTarget: occurrence.actionTarget,
    title: occurrence.title,
    concept: "severeWeather",
    storyPhaseKey: key,
    turningPointPriority: critical ? 105 : undefined,
    reportedKey: key,
    pause: critical,
  });
  return raisesGasPrice;
}

/**
 * Logs each facility whose hail repairs finished in the tick that just ran and that no other
 * weather hazard still limits. Driven from the clock rather than the timeline, whose prev and now
 * frames coincide on a month's rollover tick.
 */
/**
 * Installs every retrofit whose month offline has ended. Runs once per real tick, right after the
 * clock advances and before a new month's weather hazards are drawn, so a plant finishing at the
 * rollover meets that month's weather with its upgrade. Forecasts use isUpgradingAt for the outage
 * and install technology conversions on their private fleet in supplyForecastPass.
 */
function completeRetrofits(state: GameType, simulated = false) {
  state.facilities.forEach((facility) => {
    const upgrade = upgradeInProgress(facility);
    if (!upgrade || state.date.minute < upgrade.completesMinute) return;
    const context = state;
    if (!context) return;
    if (upgrade.upgrade === "combinedCycle") {
      completeGasConversion(facility, context);
      if (!simulated) desktopSimulationHooks()?.converted(state, facility.id);
    } else
      facility.resilience = retrofittedResilience(
        facility,
        context,
        upgrade.upgrade,
      );
    delete facility.upgradeInProgress;
    if (simulated) return;
    // Staged winterization keeps the plant running, so it never comes back online.
    const message =
      upgrade.upgrade === "coldWeatherPackage"
        ? `Upgrade complete: ${facility.name} now has ${retrofitLabel(upgrade.upgrade)}`
        : `Upgrade complete: ${facility.name} is back online with ${retrofitLabel(upgrade.upgrade)}`;
    logGameEvent(state, "CONSTRUCTION", message, {
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    });
    if (!state.multiplayer)
      setTimeout(() => {
        getStore().dispatch(snackbarOpen(message));
      }, 0);
  });
}

function logHailRepairsCompleted(state: GameType) {
  const minute = state.date.minute;
  const logged = new Set<number>();
  state.worldEvents.active.forEach((event) => {
    if (
      event.definitionId !== HAIL_DEFINITION_ID ||
      !(minute - TICK_MINUTES < event.endsMinute && event.endsMinute <= minute)
    ) {
      return;
    }
    const facility = state.facilities.find(
      ({ id }) => id === event.attributes.facilityId,
    );
    // Sold while under repair, or a later facility that reused the ID.
    if (!facility || event.startsMinute < (facility.minuteCreated || 0)) {
      return;
    }
    if (
      logged.has(facility.id) ||
      activeWeatherHazardsFor(state, facility, minute).length
    ) {
      return;
    }
    logged.add(facility.id);
    logGameEvent(
      state,
      "WORLD_EVENT",
      `${facility.name} is back to full output.`,
      {
        importance: "NOTABLE",
        actionTarget: { card: "FACILITIES", view: "FLEET" },
        title: "Hail repairs complete",
        // Restored output is good news, so it takes the green supply icon, not the amber storm.
        concept: "supply",
        storyPhaseKey: event.key,
        reportedKey: `hail-repair:${event.key}`,
      },
    );
  });
}

/**
 * Ends a sold or cancelled facility's weather-hazard outages at once. IDs are reused (max + 1),
 * so a lingering multiplier would otherwise limit whichever facility is built next under that ID.
 * A repair cost already incurred still falls due; only the facility's output effect is removed.
 */
function endWeatherHazardsForFacility(state: GameType, id: number) {
  const key = String(id);
  const minute = state.date.minute;
  let edited = false;
  state.worldEvents.active = state.worldEvents.active.map((event) => {
    if (
      (event.definitionId !== HAIL_DEFINITION_ID &&
        event.definitionId !== COLD_DEFINITION_ID) ||
      event.effects.facilityOutputMultipliersById?.[key] === undefined
    ) {
      return event;
    }
    edited = true;
    const multipliers = { ...event.effects.facilityOutputMultipliersById };
    delete multipliers[key];
    const effects = { ...event.effects };
    if (Object.keys(multipliers).length) {
      effects.facilityOutputMultipliersById = multipliers;
    } else {
      delete effects.facilityOutputMultipliersById;
    }
    return {
      ...event,
      effects,
      endsMinute:
        event.definitionId === HAIL_DEFINITION_ID
          ? Math.min(event.endsMinute, minute)
          : event.endsMinute,
    };
  });
  // Selling changes the affected equipment; discard cached effects after the edit.
  if (edited) storyEffectsCache.clear();
}

/**
 * Scheduled effects for any simulated date. Persisted live occurrences win over a newly resolved
 * copy, which is what preserves facility IDs and other onset-time attributes after they are drawn.
 */
const storyEffectsCache = new Map<string, WorldEventEffectsType>();

/**
 * storyEffectsAt runs several times per forecast tick, and serializing every occurrence for each
 * call was a third of a simulated month's work. Occurrences are only ever appended, trimmed from
 * the front, or replaced wholesale -- never edited in place -- so an array whose length and last
 * entry are unchanged still serializes the same. Each distinct serialization is interned to a
 * short id so that cache keys stay cheap to hash.
 */
let occurrencesKeyCache = new WeakMap<
  ActiveWorldEventType[],
  { length: number; last: ActiveWorldEventType | undefined; id: number }
>();
const occurrencesKeyIds = new Map<string, number>();

function occurrencesKey(occurrences: ActiveWorldEventType[]): number {
  const last = occurrences[occurrences.length - 1];
  const cached = occurrencesKeyCache.get(occurrences);
  if (cached && cached.length === occurrences.length && cached.last === last) {
    return cached.id;
  }
  const json = JSON.stringify(
    occurrences.map((event) => [
      event.key,
      event.startsMinute,
      event.endsMinute,
      event.attributes,
      event.effects,
    ]),
  );
  let id = occurrencesKeyIds.get(json);
  if (id === undefined) {
    if (occurrencesKeyIds.size > 10000) {
      // Ids must never be reused for a different serialization while a key built on them is live
      occurrencesKeyIds.clear();
      occurrencesKeyCache = new WeakMap();
      storyEffectsCache.clear();
    }
    id = occurrencesKeyIds.size;
    occurrencesKeyIds.set(json, id);
  }
  occurrencesKeyCache.set(occurrences, {
    length: occurrences.length,
    last,
    id,
  });
  return id;
}

function scheduledStoryCacheKey(date: DateType, state: GameType): string {
  const fleetSensitive =
    !!scenarioRules(
      getScenario(state.scenarioId, state.customScenario),
      state,
    ) || !!state.customScenario?.eventScenarioIds?.length;
  const fleetKey = fleetSensitive
    ? state.facilities
        .map((facility) =>
          [
            facility.id,
            facility.fuel,
            facility.peakW,
            facility.yearsToBuildLeft <= 0,
            facility.paused,
            facility.minuteOperational,
            facility.minuteCreated,
            facility.startingAssetId,
          ].join(":"),
        )
        .sort()
        .join(";")
    : "";
  return [
    state.scenarioId,
    state.customScenario?.mod?.runtimeDigest ??
      scenarioRulesIdentity(
        scenarioRules(
          getScenario(state.scenarioId, state.customScenario),
          state,
        ),
      ),
    JSON.stringify(customEventContext(state.customScenario)),
    state.difficulty,
    state.seed,
    date.monthsElapsed,
    fleetKey,
    occurrencesKey(state.worldEvents.occurrences),
  ].join("|");
}

function storyEffectsAt(date: DateType, state: GameType) {
  const activeKey = state.worldEvents.active
    .map((event) => JSON.stringify([event.key, event.effects]))
    .join("|");
  const lastOccurrence = state.worldEvents.occurrences.at(-1);
  // Immer produces a fresh draft identity on every reducer call and forecasts use shallow state
  // copies, so an object-keyed WeakMap missed almost every lookup. These are the stable inputs
  // that can change a month's resolved effects; using them lets live play and both forecast
  // passes share one result without changing the authored story decision.
  // Persisted occurrences can start or end mid-month (a hail repair), so which of them cover
  // this minute is part of the key; the rest of the key only resolves to the month.
  const inWindowKey = state.worldEvents.active
    .filter(
      (event) =>
        date.minute >= event.startsMinute && date.minute < event.endsMinute,
    )
    .map((event) => event.key)
    .join("|");
  const cacheKey = [
    scheduledStoryCacheKey(date, state),
    state.storyEffectsDisabled ? 1 : 0,
    activeKey,
    inWindowKey,
    state.worldEvents.occurrences.length,
    lastOccurrence?.key || "",
  ].join("|");
  const cached = storyEffectsCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const context = storyContextAt(state, date);
  const persisted = state.worldEvents.active
    .filter(
      (event) =>
        date.minute >= event.startsMinute && date.minute < event.endsMinute,
    )
    .map((event) => ({
      ...event,
      effects: ruleEffectsForOccurrence(event, context),
    }));
  if (
    state.storyEffectsDisabled ||
    (!context.rules && !state.customScenario?.eventScenarioIds?.length)
  ) {
    const effects = combineStoryEffects(persisted);
    storyEffectsCache.set(cacheKey, effects);
    return effects;
  }
  const persistedKeys = new Set(persisted.map((event) => event.key));
  const scheduled = resolveStoryAtDate({
    ...context,
  }).active.filter(
    (event) =>
      !persistedKeys.has(event.key) &&
      (event.forecastable !== false || date.minute <= state.date.minute),
  );
  const effects = combineStoryEffects([...persisted, ...scheduled]);
  if (storyEffectsCache.size > 10000) {
    storyEffectsCache.clear();
  }
  storyEffectsCache.set(cacheKey, effects);
  return effects;
}

function effectiveCarbonFee(date: DateType, state: GameType): number {
  return storyEffectsAt(date, state).carbonFeePerKgCO2e ?? state.feePerKgCO2e;
}

function getEffectiveFuelPrices(
  date: DateType,
  state: GameType,
  effects = storyEffectsAt(date, state),
): FuelPricesType {
  const prices = getFuelPricesPerMBTU(date, state.seed, state.location);
  const multipliers = effects.fuelPriceMultipliers;
  if (!multipliers) {
    return prices;
  }
  const effective = { ...prices };
  (Object.entries(multipliers) as [FuelNameType, number][]).forEach(
    ([fuel, multiplier]) => {
      const price = effective[fuel];
      if (multiplier !== undefined && price !== undefined) {
        effective[fuel] = price * multiplier;
      }
    },
  );
  return effective;
}

const initialGame: GameType = {
  seed: newSeed(),
  scenarioId: 0,
  location: LOCATIONS["SF"],
  difficulty: "Employee",
  speed: "PAUSED",
  inGame: false,
  feePerKgCO2e: 0, // Start on easy mode
  dollarsPerkWh: 0.07,
  customerMarketSize: 0,
  customerRate: 0.07,
  startingDemandScale: 1,
  loadAdditions: [],
  // Placeholders until initGame prices the company against the year it actually starts in. The
  // new game screens read these before any economic data has been loaded.
  interestRate: INTEREST_RATE_YEARLY,
  creditPremium: 1,
  tutorialStep: -1, // Not set to 0 until after card transition, so that the target element exists
  commissionedHydroSiteIds: [],
  facilities: [] as FacilityOperatingType[],
  startingYear: 2020,
  date: getDateFromMinute(0, 2020),
  timeline: [] as TickPresentFutureType[],
  monthlyHistory: [] as MonthlyHistoryType[],
  eventLog: [] as GameEventType[],
  reportedEventKeys: [],
  eventLogReadThroughId: 0,
  worldEvents: { active: [], occurrences: [], checkedKeys: [] },
  transmission: emptyTransmissionState(),
  meaningfulDecisions: [],
  meaningfulDecisionGateWaived: false,
};

// Restarts the self-rescheduling tick() loop when leaving PAUSED, unless it's already running.
// Using a "is it running" flag rather than comparing against a remembered previous speed means
// this works no matter how state.speed changed (setSpeed, dialogClose, or a future caller).
function ensureTicking(state: GameType) {
  if (state.multiplayer) return;
  if (state.speed !== "PAUSED" && !tickLoopRunning) {
    tickLoopRunning = true;
    previousTickMs = performance.now();
    accumulatedTickMs = 0;
    scheduleTick(state.speed);
  }
}

function dispatchTick() {
  getStore().dispatch(gameSlice.actions.tick());
}

// Presents on display frames, so a step that divides the frame evenly lands the same number of
// ticks on every frame at 60 or 120 Hz. Frames that are not yet owed a tick skip the dispatch
// entirely, which keeps SLOW from committing an empty update to React on every frame.
function scheduleTick(speed: SpeedType) {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(
      dispatchTick,
      Math.max(TICK_MS[speed], MIN_PRESENTATION_INTERVAL_MS),
    );
    return;
  }
  const onFrame = () => {
    const game = getStore().getState().game;
    const stepMs = TICK_MS[game.speed];
    const owedMs =
      accumulatedTickMs + Math.max(0, performance.now() - previousTickMs);
    // A stopped or paused clock still dispatches once, so the reducer can end the loop
    if (
      !game.inGame ||
      game.speed === "PAUSED" ||
      owedMs + stepMs * TICK_SNAP >= stepMs
    ) {
      dispatchTick();
    } else {
      requestAnimationFrame(onFrame);
    }
  };
  requestAnimationFrame(onFrame);
}

// Backgrounding is an outer pause: UI transitions still update the speed to restore,
// but may never restart the actual clock until the page is visible.
function foregroundSpeed(state: GameType): SpeedType {
  return speedBeforeCloudSavePrompt ?? speedBeforeHidden ?? state.speed;
}

function setForegroundSpeed(state: GameType, speed: SpeedType) {
  if (speedBeforeCloudSavePrompt !== undefined) {
    speedBeforeCloudSavePrompt = speed;
  } else if (speedBeforeHidden !== undefined) {
    speedBeforeHidden = speed;
  } else {
    state.speed = speed;
  }
}

function enterBlockingCard(state: GameType, name: string) {
  if (!state.inGame) return;
  const enteringFlow = speedBeforeBlockingCard === undefined;
  if (enteringFlow) {
    speedBeforeBlockingCard =
      state.policyPause?.speed ?? foregroundSpeed(state);
    delete state.policyPause;
  }
  blockingCardAllowsSpeed = name.startsWith("BUILD_");
  // Build tabs retain a chosen speed; strict destinations always freeze their own clock.
  if (enteringFlow || !blockingCardAllowsSpeed)
    setForegroundSpeed(state, "PAUSED");
}

// Puts the clock back the way the player left it before a full-screen card paused it
function restoreSpeedAfterBlockingCard(state: GameType) {
  if (speedBeforeBlockingCard === undefined) {
    return;
  }
  // Only put the old speed back if the clock is still paused; a speed picked while the card was
  // open is the player's newer choice
  if (foregroundSpeed(state) === "PAUSED") {
    setForegroundSpeed(state, speedBeforeBlockingCard);
  }
  speedBeforeBlockingCard = undefined;
  blockingCardAllowsSpeed = false;
  ensureTicking(state);
}

export const gameSlice = createSlice({
  name: "game",
  initialState: initialGame,
  reducers: {
    tick: (state) => {
      if (!state.inGame || state.speed === "PAUSED" || state.multiplayer) {
        tickLoopRunning = false;
        return;
      }
      tickLoopRunning = true;

      // Accumulate wall time before doing any simulation work. The old loop reset its timestamp
      // inside every iteration, losing both reducer time and the fractional remainder. That made
      // the clock run slower precisely when a frame was expensive. Batching every step owed
      // since the last frame preserves each deterministic tick while giving React at most one
      // update per display frame.
      const nowMs = performance.now();
      accumulatedTickMs += Math.min(
        Math.max(0, nowMs - previousTickMs),
        MAX_FRAME_GAP_MS,
      );
      previousTickMs = nowMs;
      const simulationStepMs = TICK_MS[state.speed];
      // Catch-up ticks share one private state. Snapshotting the modified draft again for every
      // step recursively copied the whole forecast and fleet, magnifying a dropped frame into
      // a more expensive next frame.
      const snapshot =
        accumulatedTickMs + simulationStepMs * TICK_SNAP >= simulationStepMs
          ? current(state)
          : undefined;
      const working = snapshot ? tickWorkingState(snapshot) : state;
      while (
        accumulatedTickMs + simulationStepMs * TICK_SNAP >=
        simulationStepMs
      ) {
        if (snapshot) tickWorkingStateStep(working, currentRunSaveEffects());
        else tickState(working, currentRunSaveEffects());
        accumulatedTickMs -= simulationStepMs;
        if (!working.inGame || (working.speed as SpeedType) === "PAUSED") {
          if (snapshot) adoptTickWorkingState(state, snapshot, working);
          tickLoopRunning = false;
          return;
        }
      }

      if (snapshot) adoptTickWorkingState(state, snapshot, working);
      scheduleTick(state.speed);
    },
    delta: (state, action: PayloadAction<Partial<GameType>>) => {
      // Mutate the draft for a partial merge; Immer rejects mutating and replacing it together.
      const {
        policies: _policies,
        policyPause: _policyPause,
        scenarioChoicePause: _scenarioChoicePause,
        objectiveProgress: _objectiveProgress,
        ...payload
      } = action.payload;
      if (
        state.runIdentity &&
        [
          "seed",
          "difficulty",
          "scenarioId",
          "customScenario",
          "location",
          "storyEffectsDisabled",
          "weatherHazardsDisabled",
          "meaningfulDecisionGateWaived",
        ].some((key) =>
          Object.prototype.hasOwnProperty.call(action.payload, key),
        )
      ) {
        state.runIdentity = undefined;
      }
      normalizeRateDelta(state, payload);
      const rateBefore = state.dollarsPerkWh;
      Object.assign(state, payload);
      const rateChanged =
        typeof payload.dollarsPerkWh === "number" &&
        Number.isFinite(payload.dollarsPerkWh) &&
        payload.dollarsPerkWh >= 0 &&
        payload.dollarsPerkWh !== rateBefore;
      if (rateChanged) {
        recordMeaningfulDecision(state, {
          lever: "rate",
          label: "Set the customer electricity rate",
          kind: "rate",
          before: String(rateBefore),
          after: String(payload.dollarsPerkWh),
        });
      }
    },
    initGame: (state, action: PayloadAction<NewGameAction>) => {
      delete state.desktopAchievements;
      delete state.lowCashWarningMonth;
      delete state.objectiveProgress;
      delete state.tutorialIntertieStress;
      delete state.utilityExpansion;
      delete state.policies;
      delete state.policyPause;
      const a = action.payload;
      delete state.blackout;
      previousFuelPrices = undefined;
      state.eventLog = [];
      state.reportedEventKeys = [];
      state.eventLogReadThroughId = 0;
      state.worldEvents = { active: [], occurrences: [], checkedKeys: [] };
      state.fuelCostSnapshot = undefined;
      state.meaningfulDecisions = [];
      state.transmission = undefined;
      state.timeline = [];
      state.seed = a.seed !== undefined ? a.seed : newSeed();
      const scenario =
        getScenario(state.scenarioId, state.customScenario) || SCENARIOS[0];
      if (scenario.id === CUSTOM_SCENARIO_ID && scenario.rules !== undefined)
        throw new Error(
          "Community rules require a validated Modded · Unranked snapshot.",
        );
      if (
        scenario.mod &&
        (!validScenarioMod(scenario.mod, scenario) ||
          scenario.mod.parameters.difficulty !== state.difficulty ||
          scenario.mod.parameters.seed !== state.seed ||
          a.cash !== scenario.cash ||
          a.customers !==
            (scenario.startingCustomers ??
              getStartingCustomers(getScenarioLocation(scenario))) ||
          canonicalRuleJson(a.facilities) !==
            canonicalRuleJson(scenario.facilities) ||
          canonicalRuleJson(a.location) !==
            canonicalRuleJson(getScenarioLocation(scenario)))
      )
        throw new Error(
          "This mod's runtime snapshot is invalid. Reimport a valid package before playing.",
        );
      const canonicalIdentity = captureRunIdentity(
        scenario,
        state.seed,
        state.difficulty,
        {
          location: a.location,
          facilities: a.facilities,
          cash: a.cash,
          customers: a.customers,
          meaningfulDecisionGateWaived: !!state.meaningfulDecisionGateWaived,
        },
        scenario.tutorialSteps
          ? "tutorial"
          : state.customScenario
            ? "custom"
            : "authored",
      );
      state.runIdentity =
        !state.storyEffectsDisabled &&
        projectAuthoredRunReference(canonicalIdentity)
          ? canonicalIdentity
          : undefined;
      const checkpoint =
        scenario.tutorialSteps?.[state.tutorialStep]?.capstone?.checkpoint;
      const startingCash = checkpoint?.cash ?? a.cash;
      const startingCustomers = checkpoint?.startingCustomers ?? a.customers;
      const startingFacilities = checkpoint?.facilities ?? a.facilities;
      const startingRate = checkpoint?.dollarsPerkWh ?? scenario.dollarsPerkWh;
      state.date = getDateFromMinute(0, scenario.startingYear);
      state.startingYear = scenario.startingYear;
      // A company on day one has no track record, no debt and nothing but cash, so it borrows at
      // whatever prime was in the year the scenario opens -- 4.75% in 2019, 21.5% in 1980. It is
      // repriced when it borrows and against its results at each month rollover.
      state.creditPremium = getCreditPremium(
        getCreditInputs([], startingCash, startingCash, []),
      );
      state.interestRate =
        getPrimeRate(state.date, state.seed) * state.creditPremium;
      state.feePerKgCO2e = scenario.feePerKgCO2e;
      // The rate the scenario advertises on the new game screen, and the rate Public scenarios are
      // scored against, so the game has to actually start there rather than at the slice default
      state.dollarsPerkWh = startingRate;
      state.customerRate = startingRate;
      // A tutorial checkpoint's rate is part of its lesson, so it stays where it was authored.
      state.rateFollowsInflation = !checkpoint && canFollowInflation(state);
      state.customerMarketSize = startingCustomers * CUSTOMER_MARKET_MULTIPLIER;
      initializeGameObjectiveProgress(state);
      state.startingDemandScale = scenario.startingDemandScale ?? 1;
      state.demandShapeExponent = scenario.demandShapeExponent;
      state.loadAdditions = cloneDeep(scenario.loadAdditions || []);
      state.location = a.location;
      state.commissionedHydroSiteIds = [];
      const hydroAssignments = resolveStartingHydroSites(
        state.location,
        startingFacilities,
        getHydroInventoryKey(state),
      );
      if (scenario.mod) {
        const missing = startingFacilities.flatMap((search, index) =>
          startingFacilityQuote(state, search)
            ? []
            : [
                `Starting asset ${index + 1} (${search.label || search.name || search.fuel || "facility"}) is unavailable in ${scenario.startingYear}.`,
              ],
        );
        if (missing.length) throw new Error(missing.join("\n"));
      }
      if (scenario.startingYear <= 1882 && hydroAssignments.some(Boolean))
        throw new Error(
          "Starting Hydro technology is unavailable before 1883.",
        );
      state.transmission = intertiesEnabledForScenario(scenario, a.location)
        ? emptyTransmissionState()
        : undefined;
      state.timeline = generateNewTimeline(
        state,
        startingCash,
        startingCustomers,
      );

      startingFacilities.forEach(
        (search: ScenarioFacilityType, startingIndex: number) => {
          // Age is scenario metadata rather than a catalog property, so exclude it from the exact
          // technology match and pass it to the completed operating asset separately.
          const {
            initialAgeYears = 0,
            initialReservoirFraction,
            label,
          } = search;
          const facilitySearch = startingFacilitySearch(search);
          const generator = GENERATORS(
            // These are inherited assets, already committed before month-one timed discounts.
            // Static package factors still apply through the retained custom scenario.
            scenarioRules(scenario, state)?.namespace.kind === "mod"
              ? { ...state, storyEffectsDisabled: true }
              : state,
            facilitySearch.peakW || 1000000,
            [],
            [],
          ).find((g: FacilityShoppingType) =>
            matchesStartingFacility(g, facilitySearch),
          );
          if (hydroAssignments[startingIndex] && !generator)
            throw new Error(
              `Starting Hydro plant ${startingIndex + 1} is unavailable in ${scenario.startingYear} or has inconsistent technology settings.`,
            );
          if (generator) {
            const existingIds = new Set(state.facilities.map(({ id }) => id));
            state = buildFacilityHelper(
              state,
              generator,
              false,
              true,
              initialAgeYears,
              initialReservoirFraction,
              hydroAssignments[startingIndex],
            );
            if (label || search.assetId) {
              const built = state.facilities.find(
                ({ id }) => !existingIds.has(id),
              );
              if (built) {
                if (label) built.name = label;
                if (search.assetId) built.startingAssetId = search.assetId;
              }
            }
          } else {
            const storage = STORAGE(
              state,
              facilitySearch.peakWh || 1000000,
            ).find((g: FacilityShoppingType) =>
              matchesStartingFacility(g, facilitySearch),
            );
            if (storage) {
              const existingIds = new Set(state.facilities.map(({ id }) => id));
              state = buildFacilityHelper(
                state,
                storage,
                false,
                true,
                initialAgeYears,
                initialReservoirFraction,
              );
              if (label || search.assetId) {
                const built = state.facilities.find(
                  ({ id }) => !existingIds.has(id),
                );
                if (built) {
                  if (label) built.name = label;
                  if (search.assetId) built.startingAssetId = search.assetId;
                }
              }
            } else {
              // A spec that matches nothing used to vanish without a trace, which is a rough way to
              // find out that the technology you picked wasn't invented yet in the year you started
              console.warn(
                `No facility matches ${JSON.stringify(search)} in ${scenario.startingYear}, skipping it`,
              );
            }
          }
        },
      );

      if (!scenario.tutorialSteps || scenario.intertiesEnabled) {
        // buildFacilityHelper prepends generators because player-built capacity should dispatch
        // by default. For authored starting fleets, however, the scenario order is deliberate:
        // reverse just the resulting generator block back into that order while storage remains
        // at the bottom. Building in the original sequence keeps IDs tied to authored entries.
        const generators = state.facilities.filter(
          (facility) => facility.peakWh === undefined,
        );
        const storage = state.facilities.filter(
          (facility) => facility.peakWh !== undefined,
        );
        state.facilities = [...generators.reverse(), ...storage];
      }

      // Variable generation must be counted before dispatchable plants cover the
      // remaining demand. Apply to every starting fleet, including tutorials and custom games,
      // while preserving the relative order within both groups and leaving storage at the end.
      const variable = (facility: FacilityOperatingType) =>
        facility.fuel !== undefined &&
        WEATHER_DEPENDENT_FUELS.includes(facility.fuel);
      state.facilities = [
        ...state.facilities.filter(variable),
        ...state.facilities.filter((facility) => !variable(facility)),
      ];

      if (state.transmission) {
        state.transmission.lines = (scenario.startingInterties || []).map(
          (corridorId, index) => {
            const quote = intertieBuildQuote(
              corridorId,
              state.startingYear,
              1,
              accessContextForGame(state),
            );
            if (!quote)
              throw new Error(`Invalid starting intertie: ${corridorId}`);
            return {
              id: index + 1,
              corridorId,
              name: quote.name,
              capacityW: quote.capacityW,
              buildCost: quote.buildCost,
              annualOperatingCost: quote.annualOperatingCost,
              yearsToBuildLeft: 0,
              minuteCreated: 0,
              financed: false,
              loanAmountLeft: 0,
              loanMonthlyPayment: 0,
              interestRate: 0,
              currentFlowW: 0,
            };
          },
        );
      }

      if (isUtilityExpansionGame(state)) {
        state.utilityExpansion = {
          networkAssets: [],
          loans: [],
          acquisitions: [],
        };
        state.timeline = reforecastDemand(state);
      }
      desktopSimulationHooks()?.initialize(state);
      const rules = scenarioRules(scenario, state);
      if (rules && !isOfficialCatalogRules(rules)) {
        updateWorldEvents(state);
        const opening = state.timeline[0];
        const transaction = openingRuleTransactions(state);
        opening.cash += transaction;
        opening.netWorth += transaction;
      }
      // The first blank timeline is created before the authored fleet is resolved. Hydrology is
      // intentionally skipped for a fleet with no Hydro, so refresh it now that a starting dam
      // may exist; otherwise its first forecast has zero inflow for every month.
      if (
        rules ||
        state.facilities.some((facility) => facility.fuel === "Hydro")
      ) {
        state.timeline = reforecastWeatherAndPrices(state);
      }
      // Pre-roll a few frames once we have weather and demand info so generators and batteries start in a more accurate state
      for (let i = 0; i < 4; i++) {
        updateSupplyFacilitiesFinances(
          state,
          state.timeline[0],
          state.timeline[0],
          true,
          true,
        );
      }
      state.timeline = reforecastSupply(state);
      resolveAutomaticScenarioChoices(state);
      if (pendingScenarioChoice(state)) setForegroundSpeed(state, "PAUSED");
      // Establish the comparison before time moves. A fleet that was already dearer on day one
      // has not crossed anything; the first monthly ordering change is the event.
      state.fuelCostSnapshot = currentFuelCosts(state);
    },
    buildFacility: (state, action: PayloadAction<BuildFacilityAction>) => {
      applyBuildFacility(state, action.payload);
    },
    buildTransmissionLine: (
      state,
      action: PayloadAction<BuildTransmissionLineAction>,
    ) => {
      applyBuildTransmissionLine(state, action.payload);
    },
    cancelTransmissionLine: (state, action: PayloadAction<number>) => {
      applyCancelTransmissionLine(state, action.payload);
    },
    togglePauseTransmissionLine: (state, action: PayloadAction<number>) => {
      applyTogglePauseTransmissionLine(state, action.payload);
    },
    reprioritizeTransmissionLine: (
      state,
      action: PayloadAction<ReprioritizeAction>,
    ) => {
      applyReprioritizeTransmissionLine(state, action.payload);
    },
    upgradeTransmissionLine: (
      state,
      action: PayloadAction<UpgradeTransmissionLineAction>,
    ) => {
      applyUpgradeTransmissionLine(state, action.payload);
    },
    setTradingPolicy: (state, action: PayloadAction<TradingPolicyType>) => {
      applyTradingPolicy(state, action.payload);
    },
    sellFacility: (state, action: PayloadAction<number>) => {
      applySellFacility(state, action.payload);
    },
    togglePauseFacility: (state, action: PayloadAction<number>) => {
      applyTogglePauseFacility(state, action.payload);
    },
    reprioritizeFacility: (
      state,
      action: PayloadAction<ReprioritizeAction>,
    ) => {
      applyReprioritizeFacility(state, action.payload);
    },
    retrofitFacility: (
      state,
      action: PayloadAction<RetrofitFacilityAction>,
    ) => {
      applyRetrofitFacility(state, action.payload);
    },
    cancelRetrofit: (state, action: PayloadAction<number>) => {
      applyCancelRetrofit(state, action.payload);
    },
    setSpeed: (state, action: PayloadAction<SpeedType>) => {
      if (
        state.tutorialIntertieStress?.active &&
        getTutorialStep(state)?.phase !== "INTERTIE_STRESS_SUPPLY" &&
        action.payload !== "PAUSED"
      )
        return;
      if (pendingScenarioChoice(state) && action.payload !== "PAUSED") return;
      delete state.policyPause;
      // Global keyboard shortcuts still fire over full-screen cards. Keep their quotes and
      // instructions frozen until the player actually closes the card. A backgrounded page
      // freezes the same way: pageVisible is the caller that resumes it.
      if (
        (dialogBlocksSpeed ||
          (speedBeforeBlockingCard !== undefined && !blockingCardAllowsSpeed) ||
          speedBeforeManualHelp !== undefined ||
          speedBeforeCloudSavePrompt !== undefined ||
          speedBeforeHidden !== undefined) &&
        action.payload !== "PAUSED"
      ) {
        return;
      }
      state.speed = action.payload;
      ensureTicking(state);
    },
    markEventsRead: (state) => {
      state.eventLogReadThroughId = state.eventLog[0]?.id || 0;
    },
  },
  // start, loaded and quit are declared in GameActions so that Card and UI can react to them
  // without importing this module -- see the note there
  extraReducers: (builder) => {
    builder.addCase(multiplayerSnapshot, (state, action) => {
      const incoming = action.payload;
      const sameGrid =
        !!state.multiplayer &&
        state.multiplayer.seat === incoming.multiplayer?.seat &&
        state.seed === incoming.seed &&
        state.location.id === incoming.location.id &&
        state.scenarioId === incoming.scenarioId &&
        state.startingYear === incoming.startingYear;
      return {
        ...incoming,
        // Completed months and the authored location are immutable. Keeping their identity lets
        // normal forecasts finish while authoritative tick snapshots continue to arrive.
        location: sameGrid ? state.location : incoming.location,
        monthlyHistory:
          sameGrid &&
          state.date.monthsElapsed === incoming.date.monthsElapsed &&
          state.monthlyHistory.length === incoming.monthlyHistory.length
            ? state.monthlyHistory
            : incoming.monthlyHistory,
        // Reading state belongs to this renderer and survives network updates.
        eventLogReadThroughId: sameGrid ? state.eventLogReadThroughId : 0,
        lowCashWarningMonth: sameGrid ? state.lowCashWarningMonth : undefined,
        speed: action.payload.multiplayer?.clock?.activeSpeed ?? "PAUSED",
        policyPause: sameGrid ? state.policyPause : undefined,
        inGame: true,
      };
    });
    builder.addCase(beginIntertieStress, (state) => {
      if (
        state.scenarioId !== 112 ||
        state.customScenario ||
        getTutorialStep(state)?.phase !== "INTERTIE_STRESS_PREPARE" ||
        state.tutorialIntertieStress
      )
        return;
      state.speed = "PAUSED";
      state.tutorialIntertieStress = {
        active: true,
        startsMinute: state.date.minute,
        suppliedTicks: 0,
        completed: false,
      };
      state.timeline = reforecastSupply(state, true);
    });
    builder.addCase(launchRun, (_state, action) => {
      const { identity, challenge } = action.payload;
      if (!projectAuthoredRunReference(identity)) return;
      speedBeforeBlockingCard = undefined;
      speedBeforeManualHelp = undefined;
      speedBeforeCloudSavePrompt = undefined;
      speedBeforeHidden = undefined;
      speedBeforeDialog = "PAUSED";
      dialogBlocksSpeed = false;
      return {
        ...cloneDeep(initialGame),
        scenarioId: identity.scenarioId,
        difficulty: identity.difficulty,
        seed: identity.seed,
        location: cloneDeep(identity.inputs.location),
        runIdentity: cloneDeep(identity),
        challenge: cloneDeep(challenge),
      };
    });
    builder.addCase(start, (state, action) => {
      delete state.desktopAchievements;
      state.runIdentity = undefined;
      state.challenge = undefined;
      state.scenarioId = action.payload;
      // An empty timeline is how the loading screen tells a new game from a resumed one, so make
      // that true by construction rather than by whichever paths happen to lead here
      state.timeline = [];
    });
    builder.addCase("game/completeTutorial", (state) => {
      desktopSimulationHooks()?.tutorial(state);
    });
    builder.addCase(resume, (_state, action) => {
      const restored = cloneDeep(action.payload);
      // cloneDeep drops the non-enumerable commitment forecast parseSave reattached
      action.payload.timeline.forEach((tick, i) =>
        copyCommitmentMetadata(tick, restored.timeline[i]),
      );
      // The tick loop's remaining module-level locals have to line up with restored state.
      previousFuelPrices = undefined;
      speedBeforeDialog = "PAUSED";
      dialogBlocksSpeed = false;
      speedBeforeBlockingCard = undefined;
      speedBeforeManualHelp = undefined;
      speedBeforeCloudSavePrompt = undefined;
      speedBeforeHidden = undefined;
      // Never resume mid-tick; loaded() flips inGame once the CSVs are back
      restored.speed = "PAUSED";
      restored.inGame = false;
      if (!restored.desktopAchievements)
        desktopSimulationHooks()?.initialize(restored);
      // tickLoopRunning is deliberately left alone: any loop still alive clears the flag and stops
      // on its next tick, since tick() bails while !inGame or PAUSED
      return restored;
    });
    builder.addCase(loaded, (state) => {
      // Saves carry the commitment forecast, so this only runs for one that somehow lacks it.
      // Rebuild just that metadata after the data tables have loaded, and keep every recorded
      // value: a full reforecast re-dispatches the tick that already happened, rewriting its
      // supply, fuel and emissions and everything the next tick carries forward from them.
      const currentTick = getTimeFromTimeline(
        state.date.minute,
        state.timeline,
      );
      const needsCommitmentForecast = state.facilities.some((facility) => {
        return (
          (facility.minimumStableOutput || 0) > 0 &&
          !hasPreparedGeneratorCommitment(currentTick, facility.id)
        );
      });
      if (needsCommitmentForecast) {
        const forecast = reforecastSupply(state, true);
        state.timeline = original(state.timeline)!.map((tick, i) => {
          const recorded = { ...tick };
          copyCommitmentMetadata(forecast[i], recorded);
          return recorded;
        });
      }
      // Start ticking in game
      setTimeout(() => {
        return getStore().dispatch(gameSlice.actions.tick());
      }, TICK_MS.PAUSED);
      state.inGame = true;
    });
    builder.addCase(quit, () => {
      dialogBlocksSpeed = false;
      speedBeforeBlockingCard = undefined;
      speedBeforeManualHelp = undefined;
      speedBeforeCloudSavePrompt = undefined;
      speedBeforeHidden = undefined;
      return cloneDeep(initialGame);
    });
    // Opening a reading or construction card pauses the game, and closing it puts the speed back.
    // The sim should not punish the player for reading, or mutate a quote during a decision.
    builder.addCase(navigate, (state, action) => {
      const payload = action.payload;
      const name = typeof payload === "string" ? payload : payload?.name;
      if (!name || !BLOCKING_CARDS.has(name)) {
        // Navigating anywhere else (rather than backing out) still counts as leaving it
        restoreSpeedAfterBlockingCard(state);
      } else enterBlockingCard(state, name);
    });
    builder.addCase(navigateBack, (state, action) => {
      if (!action.payload || !BLOCKING_CARDS.has(action.payload))
        restoreSpeedAfterBlockingCard(state);
      else enterBlockingCard(state, action.payload);
    });
    builder.addCase(manualHelpOpen, (state) => {
      if (state.inGame && speedBeforeManualHelp === undefined) {
        speedBeforeManualHelp = foregroundSpeed(state);
        setForegroundSpeed(state, "PAUSED");
      }
    });
    builder.addCase(manualHelpClose, (state) => {
      if (speedBeforeManualHelp !== undefined) {
        setForegroundSpeed(state, speedBeforeManualHelp);
        speedBeforeManualHelp = undefined;
        ensureTicking(state);
      }
    });
    builder.addCase(cloudSavePromptVisible, (state, action) => {
      if (action.payload) {
        if (state.inGame && speedBeforeCloudSavePrompt === undefined) {
          const remembered = foregroundSpeed(state);
          setForegroundSpeed(state, "PAUSED");
          speedBeforeCloudSavePrompt = remembered;
        }
      } else if (speedBeforeCloudSavePrompt !== undefined) {
        const remembered = speedBeforeCloudSavePrompt;
        speedBeforeCloudSavePrompt = undefined;
        setForegroundSpeed(state, remembered);
        ensureTicking(state);
      }
    });
    builder.addCase(systemSuspend, (state) => {
      state.speed = "PAUSED";
      speedBeforeDialog = "PAUSED";
      if (speedBeforeHidden !== undefined) speedBeforeHidden = "PAUSED";
      if (speedBeforeBlockingCard !== undefined)
        speedBeforeBlockingCard = "PAUSED";
      if (speedBeforeManualHelp !== undefined) speedBeforeManualHelp = "PAUSED";
      if (speedBeforeCloudSavePrompt !== undefined)
        speedBeforeCloudSavePrompt = "PAUSED";
      if (state.policyPause) state.policyPause.speed = "PAUSED";
      if (state.scenarioChoicePause !== undefined)
        state.scenarioChoicePause = "PAUSED";
    });
    builder.addCase(pageHidden, (state) => {
      if (state.inGame && speedBeforeHidden === undefined) {
        speedBeforeHidden = state.speed;
        state.speed = "PAUSED";
      }
    });
    builder.addCase(pageVisible, (state) => {
      if (speedBeforeHidden === undefined) return;
      state.speed = speedBeforeHidden;
      speedBeforeHidden = undefined;
      ensureTicking(state);
    });
    builder.addCase(dialogOpen, (state, action) => {
      delete state.policyPause;
      dialogBlocksSpeed = !!action.payload.notCancellable;
      speedBeforeDialog = foregroundSpeed(state);
      setForegroundSpeed(state, "PAUSED");
    });
    builder.addCase(dialogClose, (state) => {
      dialogBlocksSpeed = false;
      setForegroundSpeed(state, speedBeforeDialog);
      ensureTicking(state);
    });
    builder.addCase(acquireUtility, (state, action) => {
      applyAcquireUtility(state, action.payload);
    });
    builder.addCase(chooseScenarioResponse, (state, action) => {
      const blocking = !!pendingScenarioChoice(state);
      if (applyScenarioResponse(state, action.payload)) {
        if (blocking) {
          delete state.scenarioChoicePause;
          setForegroundSpeed(state, "PAUSED");
        }
      }
    });
    builder.addCase(schedulePolicy, (state, action) => {
      applyPolicyEdit(state, action.payload, false);
    });
    builder.addCase(cancelPolicy, (state, action) => {
      applyPolicyEdit(state, action.payload, true);
    });
    builder.addCase(openPolicyDecision, (state, action) => {
      if (!state.policyPause) {
        state.policyPause = {
          token: action.payload,
          speed: foregroundSpeed(state),
        };
        setForegroundSpeed(state, "PAUSED");
      }
    });
    builder.addCase(closePolicyDecision, (state, action) => {
      if (state.policyPause?.token === action.payload) {
        if (foregroundSpeed(state) === "PAUSED")
          setForegroundSpeed(state, state.policyPause.speed);
        delete state.policyPause;
        ensureTicking(state);
      }
    });
    // The score screen stops the clock the same way any other dialog does - "Keep playing"
    // resumes at whatever speed the run was going when it ended
    builder.addCase(victoryOpen, (state) => {
      delete state.policyPause;
      speedBeforeDialog = foregroundSpeed(state);
      setForegroundSpeed(state, "PAUSED");
    });
    builder.addCase(victoryClose, (state) => {
      setForegroundSpeed(state, speedBeforeDialog);
      ensureTicking(state);
    });
  },
});

export const {
  tick,
  delta,
  initGame,
  buildFacility,
  buildTransmissionLine,
  upgradeTransmissionLine,
  cancelTransmissionLine,
  togglePauseTransmissionLine,
  reprioritizeTransmissionLine,
  sellFacility,
  togglePauseFacility,
  reprioritizeFacility,
  retrofitFacility,
  cancelRetrofit,
  setTradingPolicy,
  setSpeed,
  markEventsRead,
} = gameSlice.actions;

// Re-exported so that everything still imports the game's actions from one place
export { start, loaded, quit, resume };

export default gameSlice.reducer;

// ====== HELPERS ======

/** Calendar-owned notices; cap changes themselves remain a pure dated entitlement lookup. */
export function recordExpansionMilestones(state: GameType): void {
  if (!isUtilityExpansionGame(state) || state.date.monthNumber !== 1) return;
  if (state.date.year === 2013 && ownedUtility(state, "valley-electric"))
    logGameEvent(
      state,
      "WORLD_EVENT",
      "Valley's nuclear purchase will drop from 160 to 80 MW in January 2017. Prepare to replace 76 MW of deliverable supply.",
      {
        title: "Valley supply reduction ahead",
        importance: "NOTABLE",
        reportedKey: "scenario-116-valley-supply-reminder-2013",
        actionTarget: { card: "FACILITIES", view: "FLEET" },
      },
    );
  if (state.date.year === 2017 && ownedUtility(state, "valley-electric"))
    logGameEvent(
      state,
      "WORLD_EVENT",
      "Valley's nuclear purchase is down to 80 MW, or 76 MW deliverable.",
      {
        title: "Valley nuclear purchase reduced",
        importance: "CRITICAL",
        reportedKey: "scenario-116-valley-supply-reduction-2017",
        actionTarget: { card: "FACILITIES", view: "FLEET" },
      },
    );
  if (state.date.year === 2016)
    logGameEvent(
      state,
      "WORLD_EVENT",
      "Champlain’s nuclear purchase ends in January 2020. Québec and Ridge purchase limits also halve. Review the supply plan and allow time for replacement projects.",
      {
        title: "Legacy power contracts change in 2020",
        importance: "NOTABLE",
        reportedKey: "scenario-116-contract-reminder-2016",
        actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
      },
    );
  if (state.date.year === 2020)
    logGameEvent(
      state,
      "WORLD_EVENT",
      "Champlain’s nuclear purchase has ended. Québec purchase limits are down to 60 MW; Ridge’s firm purchase is down to 20 MW if acquired.",
      {
        title: "Legacy power purchases reduced",
        importance: "CRITICAL",
        reportedKey: "scenario-116-contract-change-2020",
        actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
      },
    );
}

export function applyAcquireUtility(
  state: GameType,
  payload: unknown,
): boolean {
  const quote =
    payload && typeof payload === "object"
      ? acquisitionQuote(state, (payload as { targetId: string }).targetId)
      : undefined;
  if (!quote || !transferUtility(state, payload)) return false;
  const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
  now.entitlementImportCapacityW = entitlementSources(state, now).reduce(
    (sum, source) => sum + source.capacityW,
    0,
  );
  rebaseGameRetentionBaseline(state, expansionRetentionBaseline(state));
  refreshInterestRate(state, now.cash, now.netWorth);
  // The settled current tick retains its meters, stored energy and program queues. Ownership
  // and cash transfer now; the enlarged demand and shared fleet settle on the next elapsed tick.
  state.timeline = reforecastDemand(state, 1, [], [], [], undefined, true);
  state.timeline = reforecastSupply(state, true, TICK_MINUTES, undefined, true);
  logGameEvent(
    state,
    "BUILD",
    `Acquired ${quote.name}: ${Math.round(quote.customers).toLocaleString()} customers`,
    {
      importance: "NOTABLE",
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    },
  );
  recordMeaningfulDecision(state, {
    lever: `acquisition:${quote.targetId}`,
    label: `Acquire ${quote.name}`,
    kind: "asset",
    before: "Independent utility",
    after: "Owned utility",
  });
  return true;
}
export interface UtilityAcquisitionPreview {
  beforeMarginW: number;
  afterMarginW: number;
  beforeMonthlyCash: number;
  afterMonthlyCash: number;
}
/** Review uses the same company demand and dispatch owners on private snapshots. */
export function previewUtilityAcquisition(
  game: GameType,
  targetId: string,
  financed: boolean,
): UtilityAcquisitionPreview | undefined {
  const quote = acquisitionQuote(game, targetId);
  if (!quote || !game.utilityExpansion) return undefined;
  const snapshot = cloneDeep(isDraft(game) ? current(game) : game);
  const tick = getTimeFromTimeline(snapshot.date.minute, snapshot.timeline);
  if (!tick) return undefined;
  const before = generateForecastTimeline(snapshot, tick.cash, tick.customers);
  const due = financed ? quote.financedCashDue : quote.cashDue;
  const cashBefore = tick.cash;
  tick.cash = Math.max(cashBefore, due);
  if (
    !transferUtility(snapshot, {
      targetId: quote.targetId,
      financed,
      quoteKey: quote.quoteKey,
    })
  )
    return undefined;
  rebaseGameRetentionBaseline(snapshot, expansionRetentionBaseline(snapshot));
  tick.cash = cashBefore - due;
  const after = generateForecastTimeline(snapshot, tick.cash, tick.customers);
  const margin = (ticks: TickPresentFutureType[]) =>
    Math.min(
      ...ticks.map((tick) => tick.reserveW ?? tick.supplyW - tick.demandW),
    );
  return {
    beforeMarginW: margin(before),
    afterMarginW: margin(after),
    beforeMonthlyCash: before.at(-1)?.cash ?? cashBefore,
    afterMonthlyCash: after.at(-1)?.cash ?? tick.cash,
  };
}

function refreshInterestRate(
  state: GameType,
  cash: number,
  netWorth = getNetWorth(
    state.facilities,
    cash,
    state.date.minute,
    state.transmission?.lines,
    state,
  ),
) {
  state.creditPremium = getCreditPremium(
    getCreditInputs(state.monthlyHistory, cash, netWorth, state.facilities, [
      ...(state.transmission?.lines ?? []),
      ...(state.utilityExpansion?.loans ?? []),
    ]),
  );
  state.interestRate =
    getPrimeRate(state.date, state.seed) * state.creditPremium;
}

function applyBuildFacility(
  state: GameType,
  payload: BuildFacilityAction,
): boolean {
  if (
    !validBuildFacility(payload) ||
    Object.prototype.hasOwnProperty.call(payload, "operatingAreaId")
  )
    return false;
  const requested = payload.facility;
  // Validate future shopping quotes as carefully as current catalog entries.
  if (
    requested.name === "Iron-Air Battery" &&
    (state.date.year < IRON_AIR_AVAILABLE_YEAR || !isStorage(requested))
  )
    return false;
  const hydro = isConventionalHydro(requested);
  const hydroSite = hydro
    ? getHydroAvailability(state, requested.peakW)
    : undefined;
  if (hydro && (state.date.year <= 1882 || hydroSite?.status !== "available"))
    return false;
  const built = hydro
    ? { ...requested, hydroSiteId: hydroSite!.selected!.id }
    : requested;
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  const { amountDue } = purchaseTerms(
    built.buildCost,
    !!payload.financed,
    state.interestRate,
  );
  // The dialog's quote can be stale by the time an action lands (or an import can be
  // malformed). Never let a purchase drive cash below zero merely because the UI once enabled it.
  if (!now || now.cash < amountDue) {
    return false;
  }
  const viableLocationsRemaining = getViableLocationsRemaining(
    state.location,
    state.facilities,
    built.name,
  );
  // Recheck current state instead of trusting the shopping-card snapshot in the action. It keeps
  // a stale dialog action from claiming one more site after the last one was used.
  if (
    !hydro &&
    viableLocationsRemaining !== undefined &&
    viableLocationsRemaining <= 0
  ) {
    return false;
  }
  const existingIds = new Set(state.facilities.map(({ id }) => id));
  logGameEvent(state, "BUILD", buildStartedMessage(built), {
    importance: "NOTABLE",
    actionTarget: { card: "FACILITIES", view: "FLEET" },
  });
  state = buildFacilityHelper(state, built, payload.financed);
  const added = state.facilities.find(({ id }) => !existingIds.has(id));
  if (!added) return false;
  // Book this loan at the quoted rate, then price the next one against the new debt and cash.
  if (payload.financed) refreshInterestRate(state, now.cash);
  if (isMaterialCapacityDecision(state, added.peakW)) {
    recordMeaningfulDecision(state, {
      lever: `asset-build:${added.id}`,
      label: `Build ${added.name} (${formatWatts(added.peakW)})`,
      kind: "asset",
      before: "absent",
      after: `${added.name}:${added.peakWh ?? added.peakW}:${payload.financed ? "financed" : "cash"}`,
    });
  }
  // Assigned rather than spread into a new object: this is an immer draft, so a fresh object
  // assigned to the parameter is discarded and the forecast would never reach state
  state.timeline = reforecastSupply(state);
  return true;
}

function applySellFacility(state: GameType, id: number): boolean {
  const sold = state.facilities.find((g: FacilityOperatingType) => g.id === id);
  if (!sold) return false;
  logGameEvent(
    state,
    sold.yearsToBuildLeft > 0 ? "BUILD" : "SELL",
    sold.yearsToBuildLeft > 0
      ? `Canceled construction of ${sold.name}`
      : `Sold ${sold.name}, ${sold.peakWh ? formatWattHours(sold.peakWh) : formatWatts(sold.peakW)} for ${formatMoneyConcise(facilityCashBack(sold, state.date.minute))}`,
  );
  const ownedState = `${sold.name}:${sold.peakWh ?? sold.peakW}:${sold.loanAmountTotal > 0 ? "financed" : "cash"}`;
  endWeatherHazardsForFacility(state, id);
  // in one loop, refund cash from selling + remove from list
  state.facilities = state.facilities.filter((g: FacilityOperatingType) => {
    if (g.id === id) {
      const now = getTimeFromTimeline(state.date.minute, state.timeline);
      if (now) {
        now.cash += facilityCashBack(g, state.date.minute);
      }
      return false;
    }
    return true;
  });
  if (sold.yearsToBuildLeft > 0) {
    // Cancelling construction undoes the investment rather than earning another decision.
    state.meaningfulDecisions = state.meaningfulDecisions.filter(
      (decision) => decision.lever !== `asset-build:${id}`,
    );
  } else if (isMaterialCapacityDecision(state, sold.peakW)) {
    recordMeaningfulDecision(state, {
      lever: `asset-sale:${id}`,
      label: `Sell ${sold.name} (${formatWatts(sold.peakW)})`,
      kind: "sale",
      before: ownedState,
      after: "absent",
    });
  }
  state.timeline = reforecastSupply(state);
  return true;
}

function applyTogglePauseFacility(state: GameType, id: number): boolean {
  const facility = state.facilities.find((item) => item.id === id);
  if (!facility) return false;
  const before = facility.paused ? "paused" : "operating";
  facility.paused = !facility.paused;
  recordMeaningfulDecision(state, {
    lever: `operation:${id}`,
    label: `${facility.paused ? "Pause" : "Run"} ${facility.name}`,
    kind: "operation",
    before,
    after: facility.paused ? "paused" : "operating",
  });
  state.timeline = reforecastSupply(state);
  return true;
}

function applyReprioritizeFacility(
  state: GameType,
  payload: ReprioritizeAction,
): boolean {
  const destination = payload.spotInList + payload.delta;
  if (
    !Number.isInteger(payload.spotInList) ||
    !Number.isInteger(payload.delta) ||
    payload.delta === 0 ||
    payload.spotInList < 0 ||
    payload.spotInList >= state.facilities.length ||
    destination < 0 ||
    destination >= state.facilities.length
  )
    return false;
  const movedId = state.facilities[payload.spotInList].id;
  arrayMove(
    state.facilities,
    payload.spotInList,
    payload.spotInList + payload.delta,
  );
  recordMeaningfulDecision(state, {
    lever: `dispatch:${movedId}`,
    label: `Set ${state.facilities[destination].name} dispatch priority`,
    kind: "dispatch",
    before: String(payload.spotInList),
    after: String(destination),
  });
  state.timeline = reforecastSupply(state);
  return true;
}

const TRADING_POLICIES: readonly TradingPolicyType[] = [
  "BALANCED",
  "RELIABILITY_FIRST",
  "SURPLUS_ONLY",
  "CLOSED",
];

function applyReprioritizeTransmissionLine(
  state: GameType,
  payload: ReprioritizeAction,
): boolean {
  const lines = state.transmission?.lines;
  const destination = payload?.spotInList + payload?.delta;
  if (
    !lines ||
    !Number.isSafeInteger(payload?.spotInList) ||
    !Number.isSafeInteger(payload?.delta) ||
    payload.delta === 0 ||
    payload.spotInList < 0 ||
    payload.spotInList >= lines.length ||
    destination < 0 ||
    destination >= lines.length
  )
    return false;
  const moved = lines[payload.spotInList];
  if (ownedUtilityConnection(state, moved.corridorId)) return false;
  arrayMove(lines, payload.spotInList, destination);
  recordMeaningfulDecision(state, {
    lever: `trading-order:${moved.id}`,
    label: `Set ${moved.name} trading priority`,
    kind: "trading",
    before: String(payload.spotInList),
    after: String(destination),
  });
  state.timeline = reforecastSupply(state);
  return true;
}

function applyTradingPolicy(state: GameType, policy: unknown): boolean {
  if (!TRADING_POLICIES.includes(policy as TradingPolicyType)) return false;
  if (!state.transmission) return false;
  // A trading rule is only an actionable grid choice once there is a corridor to govern.
  if (state.transmission.lines.length === 0) return false;
  if (state.transmission.tradingPolicy === policy) return false;
  const before = state.transmission.tradingPolicy;
  state.transmission.tradingPolicy = policy as TradingPolicyType;
  recordMeaningfulDecision(state, {
    lever: "trading",
    label: "Set the regional trading rule",
    kind: "trading",
    before,
    after: policy as TradingPolicyType,
  });
  state.timeline = reforecastSupply(state, true);
  return true;
}

function applyBuildTransmissionLine(
  state: GameType,
  payload: Partial<BuildTransmissionLineAction>,
): boolean {
  if (typeof payload.corridorId !== "string") return false;
  const availableCorridor = corridorsForGame(state).find(
    ({ id }) => id === payload.corridorId,
  );
  const corridor =
    availableCorridor &&
    intertieBuildQuote(
      availableCorridor.id,
      state.date.year,
      payload.tier ?? 1,
      accessContextForGame(state),
    );
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (!state.transmission) return false;
  if (
    !corridor ||
    !now ||
    state.transmission.lines.some(
      ({ corridorId }) => corridorId === corridor.id,
    )
  ) {
    return false;
  }
  const financed = !!payload.financed;
  const { amountDue, loanAmount, monthlyPayment } = purchaseTerms(
    corridor.buildCost,
    financed,
    state.interestRate,
  );
  if (now.cash < amountDue) return false;
  now.cash -= amountDue;
  const line: TransmissionLineOperatingType = {
    id:
      state.transmission.lines.reduce(
        (largest, item) => Math.max(largest, item.id),
        0,
      ) + 1,
    corridorId: corridor.id,
    name: corridor.name,
    capacityW: corridor.capacityW,
    buildCost: corridor.buildCost,
    annualOperatingCost: corridor.annualOperatingCost,
    yearsToBuildLeft: corridor.yearsToBuild,
    minuteCreated: state.date.minute,
    financed,
    loanAmountLeft: loanAmount,
    loanMonthlyPayment: monthlyPayment,
    interestRate: financed ? state.interestRate : 0,
    // Nothing flows until the line is energised, which is years away
    currentFlowW: 0,
    constructionKgco2eTotal: corridor.constructionKgco2eTotal,
  };
  state.transmission.lines.push(line);
  if (financed) refreshInterestRate(state, now.cash);
  recordMeaningfulDecision(state, {
    lever: `intertie:${line.id}`,
    label: `Build ${line.name}`,
    kind: "asset",
    before: "absent",
    after: `${line.corridorId}:${financed ? "financed" : "cash"}`,
  });
  logGameEvent(
    state,
    "BUILD",
    `Started ${corridor.name}: ${formatWatts(corridor.capacityW)} to ${adjacentMarketForCorridor(corridor.id)?.name}`,
    {
      importance: "NOTABLE",
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    },
  );
  state.timeline = reforecastSupply(state, true);
  return true;
}

function applyCancelTransmissionLine(state: GameType, id: number): boolean {
  const line = state.transmission?.lines.find((item) => item.id === id);
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (
    !line ||
    ownedUtilityConnection(state, line.corridorId) ||
    line.yearsToBuildLeft <= 0 ||
    !now ||
    !state.transmission
  )
    return false;
  now.cash += line.buildCost - line.loanAmountLeft;
  state.transmission.lines = state.transmission.lines.filter(
    (item) => item.id !== id,
  );
  state.meaningfulDecisions = state.meaningfulDecisions.filter(
    (item) => item.lever !== `intertie:${id}`,
  );
  logGameEvent(state, "BUILD", `Canceled construction of ${line.name}`);
  state.timeline = reforecastSupply(state, true);
  return true;
}

function applyTogglePauseTransmissionLine(
  state: GameType,
  id: number,
): boolean {
  const line = state.transmission?.lines.find((item) => item.id === id);
  if (
    !line ||
    ownedUtilityConnection(state, line.corridorId) ||
    line.yearsToBuildLeft > 0
  )
    return false;
  const before = line.paused ? "paused" : "operating";
  line.paused = !line.paused;
  recordMeaningfulDecision(state, {
    lever: `intertie-operation:${id}`,
    label: `${line.paused ? "Pause" : "Run"} ${line.name}`,
    kind: "operation",
    before,
    after: line.paused ? "paused" : "operating",
  });
  state.timeline = reforecastSupply(state, true);
  return true;
}

/**
 * Widen a line that is already carrying power. The capacity itself does not move until the work
 * finishes -- crews restring one circuit at a time rather than taking an interconnector out of
 * service for a year -- so everything here books the money and starts a clock.
 */
function applyUpgradeTransmissionLine(
  state: GameType,
  payload: Partial<UpgradeTransmissionLineAction>,
): boolean {
  if (typeof payload.corridorId !== "string") return false;
  const line = state.transmission?.lines.find(
    ({ corridorId }) => corridorId === payload.corridorId,
  );
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  // Only a finished line can be widened, and only one job at a time.
  if (
    !line ||
    ownedUtilityConnection(state, line.corridorId) ||
    !now ||
    line.yearsToBuildLeft > 0 ||
    line.upgrade
  )
    return false;
  // Priced straight off the authored corridor, with no difficulty or inflation multiplier, the
  // same way building the line was: interties are quoted from TRANSMISSION_PROFILE_DATA as-is.
  const quote = intertieUpgradeQuote(
    line,
    state.date.year,
    1,
    1,
    accessContextForGame(state),
  );
  if (!quote) return false;
  const financed = !!payload.financed;
  // One line, one loan. Rolling the new borrowing into the existing balance at the current
  // rate is the same treatment a facility's build loan gets, and it keeps a widened line from
  // needing a second schedule of its own.
  const { amountDue, loanAmount, monthlyPayment } = purchaseTerms(
    quote.buildCost,
    financed,
    state.interestRate,
    line.loanAmountLeft,
  );
  if (now.cash < amountDue) return false;
  now.cash -= amountDue;
  if (financed) {
    line.loanAmountLeft += loanAmount;
    line.loanMonthlyPayment = monthlyPayment;
    line.interestRate = state.interestRate;
    line.financed = true;
  }
  line.buildCost += quote.buildCost;
  line.upgrade = {
    targetCapacityW: quote.targetCapacityW,
    buildCost: quote.buildCost,
    annualOperatingCost: quote.annualOperatingCost,
    yearsToBuild: quote.yearsToBuild,
    yearsToBuildLeft: quote.yearsToBuild,
    constructionKgco2eTotal: quote.constructionKgco2eTotal,
    constructionKgco2eEmitted: 0,
  };
  if (financed) refreshInterestRate(state, now.cash);
  recordMeaningfulDecision(state, {
    lever: `intertie-upgrade:${line.id}`,
    label: `Upgrade ${line.name}`,
    kind: "asset",
    before: formatWatts(line.capacityW),
    after: formatWatts(quote.targetCapacityW),
  });
  logGameEvent(
    state,
    "BUILD",
    `Upgrade started: ${line.name}, ${formatWatts(line.capacityW)} to ${formatWatts(quote.targetCapacityW)}`,
    {
      importance: "NOTABLE",
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    },
  );
  state.timeline = reforecastSupply(state, true);
  return true;
}

/** The retrofit's name as it reads mid-sentence, e.g. "a cold-weather package". */
function retrofitLabel(upgrade: FacilityUpgradeType): string {
  if (upgrade === "combinedCycle") return "combined-cycle generation";
  return upgrade === "hailResistant"
    ? "hail-resistant panels"
    : "a cold-weather package";
}

/**
 * Records a retrofit payment (positive) or refund (negative) as a zero-length occurrence. Like an
 * authored scenario choice, it is booked immediately into this tick, and the occurrence lets a
 * re-forecast from the current tick re-add it to the new frame exactly once.
 */
function recordRetrofitTransaction(
  state: GameType,
  facilityId: number,
  upgrade: FacilityUpgradeType,
  cost: number,
) {
  const refund = cost < 0;
  const key = `retrofit${refund ? "-refund" : ""}:${facilityId}:${upgrade}:${state.date.minute}`;
  state.worldEvents.occurrences.push({
    key,
    definitionId: key,
    startsMinute: state.date.minute,
    endsMinute: state.date.minute,
    attributes: {
      retrofit: true,
      facilityId,
      upgrade,
      cost,
    },
    effects: {},
  });
  trimWorldEventOccurrences(state);
}

/**
 * Starts installing a weather-resilience upgrade on a standing facility.
 * The price is recomputed here from current state rather than trusted from the dialog and
 * paid up front. The plant is offline for RETROFIT_DOWNTIME_MINUTES, after which the upgrade takes
 * effect; see completeRetrofits.
 */
function applyRetrofitFacility(
  state: GameType,
  payload: unknown,
  bulk = false,
): boolean {
  if (!validRetrofitFacility(payload)) return false;
  const facility = state.facilities.find(({ id }) => id === payload.facilityId);
  if (!facility || facility.yearsToBuildLeft > 0) return false;
  const context = state;
  if (!context) return false;
  const conversion = payload.upgrade === "combinedCycle";
  const cost =
    payload.upgrade === "combinedCycle"
      ? gasConversionQuote(facility, context)?.cost
      : retrofitCost(facility, context, payload.upgrade);
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (cost === undefined || !Number.isFinite(cost) || cost < 0 || !now)
    return false;
  if (now.cash < cost) return false;
  now.cash -= cost;
  now.netWorth -= cost;
  now.expensesOM += cost;
  facility.lifetimeExpenses = (facility.lifetimeExpenses || 0) + cost;
  facility.upgradeInProgress = {
    upgrade: payload.upgrade,
    cost,
    startsMinute: state.date.minute,
    completesMinute:
      state.date.minute +
      (conversion ? GAS_CONVERSION_MINUTES : RETROFIT_DOWNTIME_MINUTES),
  };
  recordRetrofitTransaction(state, facility.id, payload.upgrade, cost);
  const label = retrofitLabel(payload.upgrade);
  logGameEvent(
    state,
    "BUILD",
    `Installing ${label} on ${facility.name} for ${formatMoneyConcise(cost)}. ${payload.upgrade === "coldWeatherPackage" ? "Staged work keeps 90% of capacity available for a month." : `Offline for ${conversion ? "six months" : "a month"}.`}`,
    {
      importance: "NOTABLE",
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    },
  );
  // Levers are lowercase kebab-case; saves reject anything else.
  const lever = conversion
    ? "combined-cycle"
    : payload.upgrade === "hailResistant"
      ? "hail-resistant"
      : "cold-weather-package";
  if (!bulk)
    recordMeaningfulDecision(state, {
      lever: `resilience:${facility.id}:${lever}`,
      label: `Add ${label} to ${facility.name}`,
      kind: "asset",
      before: "standard",
      after: lever,
    });
  if (!bulk) state.timeline = reforecastSupply(state, true);
  return true;
}

/**
 * Cancels a retrofit that is still being installed: the plant returns to service at once, as it
 * was, and the whole price is refunded. Lets the player try an upgrade without committing to it.
 */
function applyCancelRetrofit(state: GameType, payload: unknown): boolean {
  if (!Number.isSafeInteger(payload)) return false;
  const facility = state.facilities.find(({ id }) => id === payload);
  const upgrade = facility && upgradeInProgress(facility);
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (
    !facility ||
    !upgrade ||
    !now ||
    !isUpgradingAt(facility, state.date.minute) ||
    !Number.isFinite(upgrade.cost) ||
    upgrade.cost < 0
  )
    return false;
  const refund = upgrade.cost;
  now.cash += refund;
  now.netWorth += refund;
  now.expensesOM -= refund;
  facility.lifetimeExpenses = (facility.lifetimeExpenses || 0) - refund;
  delete facility.upgradeInProgress;
  recordRetrofitTransaction(state, facility.id, upgrade.upgrade, -refund);
  const lever =
    upgrade.upgrade === "combinedCycle"
      ? "combined-cycle"
      : upgrade.upgrade === "hailResistant"
        ? "hail-resistant"
        : "cold-weather-package";
  recordMeaningfulDecision(state, {
    lever: `resilience:${facility.id}:${lever}`,
    label: `Cancel upgrade of ${facility.name}`,
    kind: "asset",
    before: lever,
    after: "standard",
  });
  logGameEvent(
    state,
    "BUILD",
    `Canceled ${retrofitLabel(upgrade.upgrade)} on ${facility.name}; refunded ${formatMoneyConcise(refund)}.`,
    {
      importance: "NOTABLE",
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    },
  );
  state.timeline = reforecastSupply(state, true);
  return true;
}

/** Immediate company transfers are separate from delivered-energy sales and facility income. */
function bookScenarioTransaction(
  now: TickPresentFutureType,
  cost: number,
  grant: number,
): void {
  now.cash += grant - cost;
  now.netWorth += grant - cost;
  now.revenue += grant;
  now.revenueGrants = (now.revenueGrants ?? 0) + grant;
  now.expensesOM += cost;
}

/** Accepts one authored choice for live play and headless simulation. */
function applyScenarioResponse(state: GameType, payload: unknown): boolean {
  if (!validScenarioResponse(payload)) return false;
  const compiled = pendingScenarioRuleChoice(state);
  if (compiled?.key === payload.decisionId) {
    const rules = scenarioChoicesForGame(state).rules!;
    const option = compiled.options.find(
      (option) => option.id === payload.optionId,
    );
    if (
      !option ||
      !applyCompiledScenarioResponse(state, rules, compiled, option)
    )
      return false;
    resolveAutomaticScenarioChoices(state);
    return true;
  }
  // A pending story choice the clock waits on, or an optional one the player chose to take up
  const decision = pendingScenarioChoice(state);
  if (!decision || decision.id !== payload.decisionId) return false;
  const option = decision.options.find(
    (option) => option.id === payload.optionId,
  );
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (!option || !now) return false;
  const cost = option.cost(state.difficulty);
  if (!Number.isFinite(cost) || cost < 0 || (cost > 0 && now.cash < cost))
    return false;
  const upfrontGrant = option.upfrontGrant?.(state.difficulty) ?? 0;
  if (!Number.isFinite(upfrontGrant) || upfrontGrant < 0) return false;
  bookScenarioTransaction(now, cost, upfrontGrant);
  if (option.loadAdditions)
    state.loadAdditions = cloneDeep(option.loadAdditions);
  state.worldEvents.occurrences.push({
    key: decision.id,
    definitionId: decision.id,
    startsMinute: state.date.minute,
    endsMinute: state.date.minute,
    attributes: {
      choice: option.id,
      cost,
      upfrontGrant,
      scenarioChoice: true,
    },
    effects: {},
    title: decision.title,
    message: option.message,
  });
  logGameEvent(state, "WORLD_EVENT", option.message, {
    title: decision.title,
    importance: "NOTABLE",
    storyPhaseKey: decision.id,
    turningPointPriority: 115,
  });
  if (option.meaningful !== false)
    recordMeaningfulDecision(state, {
      lever: decision.id,
      label: decision.title,
      kind: "policy",
      before: "undecided",
      after: option.id,
    });
  state.timeline = reforecastSupply(state, true);
  return true;
}

function applyCompiledScenarioResponse(
  state: GameType,
  rules: CompiledScenarioRules,
  decision: CompiledRuleChoice,
  option: CompiledRuleOption,
): boolean {
  const sharedStoryRules = !!scenarioRules(
    getScenario(state.scenarioId, state.customScenario),
    state,
  );
  const bulk =
    isBulkWinterizationChoice(decision) && option.id === "winterize"
      ? bulkWinterizationQuote(state)
      : undefined;
  const cost = bulk?.cost ?? option.cost;
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (
    !now ||
    state.date.minute !== decision.dueMonth * MINUTES_PER_MONTH ||
    state.worldEvents.occurrences.some((event) => event.key === decision.key) ||
    !Number.isFinite(cost) ||
    cost < 0 ||
    (cost > 0 && now.cash < cost) ||
    !Number.isFinite(option.grant) ||
    option.grant < 0
  )
    return false;
  const loads = scenarioRuleChoiceLoadPlan(state, rules, decision, option);
  if (!loads) return false;
  const before = new Set(
    state.worldEvents.occurrences.map((event) => event.key),
  );
  const beforeEffects = sharedStoryRules
    ? storyEffectsAt(state.date, state)
    : undefined;
  const previousLoadIds = new Set(state.loadAdditions.map((load) => load.id));
  // Each asset owns its payment/refund; the choice receipt must not book it again.
  bookScenarioTransaction(now, bulk ? 0 : cost, option.grant);
  for (const item of bulk?.facilities ?? []) {
    applyRetrofitFacility(
      state,
      { facilityId: item.facilityId, upgrade: "coldWeatherPackage" },
      true,
    );
  }
  state.loadAdditions = loads;
  const message = decision.automatic
    ? `Resolved automatically: ${option.label}. ${option.message}`
    : option.message;
  state.worldEvents.occurrences.push({
    key: decision.key,
    definitionId: decision.key,
    startsMinute: state.date.minute,
    endsMinute: state.date.minute,
    attributes: {
      choice: option.id,
      cost: bulk ? 0 : cost,
      ...(bulk
        ? {
            retrofitCost: cost,
            retrofitFacilityIds: bulk.facilities.map((item) => item.facilityId),
          }
        : {}),
      upfrontGrant: option.grant,
      scenarioChoice: true,
      ...(rules.namespace.kind === "mod" || !decision.source
        ? { ruleChoice: true, automatic: !!decision.automatic }
        : {}),
    },
    effects: {},
    title: decision.title,
    message,
  });
  logGameEvent(state, "WORLD_EVENT", message, {
    title: decision.title,
    importance: "NOTABLE",
    storyPhaseKey: decision.key,
    turningPointPriority: 115,
  });
  if (!decision.automatic && option.meaningful !== false)
    recordMeaningfulDecision(state, {
      lever: decision.key,
      label: decision.title,
      kind: "policy",
      before: "undecided",
      after: option.id,
    });
  if (sharedStoryRules && (rules.namespace.kind === "mod" || !decision.source))
    updateWorldEvents(state);
  for (const event of state.worldEvents.occurrences) {
    if (
      before.has(event.key) ||
      event.attributes.ruleEvent !== true ||
      event.startsMinute !== state.date.minute
    )
      continue;
    const grant = Number(event.attributes.upfrontGrant ?? 0),
      cost = Number(event.attributes.cost ?? 0);
    bookScenarioTransaction(now, cost, grant);
  }
  const effects = sharedStoryRules
    ? storyEffectsAt(state.date, state)
    : undefined;
  const connectsNow = state.loadAdditions.some(
    (load) =>
      !previousLoadIds.has(load.id) &&
      (load.startsYear - state.startingYear) * 12 +
        (load.startsMonth ?? 1) -
        1 <=
        state.date.monthsElapsed,
  );
  // A future connection or protection commitment must not project customer growth a second
  // time into this already forecast frame. Rebuild demand only when this opening changes it.
  if (
    connectsNow ||
    effects?.demandMultiplier !== beforeEffects?.demandMultiplier ||
    effects?.temperatureOffsetC !== beforeEffects?.temperatureOffsetC
  ) {
    state.timeline = generateNewTimeline(
      state,
      now.cash,
      now.customers,
      state.timeline.length,
    );
  } else {
    if (
      effects?.hydroRunoffMultiplier !== beforeEffects?.hydroRunoffMultiplier ||
      canonicalRuleJson(effects?.fuelPriceMultipliers ?? {}) !==
        canonicalRuleJson(beforeEffects?.fuelPriceMultipliers ?? {})
    )
      state.timeline = reforecastWeatherAndPrices(state);
    state.timeline = reforecastSupply(state, true);
  }
  return true;
}

/** Automatic arc branches use the same atomic transition, without a player decision. */
function resolveAutomaticScenarioChoices(state: GameType): void {
  let choice = pendingScenarioRuleChoice(state, true);
  while (choice) {
    const rules = scenarioChoicesForGame(state).rules!;
    const freeOptionId = choice.freeOptionId;
    const option = choice.options.find((option) => option.id === freeOptionId);
    if (!option || !applyCompiledScenarioResponse(state, rules, choice, option))
      return;
    choice = pendingScenarioRuleChoice(state, true);
  }
}

function applyPolicyEdit(
  state: GameType,
  payload: unknown,
  cancel: boolean,
): boolean {
  const scenario = getScenario(state.scenarioId, state.customScenario);
  if (
    !validPolicyChange(payload) ||
    !policyAvailable(state) ||
    !scenario ||
    !state.timeline.length ||
    state.date.monthsElapsed !==
      Math.floor(state.date.minute / MINUTES_PER_MONTH) ||
    payload.month !== state.date.monthsElapsed + 1 ||
    payload.month >= scenario.durationMonths
  )
    return false;
  const existing = state.policies?.programs[payload.id];
  if (
    !cancel &&
    payload.tier === "On" &&
    isFlexibilityPolicy(payload.id) &&
    !(existing?.adoption ?? 0) &&
    !flexibilityAvailable(state, payload.id, payload.month)
  )
    return false;
  // A finished build-out has nothing left to fund, pause or resume.
  if (
    !cancel &&
    !isOperatingPolicy(payload.id) &&
    !isFlexibilityPolicy(payload.id) &&
    buildoutComplete(existing?.adoption ?? 0)
  )
    return false;
  const before = policyChoiceLabel(payload.id, existing?.pending ?? existing);
  if (cancel) {
    if (
      !existing?.pending ||
      existing.pending.month !== payload.month ||
      !samePolicyChoice(payload.id, existing.pending, payload)
    )
      return false;
    delete existing.pending;
  } else {
    if (
      samePolicyChoice(
        payload.id,
        payload,
        existing?.pending ?? existing ?? { tier: "Off" },
      )
    )
      return false;
    state.policies ??= emptyPolicies(state.date.monthsElapsed);
    const program = state.policies.programs[payload.id];
    if (samePolicyChoice(payload.id, payload, program)) delete program.pending;
    else {
      const { id: _id, ...pending } = payload;
      program.pending = pending;
    }
  }
  const program = state.policies!.programs[payload.id];
  const after = policyChoiceLabel(
    payload.id,
    cancel ? existing : (program.pending ?? program),
  );
  recordMeaningfulDecision(state, {
    lever: `policy:${payload.id.toLowerCase()}`,
    label: POLICIES[payload.id].name,
    kind: "policy",
    before,
    after,
  });
  // Accepted changes start next month; the current month's demand and customer balance
  // already happened. Long-range callers project the new pending state independently.
  state.timeline = reforecastSupply(state, true);
  return true;
}

/**
 * Whether this run's rate can follow inflation at all: solo public utilities only. Investor-owned
 * and multiplayer companies, and tutorials, set their own rates.
 */
function canFollowInflation(state: GameType): boolean {
  const scenario = getScenario(state.scenarioId, state.customScenario);
  return (
    !!scenario &&
    scenario.ownership === "Public" &&
    !scenario.tutorialSteps &&
    !state.multiplayer
  );
}

/**
 * Whether the rate moves with inflation: the saved setting, honoured only where following is
 * allowed, so an edited save cannot inflate an investor's or a multiplayer company's rate.
 */
function followsInflation(state: GameType): boolean {
  return !!state.rateFollowsInflation && canFollowInflation(state);
}

/**
 * The rate a following public utility charges at `date`: the current rate carried forward by
 * whatever inflation has passed since now, mirroring the live rollover's January step.
 */
function inflationAdjustedRateAt(state: GameType, date: DateType): number {
  const base = getRateInflationIndex(
    state.date,
    state.startingYear,
    state.seed,
  );
  return (
    (state.dollarsPerkWh *
      getRateInflationIndex(date, state.startingYear, state.seed)) /
    base
  );
}

/** Current-month edits stay in force; future months carry the rate forward with inflation. */
function customerBaseRateAt(state: GameType, date: DateType): number {
  return date.monthsElapsed > state.date.monthsElapsed &&
    followsInflation(state)
    ? inflationAdjustedRateAt(state, date)
    : state.dollarsPerkWh;
}

/**
 * Turning following on starts adjusting the current rate with inflation; setting a rate by hand
 * turns it off. Deltas that also pick the scenario are setup, which initGame settles.
 */
function normalizeRateDelta(state: GameType, payload: Partial<GameType>) {
  const setup = "scenarioId" in payload || "customScenario" in payload;
  if (payload.rateFollowsInflation === true && !setup) {
    // No snap to the target: the rate keeps its current level and starts moving with inflation.
    if (!canFollowInflation(state)) delete payload.rateFollowsInflation;
  } else if (
    typeof payload.dollarsPerkWh === "number" &&
    payload.rateFollowsInflation === undefined &&
    state.rateFollowsInflation &&
    !setup
  ) {
    payload.rateFollowsInflation = false;
  }
  if (typeof payload.dollarsPerkWh === "number") {
    payload.dollarsPerkWh = capRateForScenario(state, payload);
  }
}

/**
 * A public utility's board caps its rate (see publicRateCap); investors are left to competition.
 * Deltas that also pick the scenario are setup, not a player's rate choice, and pass unchanged.
 */
function capRateForScenario(
  state: GameType,
  payload: Partial<GameType>,
): number {
  const rate = payload.dollarsPerkWh as number;
  if (
    !Number.isFinite(rate) ||
    "scenarioId" in payload ||
    "customScenario" in payload
  ) {
    return rate;
  }
  const scenario = getScenario(state.scenarioId, state.customScenario);
  if (!scenario || scenario.ownership !== "Public" || scenario.tutorialSteps) {
    return rate;
  }
  return Math.min(
    rate,
    publicRateCap(
      scenario.dollarsPerkWh,
      state.date,
      state.startingYear,
      state.seed,
    ),
  );
}

/**
 * Ends whatever is running and drops the player straight into a tutorial.
 *
 * quit() first because start() only swaps the scenario id: on its own the new run would inherit
 * the finished one's facilities, cash and walkthrough position.
 */
export function startTutorial(dispatch: AppDispatch, scenarioId: number) {
  dispatch(quit());
  dispatch(start(scenarioId));
}

/**
 * Ends whatever is running and starts a custom scenario, whether set up on the custom game screen
 * or resolved from a mod. The scenario has to be on the slice before start(), since the loading
 * screen resolves it straight back out of there.
 */
export function launchCustomScenario(
  dispatch: AppDispatch,
  scenario: ScenarioType,
  difficulty: DifficultyType,
) {
  if (
    scenario.rules !== undefined ||
    (scenario.mod &&
      (!validScenarioMod(scenario.mod, scenario) ||
        scenario.mod.parameters.difficulty !== difficulty))
  )
    throw new Error(
      "This mod's runtime snapshot is invalid. Reimport a valid package before playing.",
    );
  dispatch(quit());
  dispatch(delta({ difficulty }));
  dispatch(delta({ scenarioId: CUSTOM_SCENARIO_ID, customScenario: scenario }));
  dispatch(start(CUSTOM_SCENARIO_ID));
}

/**
 * The end of a tutorial, which is a different moment from the end of a scenario: there's no score
 * to report and the useful next step is the next tutorial, so this celebrates, says where the
 * player is in the sequence, and offers that next tutorial rather than a scoreboard.
 */
export function tutorialCompleteDialog({
  title,
  message,
  nextTutorial,
}: {
  title: string;
  message?: string;
  nextTutorial?: ScenarioType;
}) {
  // The sequence position already lives in the mission name ("Mission 2: Generators"); fold the
  // total into it so the handoff says where the player is without a separate progress line.
  const nextName = nextTutorial?.name.replace(
    /^(Mission \d+):/,
    `$1 of ${TUTORIALS.length}:`,
  );
  return dialogOpen({
    title: `🎉 ${title}`,
    message: (
      <div>
        {message && (
          <span>
            {message}
            <br />
            <br />
          </span>
        )}
        {nextTutorial && (
          <div className="tutorialNextPreview">
            <strong>Up next: {nextName}</strong>
            <span>{nextTutorial.summary}</span>
          </div>
        )}
      </div>
    ),
    open: true,
    // Both buttons lead somewhere; dismissing would strand the player in a finished scenario
    notCancellable: true,
    offerInstall: true,
    secondaryLabel: "Back to main menu",
    secondaryAction: () => getStore().dispatch(quit()),
    actionLabel: nextTutorial ? "Next tutorial" : undefined,
    action: nextTutorial
      ? () => startTutorial(getStore().dispatch, nextTutorial.id)
      : undefined,
  });
}

/**
 * Give a live tick private mutable outputs while keeping large read-only inputs plain.
 * Only the frame being settled is written, preserving untouched chart rows.
 */
function tickWorkingState(state: GameType): GameType {
  return {
    ...state,
    timeline: [...state.timeline],
    facilities: state.facilities.map((facility) => ({ ...facility })),
    ...(state.transmission && {
      transmission: state.transmission.lines.length
        ? {
            ...state.transmission,
            lines: state.transmission.lines.map((line) => ({
              ...line,
              ...(line.upgrade && { upgrade: { ...line.upgrade } }),
            })),
          }
        : state.transmission,
    }),
    eventLog: [...state.eventLog],
    reportedEventKeys: [...state.reportedEventKeys],
    utilityExpansion: cloneDeep(state.utilityExpansion),
    commissionedHydroSiteIds: [...state.commissionedHydroSiteIds],
    ...(state.blackout && { blackout: { ...state.blackout } }),
    ...(state.tutorialIntertieStress && {
      tutorialIntertieStress: { ...state.tutorialIntertieStress },
    }),
  };
}

/** Isolate each frame just before it is settled, including frames after a batch rolls over. */
function completedMonthCount(state: GameType): number {
  const latest = state.monthlyHistory[0];
  return Math.max(
    state.objectiveProgress?.completedMonths ?? 0,
    latest ? (latest.year - state.startingYear) * 12 + latest.month : 0,
  );
}

export type CompletedMonthObserver = (
  timeline: readonly TickPresentFutureType[],
) => void;

function tickWorkingStateStep(
  state: GameType,
  saveEffects?: RunSaveEffects,
  onCompletedMonth?: CompletedMonthObserver,
) {
  const minute = state.date.minute + TICK_MINUTES;
  const frame = getTimeFromTimeline(minute, state.timeline);
  if (frame) {
    const copy = { ...frame };
    copyCommitmentMetadata(frame, copy);
    state.timeline[state.timeline.indexOf(frame)] = copy;
  }
  if (completedMonthCount(state) < Math.floor(minute / MINUTES_PER_MONTH)) {
    state.monthlyHistory = [...state.monthlyHistory];
    if (state.policies) state.policies = cloneDeep(state.policies);
    state.worldEvents = {
      ...state.worldEvents,
      active: [...state.worldEvents.active],
      occurrences: [...state.worldEvents.occurrences],
      checkedKeys: [...state.worldEvents.checkedKeys],
    };
  }
  tickState(state, saveEffects, onCompletedMonth);
}

function adoptTickWorkingState(
  draft: GameType,
  snapshot: GameType,
  working: GameType,
) {
  // An ordinary tick does not change these append-only records. Keep their references stable
  // for selectors and mounted event/history panes, just as Immer's original path did.
  if (
    working.eventLog.length === snapshot.eventLog.length &&
    working.eventLog[0] === snapshot.eventLog[0]
  )
    working.eventLog = snapshot.eventLog;
  if (working.reportedEventKeys.length === snapshot.reportedEventKeys.length)
    working.reportedEventKeys = snapshot.reportedEventKeys;
  if (
    working.commissionedHydroSiteIds.length ===
    snapshot.commissionedHydroSiteIds.length
  )
    working.commissionedHydroSiteIds = snapshot.commissionedHydroSiteIds;
  // A pending choice can pause immediately before a rollover. No monthly inputs changed then.
  if (working.monthlyHistory.length === snapshot.monthlyHistory.length) {
    working.monthlyHistory = snapshot.monthlyHistory;
    working.worldEvents = snapshot.worldEvents;
    if (snapshot.policies) working.policies = snapshot.policies;
  }
  if (snapshot.blackout && !working.blackout) delete draft.blackout;
  Object.assign(draft, working);
}

// Ticks the state forward in place
// Exported so the headless simulator (src/testing/Simulator.tsx) can drive the sim
// without the wall-clock timers that the `tick` action uses.
export function tickState(
  state: GameType,
  saveEffects?: RunSaveEffects,
  onCompletedMonth?: CompletedMonthObserver,
) {
  const phases = tickStatePhases(state, saveEffects, onCompletedMonth);
  while (!phases.next().done) {
    /* Single-player has no peer settlement. */
  }
}

/** Plan every grid before resuming any grid's settlement. */
export function* tickStatePhases(
  state: GameType,
  saveEffects?: RunSaveEffects,
  onCompletedMonth?: CompletedMonthObserver,
): Generator<PeerPlan, void, PeerSettlement | undefined> {
  if (isDraft(state)) {
    const snapshot = current(state);
    const working = tickWorkingState(snapshot);
    tickWorkingStateStep(working, saveEffects, onCompletedMonth);
    adoptTickWorkingState(state, snapshot, working);
    return;
  }
  if (
    state.tutorialIntertieStress?.active &&
    getTutorialStep(state)?.phase !== "INTERTIE_STRESS_SUPPLY"
  ) {
    state.speed = "PAUSED";
    return;
  }
  const speedBeforeTick = foregroundSpeed(state);
  const stressWasActive = !!state.tutorialIntertieStress?.active;
  if (pendingScenarioChoice(state)) {
    state.scenarioChoicePause ??= speedBeforeTick;
    setForegroundSpeed(state, "PAUSED");
    return;
  }
  state.date = getDateFromMinute(
    state.date.minute + TICK_MINUTES,
    state.startingYear,
  );
  completeRetrofits(state);
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  const prev = getTimeFromTimeline(
    state.date.minute - TICK_MINUTES,
    state.timeline,
  );
  if (now && prev) {
    yield* supplyFacilitiesFinancesPhases(state, prev, now);
    desktopSimulationHooks()?.tick(state, now);
    logHailRepairsCompleted(state);

    const exercise = state.tutorialIntertieStress;
    if (exercise?.active) {
      exercise.suppliedTicks =
        now.supplyW >= now.demandW ? exercise.suppliedTicks + 1 : 0;
      if (exercise.suppliedTicks >= TICKS_PER_MONTH) {
        exercise.active = false;
        exercise.completed = true;
        state.speed = "PAUSED";
      }
    }
    // The pulsing top bar only tells a player who is looking at it, and by default they're
    // looking at Finances or Forecasts. Fire on the edges only, never per tick.
    // Edge-detected against the slice, so a sustained blackout announces itself once rather than
    // four times an hour of game time, and a resumed save picks up the one it was taken during
    const inBlackout = now.supplyW < now.demandW;
    const wasInBlackout = state.blackout !== undefined;
    if (inBlackout) {
      if (!state.blackout) {
        state.blackout = { startMinute: state.date.minute, unservedWh: 0 };
        logGameEvent(
          state,
          "BLACKOUT",
          `Blackout: ${formatWatts(now.demandW - now.supplyW)} short.`,
        );
      }
      // What the lights being out is actually costing, in the same units the score is docked in.
      // Accumulated per tick rather than worked out at the end, since the gap moves the whole
      // time the blackout lasts
      state.blackout.unservedWh +=
        ((now.demandW - now.supplyW) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
    } else if (state.blackout) {
      // The toast that says this vanishes in four seconds and the pulsing bar stops the moment
      // it's over, so without this a player who was looking elsewhere never learns what it cost
      logGameEvent(
        state,
        "BLACKOUT_OVER",
        `Blackout ended after ${blackoutLength(state.date.minute - state.blackout.startMinute)}. The grid could not supply ${formatWattHours(state.blackout.unservedWh)} of electricity demand.`,
      );
      delete state.blackout;
    }
    if (!state.multiplayer && inBlackout !== wasInBlackout) {
      const message = inBlackout
        ? `${BLACKOUT_TOAST_PREFIX} ${formatWatts(now.demandW - now.supplyW)} short. Customers leave while it lasts. Build more supply, or resume a paused plant.`
        : BLACKOUT_OVER_TOAST;
      setTimeout(() => {
        // Pausing a plant is the usual way into a blackout, and it raises its own "Paused X /
        // UNDO" toast. There's only one snackbar slot, so stealing it would take the undo away
        // at the exact moment the player most wants it. The pulsing top bar and the red sky band
        // already carry the blackout, so this toast yields rather than competes. It still
        // replaces the previous blackout toast, which would otherwise be stale.
        if (!blackoutToastCanShow(getStore().getState().ui.snackbar)) {
          return;
        }
        getStore().dispatch(
          snackbarOpen({ message, open: true, timeout: 4000 }),
        );
      }, 0);
    }

    const history = state.monthlyHistory;
    // One row per completed month is both the rollover signal and the persisted checkpoint. It
    // avoids module-level calendar state leaking between concurrent simulations or a second game,
    // and unlike an empty sentinel it cannot count the opening forecast as completed history.
    if (completedMonthCount(state) < state.date.monthsElapsed) {
      const { cash, customers } = now;
      state.customerRate = now.customerRate;

      // Record final history for the month, then generate the new timeline
      // Observe the same settled frames as history, before rollover.
      onCompletedMonth?.(state.timeline);
      history.unshift(summarizeTimeline(state.timeline, state.startingYear));
      recordGameObjectiveMonth(state, history[0]);
      // Reprice the company's credit off the year that just closed, before the forecast is built
      // against it. Operating results reprice monthly; new borrowing reprices immediately.
      refreshInterestRate(state, cash, now.netWorth);
      const storyPriceFuels = updateWorldEvents(state);
      recordExpansionMilestones(state);
      // Resolve recurring regional hazards after the authored story effects.
      updateWeatherHazards(state).forEach((fuel) => storyPriceFuels.add(fuel));
      const activatedPrograms = advanceGamePolicies(
        state,
        state.date.monthsElapsed,
      );
      activatedPrograms.forEach((id) =>
        logGameEvent(
          state,
          "WORLD_EVENT",
          `${POLICIES[id].name}: ${policyChoiceLabel(id, state.policies!.programs[id])} starts this month.`,
        ),
      );
      if (followsInflation(state)) {
        // The retail index steps once a year, in January; carry the rate across that step.
        const previousDate = getDateFromMinute(
          state.date.minute - TICK_MINUTES,
          state.startingYear,
        );
        const previousIndex = getRateInflationIndex(
          previousDate,
          state.startingYear,
          state.seed,
        );
        const index = getRateInflationIndex(
          state.date,
          state.startingYear,
          state.seed,
        );
        if (index !== previousIndex) {
          state.dollarsPerkWh = (state.dollarsPerkWh * index) / previousIndex;
        }
      }
      state.timeline = generateNewTimeline(
        state,
        cash + openingRuleTransactions(state),
        customers,
      );
      resolveAutomaticScenarioChoices(state);
      logFuelPriceMoves(state, storyPriceFuels);
      logFuelCrossovers(state);
      // Advised once per plant: a paused-and-resumed plant is the player's informed choice
      generatorsAboveDemandFloor(state.facilities, history[0]).forEach(
        (generator) =>
          logGameEvent(state, "WORLD_EVENT", mothballAdvice(generator), {
            title: "Plant running above demand",
            concept: "fuel",
            importance: "NOTABLE",
            actionTarget: { card: "FACILITIES", view: "FLEET" },
            reportedKey: `above-demand-floor:${generator.id}`,
          }),
      );

      // Pre-roll a few frames to compensate for temperature / demand jumps across months
      for (let i = 0; i < 4; i++) {
        updateSupplyFacilitiesFinances(
          state,
          state.timeline[0],
          state.timeline[0],
          true,
          true,
        );
      }

      if (state.multiplayer) {
        // The host judges each company by the single-player rules, then leaves every effect
        // (score, dialogs, analytics, saves) to the shared match.
        const scenario = getScenario(state.scenarioId, state.customScenario);
        if (scenario && !state.multiplayer.ending) {
          const failure = runFailure(state, scenario, history, now, false);
          const month = state.date.monthsElapsed;
          if (failure) state.multiplayer.ending = { ...failure, month };
          else if (month >= (scenario.durationMonths || 12 * 20))
            state.multiplayer.ending = {
              outcome: "completed",
              title: scenario.endTitle || "Mission complete!",
              month,
            };
        }
        return;
      }

      // ===== TRIGGERS ======
      // state is an Immer draft, and it's revoked the moment this reducer returns - so anything
      // the timeouts below need has to be read out here rather than from inside their callbacks
      const scenarioId = state.scenarioId;
      const scenario =
        getScenario(state.scenarioId, state.customScenario) || SCENARIOS[0];
      const isTutorial = Boolean(scenario.tutorialSteps);
      const activeTutorialCapstone = Boolean(
        scenario.tutorialSteps?.[state.tutorialStep]?.capstone,
      );
      // The leaderboard is keyed on scenario id alone, so custom runs - whatever cash, duration
      // and rules the player gave themselves - would be scored against each other as if they
      // were the same scenario. Mods always run as the custom scenario, so this also excludes
      // them from scores and completion records.
      const ranked = scenario.id !== CUSTOM_SCENARIO_ID;
      const modded = !!state.customScenario?.mod;

      /**
       * All non-tutorial endings use one scoring path. In particular, bankruptcy and firing used
       * to open a plain message and skip both the score screen and submitHighscore entirely.
       * Everything captured by the timeout is copied out of the Immer draft before it is revoked.
       */
      const finishScoredRun = (
        summary: MonthlyHistoryType,
        outcome: NonNullable<VictoryType["outcome"]>,
        endTitle?: string,
        endMessage?: string | (() => string),
      ) => {
        desktopSimulationHooks()?.finish(state, outcome);
        const score: ScoreBreakdownType = computeScoreBreakdown(
          scenario,
          summary,
          startingDollarRevenue(history, state.startingYear, state.seed),
        );
        const finalScore = totalScore(score);
        const difficulty = state.difficulty;
        const { id: scoredScenarioId, name: scenarioName } = scenario;
        const submitsScore = ranked && outcome === "completed";
        const runIdentity = state.runIdentity
          ? cloneDeep(state.runIdentity)
          : undefined;
        const challenge = state.challenge
          ? cloneDeep(state.challenge)
          : undefined;
        const debrief = buildVictoryDebrief(
          scenario,
          summary,
          state.facilities,
          state.eventLog,
          state.monthlyHistory,
          state.dollarsPerkWh,
          state.worldEvents.occurrences,
          gameObjectiveResults(state),
        );
        debrief.scenarioMetrics = [
          {
            concept: "money",
            label:
              scenario.ownership === "Investor"
                ? "final net worth"
                : "lifetime rate (starting-year $/kWh)",
            value:
              scenario.ownership === "Investor"
                ? formatMoneyConcise(summary.netWorth)
                : summary.supplyWh > 0
                  ? `$${(startingDollarRevenue(history, state.startingYear, state.seed) / (summary.supplyWh / 1000)).toFixed(3)}`
                  : "No electricity supplied",
          },
          ...(debrief.scenarioMetrics ?? []),
        ];

        logEvent("scenario_end", {
          id: scoredScenarioId,
          type:
            outcome === "completed"
              ? "win"
              : outcome === "fired"
                ? "blackouts"
                : "bankrupt",
          difficulty,
          score: finalScore,
        });
        if (challenge)
          logEvent("challenge_complete", {
            scenarioId: scoredScenarioId,
            outcome,
          });
        // Bind the outcome before the reducer returns. The middleware persists the final
        // Redux snapshot afterwards; no delayed callback can target a different live save.
        if (saveEffects) {
          saveEffects.outcome(
            cloneDeep({
              scenarioId: scoredScenarioId,
              scenarioName,
              difficulty,
              score: finalScore,
              scoreVersion: SCORE_VERSION,
              breakdown: score,
              endTitle,
              endMessage:
                typeof endMessage === "string" ? endMessage : undefined,
              ranked: submitsScore,
              outcome,
              debrief,
            }),
            typeof endMessage === "function" ? endMessage : undefined,
          );
        }
        setTimeout(() => {
          // Read before the submit below, so "was 640" means the run before this one rather than
          // the one that just finished. getState() cannot be called while the reducer is running.
          const previousBest = competitiveBest(
            getStore().getState().user.bests,
            scoredScenarioId,
          )?.score;
          getStore().dispatch(
            victoryOpen({
              runIdentity,
              challenge,
              scenarioId: scoredScenarioId,
              scenarioName,
              difficulty,
              score: finalScore,
              scoreVersion: SCORE_VERSION,
              breakdown: score,
              endTitle,
              endMessage:
                typeof endMessage === "function" ? endMessage() : endMessage,
              ranked: submitsScore,
              modded,
              previousBest,
              outcome,
              debrief,
            }),
          );
          if (submitsScore) {
            getStore().dispatch(
              submitHighscore({
                outcome,
                score: finalScore,
                scoreBreakdown: score, // For analytics purposes only
                scenarioId: scoredScenarioId,
                difficulty,
              }),
            );
          }
        }, 1);
      };

      const termMonths = scenario.durationMonths || 12 * 20;
      const failure = runFailure(state, scenario, history, now, isTutorial);

      desktopSimulationHooks()?.month(
        state,
        !failure && state.date.monthsElapsed < termMonths,
      );

      if (failure) {
        const summary = summarizeHistory(history);
        const yearsSurvived = state.date.year - state.startingYear;
        const durationSurvived =
          yearsSurvived > 0
            ? `${yearsSurvived} ${yearsSurvived === 1 ? "year" : "years"}`
            : `${state.date.monthsElapsed} ${state.date.monthsElapsed === 1 ? "month" : "months"}`;
        const failureMessage = () =>
          `${
            failure.outcome === "bankrupt"
              ? "You've run out of money."
              : failure.reason
          }
                You survived for ${durationSurvived},
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${formatLargeMass(summary.kgco2e, getStore().getState().settings.units)} of greenhouse gases, measured as CO2e.`;

        // Tutorials are intentionally unscored even when completed, so retain their guided
        // failure dialog rather than putting one tutorial attempt on the global leaderboard.
        if (isTutorial) {
          logEvent("scenario_end", {
            id: scenarioId,
            type: failure.outcome === "fired" ? "blackouts" : "bankrupt",
            difficulty: state.difficulty,
          });
          setTimeout(() => {
            getStore().dispatch(
              dialogOpen({
                title: failure.title,
                message: failureMessage(),
                open: true,
                notCancellable: true,
                actionLabel: "Try again",
                action: () =>
                  getStore().dispatch(quit({ toScenarioList: true })),
              }),
            );
          }, 1);
        } else {
          finishScoredRun(
            summary,
            failure.outcome,
            failure.title,
            failureMessage,
          );
        }
      } else if (
        state.date.monthsElapsed === (scenario.durationMonths || 12 * 20) &&
        !activeTutorialCapstone
      ) {
        // Success: Survived duration
        // Every custom game shares one id, so recording it would light up a completion marker for
        // a scenario nobody authored. Tutorials are recorded only when their final objective is
        // satisfied, so merely letting their scenario clock expire cannot bypass a capstone.
        if (ranked && !isTutorial) {
          recordScenarioPlayed(scenarioId);
        }

        const summary = summarizeHistory(history);
        if (isTutorial) {
          const capstoneIndex =
            scenario.tutorialSteps?.findIndex((step) => step.capstone) ?? -1;
          if (capstoneIndex >= 0) {
            // Reaching the authored time limit is not the same as completing the mission. A
            // player can start the clock before reading the walkthrough; pause here so they can
            // finish the objectives and enter the capstone, which rebuilds its own checkpoint.
            state.speed = "PAUSED";
          } else {
            const score = computeScoreBreakdown(
              scenario,
              summary,
              startingDollarRevenue(history, state.startingYear, state.seed),
            );
            const finalScore = totalScore(score);
            const { id: scoredScenarioId, endTitle, endMessage } = scenario;
            const difficulty = state.difficulty;
            const nextTutorial = getNextTutorial(scoredScenarioId);
            logEvent("scenario_end", {
              id: scoredScenarioId,
              type: "win",
              difficulty,
              score: finalScore,
            });
            setTimeout(() => {
              return getStore().dispatch(
                tutorialCompleteDialog({
                  title: endTitle || "Mission complete!",
                  message: endMessage,
                  nextTutorial,
                }),
              );
            }, 1);
          }
        } else {
          finishScoredRun(
            summary,
            "completed",
            scenario.endTitle,
            scenario.endMessage,
          );
        }
      }
    }
  }

  if (stressWasActive && state.tutorialIntertieStress?.completed)
    state.timeline = reforecastSupply(state, true);

  // A choice that came due during this tick pauses the clock before the next one
  if (pendingScenarioChoice(state)) {
    state.scenarioChoicePause ??= speedBeforeTick;
    setForegroundSpeed(state, "PAUSED");
  }
}

export {
  hasChronicBlackouts,
  scenarioObjectiveFailure,
} from "../helpers/ObjectiveRules";

// Simplified customer forecast, assumes no blackouts since supply calculation depends on demand
// (circular dependency). The supply pass repeats the calculation with reliability attrition.
function getDemandW(
  date: DateType,
  game: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
  tickScale = 1,
) {
  const scenario =
    getScenario(game.scenarioId, game.customScenario) || SCENARIOS[0];
  now.customerRate = updateCustomerRate(
    prev.customerRate || game.customerRate,
    prev.customerBillingRate ?? game.dollarsPerkWh,
    tickScale,
  );
  now.customers = nextCustomerCount({
    customers: prev.customers,
    customerRate: now.customerRate,
    marketRate: getMarketRate(
      scenario.dollarsPerkWh,
      date,
      game.startingYear,
      game.seed,
    ),
    marketSize: customerMarketSizeAt(game.customerMarketSize, now.minute),
    ownership: scenario.ownership,
    tickScale,
  });
  // A current-frame reforecast is not another customer-growth interval.
  if (game.utilityExpansion && now.minute === game.date.minute) {
    const current = getTimeFromTimeline(game.date.minute, game.timeline);
    now.customers = current?.customers ?? prev.customers;
    now.customerRate = current?.customerRate ?? prev.customerRate;
  }
  const profile = game.utilityExpansion
    ? combinedUtilityDemandProfile(game)
    : undefined;
  const { baselineW, weatherShare } = areaBaselineDemand(
    date,
    game.location,
    now.temperatureC,
    now.customers,
    profile?.demandScale ?? game.startingDemandScale,
    profile?.demandShapeExponent ?? game.demandShapeExponent ?? 1,
  );
  const effects = storyEffectsAt(date, game);
  const baselineDemandW = baselineW * (effects.demandMultiplier || 1);
  now.demandByType = demandByTypeAt(
    baselineDemandW,
    date,
    game.startingYear,
    game.location,
    game.loadAdditions,
    profile?.energyShares,
  );
  // Demand is rebuilt here; the supply pass must not restore a previous forecast's discharge.
  delete now.customerBatteryDischargeW;
  // The 20 W floor is the temperature term's baseline, not heating or cooling.
  applyPolicyDemand(game, now, weatherShare);
  applyPeakDemand(
    game,
    now,
    prev.deferredResidential,
    TICK_MINUTES * tickScale,
  );
  const programs = game.policies?.programs;
  if ((programs?.thermal?.adoption ?? 0) > 0 || prev.deferredThermal?.length) {
    const thermal = shiftThermalDemand({
      minute: now.minute,
      residentialW: Math.max(
        0,
        now.demandByType.Residential - (now.shiftedResidentialW ?? 0),
      ),
      weatherShare: weatherShare,
      temperatureC: now.temperatureC,
      location: game.location,
      startingYear: game.startingYear,
      program: programs?.thermal ?? emptyPolicies().programs.thermal,
      deferred: prev.deferredThermal,
      stepMinutes: TICK_MINUTES * tickScale,
    });
    now.deferredThermalStart = (prev.deferredThermal ?? []).map((entry) => ({
      ...entry,
    }));
    now.deferredThermal = thermal.deferred;
    now.thermalShiftedW = thermal.shiftedW;
    now.thermalRecoveredW = thermal.recoveredW;
    now.demandByType.Residential =
      thermal.residentialW + (now.shiftedResidentialW ?? 0);
  }
  if (
    (programs?.evCharging?.adoption ?? 0) > 0 ||
    prev.deferredCharging?.length
  ) {
    const charging = shiftManagedCharging({
      minute: now.minute,
      transportationW: now.demandByType.Transportation,
      customers: programCustomers(game),
      year: date.year,
      location: game.location,
      enrollment:
        programs?.evCharging?.tier === "On"
          ? MANAGED_CHARGING.maxEnrollment * programs.evCharging.adoption
          : 0,
      startHour: policyStartHour(programs?.evCharging),
      deferred: prev.deferredCharging,
      stepMinutes: TICK_MINUTES * tickScale,
    });
    now.deferredChargingStart = (prev.deferredCharging ?? []).map((entry) => ({
      ...entry,
    }));
    now.deferredCharging = charging.deferred;
    now.evShiftedW = charging.shiftedW;
    now.evRecoveredW = charging.recoveredW;
    now.demandByType.Transportation = charging.transportationW;
  }
  now.customerBillingRate = customerBillingRate(
    game,
    now,
    customerBaseRateAt(game, date),
  );
  return DEMAND_TYPES.reduce(
    (total, type) => total + now.demandByType[type],
    0,
  );
}

function reforecastWeatherAndPrices(
  state: GameType,
  forecastWeather = false,
): TickPresentFutureType[] {
  const weatherAt = forecastWeather
    ? createWeatherForecast(state.date, state.seed, state.location.id)
    : (date: DateType) => getWeather(date, state.seed);
  // Resource forecasts are also shown before the player builds a hydro plant.
  const hasHydro =
    (getViableLocationCount(state.location, "Hydro") || 0) > 0 ||
    state.facilities.some((facility) => facility.fuel === "Hydro");
  const watershedId = state.location.watershedId || state.location.id;
  const watershedWeatherAt =
    forecastWeather && hasHydro
      ? createWeatherForecast(state.date, state.seed, watershedId)
      : undefined;
  const hydrologyByMonth = new Map<
    string,
    ReturnType<typeof getHydroConditions>
  >();
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      const weather = weatherAt(date);
      const effects = storyEffectsAt(date, state);
      const fuelPrices = getEffectiveFuelPrices(date, state, effects);
      const hydroKey = `${date.year}-${date.monthNumber}`;
      let hydrology = hydrologyByMonth.get(hydroKey);
      if (!hydrology) {
        hydrology = hasHydro
          ? getHydroConditions(
              date,
              state.seed,
              0,
              watershedId,
              watershedWeatherAt,
            )
          : {
              precipitationMm: 0,
              snowpackMm: 0,
              runoffMm: 0,
              rainMm: 0,
              meltMm: 0,
            };
        hydrologyByMonth.set(hydroKey, hydrology);
      }
      const forecast = {
        ...t,
        ...fuelPrices,
        solarIrradianceWM2: getRawSolarIrradianceWM2(
          date,
          state.location,
          weather.CLOUD_PCT,
        ),
        windKph: weather.WIND_KPH,
        windAirborneKph: getAirborneWindReferenceKph(weather.WIND_KPH),
        temperatureC: weather.TEMP_C + (effects.temperatureOffsetC || 0),
        storedWh: 0,
        precipitationMm: hydrology.precipitationMm,
        snowpackMm: hydrology.snowpackMm,
        hydroRunoffMm:
          hydrology.runoffMm * (effects.hydroRunoffMultiplier ?? 1),
        hydroReservoirWh: 0,
        hydroReservoirCapacityWh: 0,
        hydroSpillWh: 0,
        hydroMandatedReleaseW: 0,
        storageLossWh: 0,
        storageChargeW: 0,
        storageDischargeW: 0,
        supplyByFuel: {} as FuelProductionType,
      } as TickPresentFutureType;
      if (weather.WIND_OFFSHORE_KPH === undefined) {
        delete forecast.windOffshoreKph;
      } else {
        forecast.windOffshoreKph = weather.WIND_OFFSHORE_KPH;
      }
      return forecast;
    }
    return t;
  });
}

function reforecastDemand(
  state: GameType,
  tickScale = 1,
  initialDeferred: TickPresentFutureType["deferredResidential"] = [],
  initialThermal: TickPresentFutureType["deferredThermal"] = [],
  initialCharging: TickPresentFutureType["deferredCharging"] = [],
  representedTransportationW?: number,
  preserveCurrentFrame = false,
): TickPresentFutureType[] {
  const projection = {
    ...state,
    policies: cloneDeep(state.policies),
    utilityExpansion: cloneDeep(state.utilityExpansion),
  };
  let prev = {
    ...state.timeline[0],
    deferredResidential: initialDeferred,
    deferredThermal: initialThermal,
    deferredCharging: initialCharging,
  } as TickPresentFutureType;
  return state.timeline.map((t: TickPresentFutureType) => {
    if (
      t.minute >= state.date.minute &&
      !(preserveCurrentFrame && t.minute === state.date.minute)
    ) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      advanceGamePolicies(
        projection,
        date.monthsElapsed,
        representedTransportationW,
      );
      t = { ...t };
      t.expensesPolicy =
        (POLICY_IDS.reduce(
          (sum, id) => sum + (projection.policies?.programs[id].spending || 0),
          0,
        ) *
          tickScale) /
        TICKS_PER_MONTH;
      t.demandW = getDemandW(date, projection, prev, t, tickScale);
      prev = t;
      return t;
    }
    prev = t;
    return t;
  });
}

/**
 * How far a facility's non-fuel operating costs have escalated since it was bought. Its O&M,
 * variable O&M and start costs are quoted in purchase-month dollars; labour and parts rise with
 * inflation afterwards, just as fuel and the market's rate do.
 */
function operatingCostEscalation(
  state: GameType,
  facility: { costIndexAtBuild?: number },
  date: { year: number; monthNumber: number },
): number {
  return (
    getInflationIndex(date, state.startingYear, state.seed) /
    (facility.costIndexAtBuild || 1)
  );
}

/** Variable cost of holding one generator at its minimum output for one game tick. */
function minimumStableOperatingCost(
  state: GameType,
  generator: GeneratorOperatingType,
  tick: TickPresentFutureType,
  stepMinutes = TICK_MINUTES,
): number {
  // An installation outage cannot incur the variable cost of staying online.
  if (retrofitOutputMultiplier(generator, tick.minute) === 0) return 0;
  const ticksPerHour = 60 / stepMinutes;
  const minimumW = generator.peakW * (generator.minimumStableOutput || 0);
  const generatedWh = (minimumW / ticksPerHour) * GAME_TO_REAL_YEARS;
  const tickDate = getDateFromMinute(tick.minute, state.startingYear);
  const effects = storyEffectsAt(tickDate, state);
  const operatingCostMultiplier =
    effects.operatingCostMultipliersByFuel?.[generator.fuel] || 1;
  const variableOM =
    (generatedWh / 1000000) *
    (generator.variableOperatingCostPerMWh || 0) *
    operatingCostMultiplier *
    operatingCostEscalation(state, generator, tickDate);
  const fuel = FUELS[generator.fuel];
  if (!fuel) {
    return variableOM;
  }
  const fuelBtu =
    ((minimumW * (generator.btuPerWh || 0)) / ticksPerHour) *
    GAME_TO_REAL_YEARS;
  const fuelCost = (fuelBtu * (tick[generator.fuel] ?? 0)) / 1000000;
  const carbonCost =
    fuelBtu *
    feeableKgCO2ePerBtu(generator.fuel) *
    (effects.carbonFeePerKgCO2e ?? state.feePerKgCO2e);
  return variableOM + fuelCost + carbonCost;
}

function forecastIndexAt(state: GameType, minute: number): number {
  if (state.timeline.length === 0) {
    return 0;
  }
  const stepMinutes =
    state.timeline.length > 1
      ? state.timeline[1].minute - state.timeline[0].minute
      : TICK_MINUTES;
  return Math.max(
    0,
    Math.round((minute - state.timeline[0].minute) / stepMinutes),
  );
}

// Updates game state and now in place
function advanceGamePolicies(
  state: GameType,
  month: number,
  representedTransportationW?: number,
) {
  return advancePolicies(state, month, representedTransportationW);
}

function updateSupplyFacilitiesFinances(
  ...args: Parameters<typeof supplyFacilitiesFinancesPhases>
) {
  const phases = supplyFacilitiesFinancesPhases(...args);
  let result = phases.next();
  while (!result.done) result = phases.next();
  return result.value;
}

/** The gas-indexed co-op trade price for one grid's tick. */
export function basePeerTradePrice(tick: TickPresentFutureType): number {
  return Math.max(
    PEER_TRADE_MIN_PRICE_PER_MWH,
    PEER_TRADE_BASE_PRICE_PER_MWH +
      (tick["Natural Gas"] || 0) * PEER_TRADE_GAS_HEAT_RATE,
  );
}

/** The host sets one shared price per tick; a grid outside a match uses its own index. */
export function peerTradePrice(
  state: GameType,
  tick: TickPresentFutureType,
): number {
  return state.multiplayer?.pricePerMWh ?? basePeerTradePrice(tick);
}

function* supplyFacilitiesFinancesPhases(
  state: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
  simulated?: boolean,
  preRoll?: boolean,
  optimizeCommitment = true,
  stepMinutes = TICK_MINUTES,
  advanceConstruction = true,
): Generator<PeerPlan, TickPresentFutureType, PeerSettlement | undefined> {
  const { facilities } = state;
  const noElapsed =
    state.utilityExpansion && (preRoll || !advanceConstruction)
      ? {
          frame: { ...now },
          facilities: facilities.map((node) => ({
            node,
            value: cloneDeep(node),
          })),
          lines: (state.transmission?.lines ?? []).map((node) => ({
            node,
            value: cloneDeep(node),
          })),
          loans: state.utilityExpansion.loans.map((node) => ({
            node,
            value: { ...node },
          })),
          commissioned: [...state.commissionedHydroSiteIds],
        }
      : undefined;
  const tickScale = stepMinutes / TICK_MINUTES;
  const ticksPerHour = 60 / stepMinutes;
  const ticksPerMonth = TICKS_PER_MONTH / tickScale;
  const ticksPerYear = TICKS_PER_YEAR / tickScale;
  const tickDate = getDateFromMinute(now.minute, state.startingYear);
  // Reforecast passes receive a previously dispatched tick. Restore its native net load
  // before applying the customer fleet once against the preceding tick's stored energy.
  const oldBatteryDischarge = now.customerBatteryDischargeW ?? 0;
  if (oldBatteryDischarge > 0) {
    now.demandByType = {
      ...now.demandByType,
      Residential: now.demandByType.Residential + oldBatteryDischarge,
    };
    now.demandW += oldBatteryDischarge;
  }
  const batteryProgram = state.policies?.programs.battery;
  const batteryStartWh =
    prev.minute < now.minute
      ? (prev.customerBatteryWh ?? 0)
      : (now.customerBatteryWhStart ?? 0);
  const trackCustomerBattery =
    (batteryProgram?.adoption ?? 0) > 0 ||
    batteryStartWh > 0 ||
    oldBatteryDischarge > 0;
  const batteryFleet =
    batteryProgram && trackCustomerBattery
      ? customerBatteryFleet(
          batteryProgram,
          tickDate.monthsElapsed,
          state.startingYear,
          programCustomers(state),
          state.location,
        )
      : EMPTY_CUSTOMER_BATTERY_FLEET;
  const batteryEnabled = batteryProgram?.tier === "On";
  const batteryPeak = policyPeakHour(
    now.minute,
    policyStartHour(batteryProgram),
  );
  const batteryBefore = trackCustomerBattery
    ? dispatchCustomerBattery(batteryFleet, batteryStartWh, {
        deficitW: now.demandByType.Residential,
        stepMinutes,
        enabled: batteryEnabled,
        peak: batteryPeak,
      })
    : EMPTY_CUSTOMER_BATTERY_DISPATCH;
  if (trackCustomerBattery) {
    now.customerBatteryWhStart = batteryStartWh;
    now.customerBatteryDischargeW = batteryBefore.dischargeW;
    now.customerBatteryWh = batteryBefore.storedWh;
    now.customerBatteryLossWh = batteryBefore.lossWh;
  }
  if (batteryBefore.dischargeW > 0) {
    now.demandByType = {
      ...now.demandByType,
      Residential: now.demandByType.Residential - batteryBefore.dischargeW,
    };
    now.demandW -= batteryBefore.dischargeW;
  }
  const difficulty = DIFFICULTIES[state.difficulty];
  // Only a live co-op tick settles with peers. Forecasts and pre-rolls estimate peer supply as
  // zero, so they charge storage and value spare output like a single-player grid.
  const peerSettlement = !!state.multiplayer && !simulated;

  // Everything being built right now emits while it is being built, spread evenly across each
  // project's schedule. Derived from how far each clock actually moved rather than from elapsed
  // time: the decrements below are clamped at zero, so a project finishing mid-tick advances by
  // less than a full tick, and only the delta makes the lifetime total come out exact.
  // At rollover getTimeFromTimeline clamps both now and prev to the final frame. Keep that
  // frame's already-recorded construction charge when booking the boundary's additional work.
  let constructionKgco2e =
    !simulated && now === prev ? now.constructionKgco2e || 0 : 0;
  const accrueConstruction = (
    asset: ConstructionEmissions & { yearsToBuildLeft: number },
    yearsToBuild: number,
  ) => {
    const total = asset.constructionKgco2eTotal;
    if (!total || !(yearsToBuild > 0)) return;
    const complete = Math.min(
      1,
      Math.max(0, 1 - asset.yearsToBuildLeft / yearsToBuild),
    );
    // A month-boundary pre-roll moves the live build clock, but its frames are re-run and its
    // tick is not the one that gets recorded. Booking nothing here and leaving the marker alone
    // lets the next real tick charge for everything the clock moved, pre-roll included, so the
    // schedule is unchanged and the lifetime total still comes out exact.
    if (preRoll) return;
    const owed = total * complete - (asset.constructionKgco2eEmitted || 0);
    if (owed <= 0) return;
    // Charged against how far the build actually got rather than against elapsed time, which is
    // what makes the last partial tick land on the total instead of overshooting it.
    asset.constructionKgco2eEmitted =
      (asset.constructionKgco2eEmitted || 0) + owed;
    constructionKgco2e += owed;
  };

  // Update facility construction status
  facilities.forEach((f: FacilityOperatingType) => {
    if (advanceConstruction && f.yearsToBuildLeft > 0) {
      f.yearsToBuildLeft = Math.max(
        0,
        f.yearsToBuildLeft - YEARS_PER_TICK * tickScale,
      );
      if (f.yearsToBuildLeft === 0) {
        f.minuteOperational = now.minute;
        if (
          isConventionalHydro(f) &&
          f.hydroSiteId &&
          !state.commissionedHydroSiteIds.includes(f.hydroSiteId)
        )
          state.commissionedHydroSiteIds.push(f.hydroSiteId);
        if (!simulated && !state.multiplayer) {
          const message = `Construction complete: ${f.name}, ${f.peakWh ? formatWattHours(f.peakWh) : formatWatts(f.peakW)}`; // defining for functions running inside of setTimeout
          logGameEvent(state, "CONSTRUCTION", message);
          setTimeout(() => {
            getStore().dispatch(snackbarOpen(message));
          }, 0);
        }
      }
    }
  });

  // A facility can finish during pre-roll; its remaining emissions still belong to the next
  // recorded tick even though its construction clock has already reached zero.
  if (advanceConstruction) {
    facilities.forEach((facility) =>
      accrueConstruction(facility, facility.yearsToBuild),
    );
  }

  const transmission = state.transmission ?? emptyTransmissionState();
  transmission.lines.forEach((line) => {
    // Month-boundary pre-roll stabilizes generator output against the new weather frame. It is
    // not elapsed game time and must not quietly shorten an intertie's authored build schedule.
    if (!advanceConstruction || preRoll || line.yearsToBuildLeft <= 0) return;
    line.yearsToBuildLeft = Math.max(
      0,
      line.yearsToBuildLeft - YEARS_PER_TICK * tickScale,
    );
    accrueConstruction(line, corridorById(line.corridorId)?.yearsToBuild ?? 0);
    if (line.yearsToBuildLeft === 0 && !simulated) {
      logGameEvent(state, "CONSTRUCTION", `Intertie open: ${line.name}`);
    }
  });
  // Widening a line that is already open. Kept in its own pass rather than folded into the one
  // above, whose early return is for lines still being built: an upgrade only exists on a line
  // that finished long ago, and it must advance on exactly the same frames a build does.
  transmission.lines.forEach((line) => {
    const upgrade = line.upgrade;
    if (
      !advanceConstruction ||
      preRoll ||
      !upgrade ||
      upgrade.yearsToBuildLeft <= 0
    )
      return;
    upgrade.yearsToBuildLeft = Math.max(
      0,
      upgrade.yearsToBuildLeft - YEARS_PER_TICK * tickScale,
    );
    accrueConstruction(upgrade, upgrade.yearsToBuild);
    if (upgrade.yearsToBuildLeft > 0) return;
    // The new capacity arrives the day the work is signed off, not before.
    line.capacityW = upgrade.targetCapacityW;
    line.annualOperatingCost = upgrade.annualOperatingCost;
    delete line.upgrade;
    if (!simulated) {
      logGameEvent(
        state,
        "CONSTRUCTION",
        `Upgrade complete: ${line.name} now carries ${formatWatts(line.capacityW)}`,
      );
    }
  });

  const windOutputFactor = getWindOutputFactor(now.windKph);
  const offshoreWindOutputFactor = getOffshoreWindOutputFactor(
    now.windOffshoreKph || 0,
  );
  const airborneWindOutputFactor = getAirborneWindOutputFactor(
    now.windAirborneKph || 0,
  );
  const solarOutputFactor = getSolarOutputFactor(
    now.solarIrradianceWM2,
    now.temperatureC,
  );

  // Pre-check how much extra supply we'll need to charge batteries
  let indexOfLastUnchargedBattery = -1;
  let totalChargeNeeded = 0;
  const chargeRequests = new Map<number, number>();
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (
      !peerSettlement &&
      g.peakWh &&
      g.currentWh < g.peakWh &&
      g.yearsToBuildLeft === 0 &&
      !g.paused
    ) {
      indexOfLastUnchargedBattery = i;
      const requestedW = Math.min(
        g.peakW,
        ((g.peakWh - g.currentWh) * ticksPerHour) / g.roundTripEfficiency,
      );
      chargeRequests.set(g.id, requestedW);
      totalChargeNeeded += requestedW;
    }
  });

  // Update supply and facility outputs
  const entitlementOffers = entitlementSources(state, now);
  const entitlementCapacityW = entitlementOffers.reduce(
    (sum, offer) => sum + offer.capacityW,
    0,
  );
  let entitlementDeliveredW = Math.min(now.demandW, entitlementCapacityW);
  let supply = entitlementDeliveredW;
  let spareGenerationW = 0;
  let reachableHeadroomW = 0;
  const supplyByFuel: FuelProductionType = {};
  let charge = 0;
  let dischargedW = 0;
  let storedWh = 0;
  let storageLossWh = 0;
  let hydroReservoirWh = 0;
  let hydroReservoirCapacityWh = 0;
  let hydroSpillWh = 0;
  let hydroMandatedReleaseW = 0;
  const peerHeadroom: { generator: GeneratorOperatingType; watts: number }[] =
    [];
  const startedFacilityIds = new Set<number>();
  const tickStoryEffects = storyEffectsAt(tickDate, state);
  if (tickStoryEffects.transmissionCapacityLimitsWByCorridor)
    now.transmissionCapacityLimitsWByCorridor =
      tickStoryEffects.transmissionCapacityLimitsWByCorridor;
  else delete now.transmissionCapacityLimitsWByCorridor;
  const carbonFee = tickStoryEffects.carbonFeePerKgCO2e ?? state.feePerKgCO2e;
  // Read once per tick, and only when a live co-op grid prices its spare output.
  let peerTickFuelPrices: FuelPricesType | undefined;
  const peerFuelPrices = () =>
    (peerTickFuelPrices ??= getEffectiveFuelPrices(
      tickDate,
      state,
      tickStoryEffects,
    ));
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    const previousW = g.currentW;
    // Commitment is only read or written behind hasMinimumStableOutput, which storage never has
    const generator = isStorage(g) ? undefined : g;
    const hasMinimumStableOutput =
      generator !== undefined && (generator.minimumStableOutput || 0) > 0;
    const previouslyCommitted = simulated
      ? (generator?.committed ?? previousW > 0)
      : (generator?.generatingLastRealTick ??
        generator?.committed ??
        previousW > 0);
    // A retrofit holds the plant offline until it completes.
    const availablePeakW =
      g.peakW *
      retrofitOutputMultiplier(g, now.minute) *
      storyOutputMultiplier(g, tickStoryEffects, now.minute);
    let dispatchPeakW = availablePeakW;
    const outputFactor = facilityOutputFactor(g, now.minute);
    let mandatedW = 0;
    const hydro = g.fuel === "Hydro" && !!g.reservoirCapacityWh;
    const storage = isStorage(g) && g.yearsToBuildLeft === 0;
    if (hydro && g.yearsToBuildLeft === 0) {
      const capacityWh = g.reservoirCapacityWh || 0;
      const inflowWh =
        ((g.hydroWhPerMm || 0) * now.hydroRunoffMm) / ticksPerMonth;
      const beforeSpill = (g.reservoirWh ?? capacityWh / 2) + inflowWh;
      const spillWh = Math.max(0, beforeSpill - capacityWh);
      g.reservoirWh = Math.min(capacityWh, beforeSpill);
      g.hydroLastInflowWh = inflowWh;
      g.hydroLastSpillWh = spillWh;
      hydroSpillWh += spillWh;

      const requiredReleaseWh = Math.min(
        g.reservoirWh,
        ((g.hydroMeanMonthlyInflowWh || 0) *
          mandatedReleaseFraction(
            tickDate.monthNumber,
            state.location?.lat ?? 1,
          )) /
          ticksPerMonth,
      );
      const deadpoolWh = capacityWh * HYDRO_DEADPOOL_FRACTION;
      const turbineWaterWh = Math.max(0, g.reservoirWh - deadpoolWh);
      if (!g.paused && turbineWaterWh > 0) {
        const turbineMandatedWh = Math.min(requiredReleaseWh, turbineWaterWh);
        const bypassWh = requiredReleaseWh - turbineMandatedWh;
        g.reservoirWh = Math.max(0, g.reservoirWh - bypassWh);
        mandatedW = Math.min(
          availablePeakW,
          (turbineMandatedWh * ticksPerHour) / GAME_TO_REAL_YEARS,
        );
        dispatchPeakW = Math.min(
          availablePeakW,
          (turbineWaterWh * ticksPerHour) / GAME_TO_REAL_YEARS,
        );
        g.hydroLastMandatedReleaseWh = requiredReleaseWh;
        g.hydroLastBypassWh = bypassWh;
      } else {
        // Water rights remain binding while a plant is paused or below minimum power pool; the
        // release bypasses the turbine and earns no electricity.
        dispatchPeakW = 0;
        g.reservoirWh = Math.max(0, g.reservoirWh - requiredReleaseWh);
        g.hydroLastMandatedReleaseWh = requiredReleaseWh;
        g.hydroLastBypassWh = requiredReleaseWh;
      }
    }
    if (storage) {
      // Storage leaks even while paused: pausing controls grid dispatch, not battery
      // self-discharge or water evaporating from a pumped-hydro upper reservoir.
      const lossWh =
        g.currentWh * (1 - pow(1 - g.hourlyLoss, 1 / ticksPerHour));
      g.currentWh = Math.max(0, g.currentWh - lossWh);
      storageLossWh += lossWh;
    }
    if (g.paused) {
      if (!optimizeCommitment) {
        recordDispatchTarget(now, g.id, 0);
      }
      if (hasMinimumStableOutput) {
        generator.committed = false;
      }
      g.currentW = Math.max(
        0,
        g.currentW - (g.peakW * stepMinutes) / g.spinMinutes,
      ); // ramp down
      if (storage) {
        storedWh += g.currentWh;
      }
      if (hydro && g.yearsToBuildLeft === 0) {
        hydroReservoirWh += g.reservoirWh || 0;
        hydroReservoirCapacityWh += g.reservoirCapacityWh || 0;
      }
      if (!simulated && g.tracksStarts) {
        g.generatingLastRealTick = hasMinimumStableOutput
          ? !!generator.committed
          : g.currentW > 0;
      }
      return;
    }
    if (g.yearsToBuildLeft === 0) {
      if (g.fuel) {
        // Capable of generating electricity
        const targetW = Math.max(0, now.demandW - (supply - charge));
        const requiredTargetW = Math.max(targetW, mandatedW);
        switch (g.fuel) {
          case "Sun":
            // Trackers raise morning and evening output; the array still clips at nameplate.
            g.currentW =
              availablePeakW *
              outputFactor *
              Math.min(
                1,
                solarOutputFactor *
                  trackerOutputMultiplier(g, tickDate.minuteOfDay),
              );
            break;
          case "Wind":
            g.currentW = availablePeakW * outputFactor * windOutputFactor;
            break;
          case "Offshore Wind":
            g.currentW = availablePeakW * offshoreWindOutputFactor;
            break;
          case "Airborne Wind":
            g.currentW = availablePeakW * airborneWindOutputFactor;
            break;
          default: // Produce what customers and storage need; spare capacity is not energy.
            // If there's a battery after this plant, the dispatch request includes the extra
            // output the existing storage policy would use to charge it beyond current demand.
            const dispatchTargetW = Math.min(
              dispatchPeakW,
              indexOfLastUnchargedBattery >= 0 &&
                i < indexOfLastUnchargedBattery
                ? Math.max(
                    mandatedW,
                    now.demandW + totalChargeNeeded - (supply - charge),
                  )
                : requiredTargetW,
            );
            if (!optimizeCommitment) {
              recordDispatchTarget(now, g.id, dispatchTargetW);
            }

            let committedTargetW = dispatchTargetW;
            if (hasMinimumStableOutput) {
              if (dispatchTargetW > 0) {
                generator.committed = true;
              } else if (generator.committed) {
                const keepOnline =
                  !optimizeCommitment ||
                  shouldKeepGeneratorCommitted({
                    facilityId: g.id,
                    forecast: state.timeline,
                    fromIndex: forecastIndexAt(state, now.minute),
                    startCost:
                      (generator.costPerStart || 0) *
                      GAME_TO_REAL_YEARS *
                      operatingCostEscalation(state, generator, tickDate) *
                      (tickStoryEffects.operatingCostMultipliersByFuel?.[
                        generator.fuel
                      ] || 1),
                    minimumOperatingCost: (futureTick) =>
                      minimumStableOperatingCost(
                        state,
                        generator,
                        futureTick,
                        stepMinutes,
                      ),
                  });
                generator.committed = keepOnline;
              }
              committedTargetW = generator.committed
                ? Math.max(
                    dispatchTargetW,
                    Math.min(
                      dispatchPeakW,
                      g.peakW * (generator.minimumStableOutput || 0),
                    ),
                  )
                : 0;
            }

            const rampW = (g.peakW * stepMinutes) / g.spinMinutes;
            g.currentW = Math.min(
              dispatchPeakW,
              committedTargetW > g.currentW
                ? Math.min(committedTargetW, g.currentW + rampW)
                : Math.max(committedTargetW, g.currentW - rampW),
            );
            // Setup can show surplus capacity even when dispatch follows demand. Hydro stays
            // at its dispatched output so stored water is not counted repeatedly as energy.
            if (!hydro) {
              spareGenerationW += Math.max(0, dispatchPeakW - g.currentW);
            }
            break;
        }
        if (
          peerSettlement &&
          !hydro &&
          !WEATHER_DEPENDENT_FUELS.includes(g.fuel) &&
          g.currentW > 0 &&
          (hasMinimumStableOutput ? generator?.committed : true)
        ) {
          const cost =
            (g.variableOperatingCostPerMWh || 0) *
              operatingCostEscalation(state, g, tickDate) *
              (tickStoryEffects.operatingCostMultipliersByFuel?.[g.fuel] || 1) +
            (g.btuPerWh || 0) *
              ((peerFuelPrices()[g.fuel] || 0) +
                feeableKgCO2ePerBtu(g.fuel) * carbonFee * 1e6);
          if (cost <= peerTradePrice(state, now))
            peerHeadroom.push({
              generator: g,
              watts: Math.max(
                0,
                Math.min(
                  dispatchPeakW,
                  previousW + (g.peakW * stepMinutes) / g.spinMinutes,
                ) - g.currentW,
              ),
            });
        }
        supply += g.currentW;
        supplyByFuel[g.fuel] = (supplyByFuel[g.fuel] || 0) + g.currentW;
        if (hydro) {
          const generatedWh = (g.currentW / ticksPerHour) * GAME_TO_REAL_YEARS;
          g.reservoirWh = Math.max(0, (g.reservoirWh || 0) - generatedWh);
          hydroMandatedReleaseW += Math.min(g.currentW, mandatedW);
        }
        if (
          g.tracksStarts &&
          !preRoll &&
          !previouslyCommitted &&
          (hasMinimumStableOutput ? generator.committed : g.currentW > 0)
        ) {
          startedFacilityIds.add(g.id);
        }
        if (!simulated && g.tracksStarts) {
          g.generatingLastRealTick = hasMinimumStableOutput
            ? !!generator.committed
            : g.currentW > 0;
        }
      }
      if (g.peakWh) {
        // Capable of storing electricity
        const targetW = Math.max(0, now.demandW - (supply - charge));
        if (g.currentWh > 0 && targetW > 0) {
          // If there's a need and we have charge, discharge
          g.currentW = Math.min(
            availablePeakW,
            targetW,
            g.currentWh * ticksPerHour,
          );
          g.currentWh = Math.max(0, g.currentWh - g.currentW / ticksPerHour);
          supply += g.currentW;
          dischargedW += g.currentW;
        } else if (
          !peerSettlement &&
          g.currentWh < g.peakWh &&
          supply - charge > now.demandW
        ) {
          // The grid draw is capped before conversion losses. All round-trip losses are
          // applied on charging, so discharge can use the stored energy directly.
          const gridChargeW = Math.min(
            g.peakW,
            supply - now.demandW - charge,
            ((g.peakWh - g.currentWh) * ticksPerHour) / g.roundTripEfficiency,
          );
          g.currentW = -gridChargeW * g.roundTripEfficiency;
          g.currentWh = Math.min(
            g.peakWh,
            g.currentWh - g.currentW / ticksPerHour,
          );
          charge += gridChargeW;
          storageLossWh += (gridChargeW + g.currentW) / ticksPerHour;
        } else {
          // Otherwise, don't charge or discharge: reset to 0
          g.currentW = 0;
        }
        totalChargeNeeded -= chargeRequests.get(g.id) || 0;
        storedWh += g.currentWh;
      }
      // Report capacity that automatic dispatch can actually add within the next 15 minutes.
      // Keep this response window fixed even when long forecasts integrate hourly samples.
      // Ramping, weather/event derates and remaining water/charge constrain that headroom.
      if (isStorage(g)) {
        const dischargeW = Math.min(
          availablePeakW,
          g.currentWh * TICKS_PER_HOUR,
        );
        const currentGridW =
          g.currentW < 0 ? g.currentW / g.roundTripEfficiency : g.currentW;
        reachableHeadroomW += Math.max(0, dischargeW - currentGridW);
      } else if (!WEATHER_DEPENDENT_FUELS.includes(g.fuel)) {
        const energyLimitedPeakW = hydro
          ? Math.min(
              availablePeakW,
              (Math.max(
                0,
                (g.reservoirWh || 0) -
                  (g.reservoirCapacityWh || 0) * HYDRO_DEADPOOL_FRACTION,
              ) *
                TICKS_PER_HOUR) /
                GAME_TO_REAL_YEARS,
            )
          : availablePeakW;
        reachableHeadroomW += Math.max(
          0,
          Math.min(
            energyLimitedPeakW - g.currentW,
            (g.peakW * TICK_MINUTES) / g.spinMinutes,
          ),
        );
      }
      if (hydro) {
        hydroReservoirWh += g.reservoirWh || 0;
        hydroReservoirCapacityWh += g.reservoirCapacityWh || 0;
      }
    }
  });
  // Weather generation serves load first; never buy an entitlement merely to export it.
  const redundantEntitlementW = Math.min(
    entitlementDeliveredW,
    Math.max(0, supply - now.demandW),
  );
  entitlementDeliveredW -= redundantEntitlementW;
  supply -= redundantEntitlementW;
  let peer: PeerSettlement | undefined;
  if (peerSettlement) {
    const reserveW = now.demandW * PEER_TRADE_RESERVE_FRACTION;
    const intensity = (g: GeneratorOperatingType) =>
      (g.btuPerWh || 0) * (FUELS[g.fuel]?.kgCO2ePerBtu || 0) * 1e6;
    peer = yield {
      offerW:
        Math.max(0, supply - now.demandW - reserveW) +
        Math.max(
          0,
          peerHeadroom.reduce((sum, item) => sum + item.watts, 0) -
            Math.max(0, now.demandW + reserveW - supply),
        ),
      shortageW: Math.max(0, now.demandW - supply),
      pricePerMWh: peerTradePrice(state, now),
      temperatureC: now.temperatureC,
      solarIrradianceWM2: now.solarIrradianceWM2,
      emissionsAt: (exportedW) => {
        if (state.utilityExpansion) {
          const surplusW = Math.min(
            exportedW,
            Math.max(0, supply - now.demandW - reserveW),
          );
          const nativeSupplyW = supply - entitlementDeliveredW;
          const nativeWeight = facilities.reduce(
            (sum, facility) =>
              sum +
              (isStorage(facility) || facility.paused
                ? 0
                : facility.currentW * intensity(facility)),
            0,
          );
          let weighted =
            nativeSupplyW > 0 ? (surplusW * nativeWeight) / nativeSupplyW : 0;
          let extraW = Math.max(0, exportedW - surplusW);
          for (const item of peerHeadroom) {
            const deliveredW = Math.min(item.watts, extraW);
            extraW -= deliveredW;
            weighted += deliveredW * intensity(item.generator);
          }
          return exportedW > 0 ? weighted / exportedW : 0;
        }
        let watts = entitlementDeliveredW,
          weighted = 0;
        let boughtW = entitlementDeliveredW;
        for (const source of entitlementOffers) {
          const amount = Math.min(boughtW, source.capacityW);
          boughtW -= amount;
          weighted += amount * source.emissionsKgPerMWh;
        }
        for (const g of facilities) {
          if (isStorage(g) || g.paused) continue;
          watts += g.currentW;
          weighted += g.currentW * intensity(g);
        }
        let extra = Math.max(0, exportedW - Math.max(0, supply - now.demandW));
        let additionalBoughtW = Math.min(
          extra,
          entitlementCapacityW - entitlementDeliveredW,
        );
        extra -= additionalBoughtW;
        let alreadyUsedW = entitlementDeliveredW;
        for (const source of entitlementOffers) {
          const used = Math.min(alreadyUsedW, source.capacityW);
          alreadyUsedW -= used;
          const amount = Math.min(additionalBoughtW, source.capacityW - used);
          additionalBoughtW -= amount;
          watts += amount;
          weighted += amount * source.emissionsKgPerMWh;
        }
        for (const item of peerHeadroom) {
          const delivered = Math.min(item.watts, extra);
          watts += delivered;
          weighted += delivered * intensity(item.generator);
          extra -= delivered;
        }
        return watts > 0 ? weighted / watts : 0;
      },
    };
    let extra = Math.max(
      0,
      (peer?.exportedW || 0) - Math.max(0, supply - now.demandW),
    );
    for (const { generator, watts } of peerHeadroom) {
      const delivered = Math.min(watts, extra);
      generator.currentW += delivered;
      supply += delivered;
      supplyByFuel[generator.fuel] =
        (supplyByFuel[generator.fuel] || 0) + delivered;
      spareGenerationW -= delivered;
      reachableHeadroomW = Math.max(0, reachableHeadroomW - delivered);
      extra -= delivered;
    }
    supply += (peer?.importedW || 0) - (peer?.exportedW || 0);
    let leftovers = Math.max(0, supply - now.demandW - (peer?.importedW || 0));
    for (const battery of facilities) {
      if (
        !isStorage(battery) ||
        battery.paused ||
        battery.yearsToBuildLeft > 0 ||
        battery.currentW > 0
      )
        continue;
      const draw = Math.min(
        leftovers,
        battery.peakW,
        ((battery.peakWh - battery.currentWh) * ticksPerHour) /
          battery.roundTripEfficiency,
      );
      battery.currentW = -draw * battery.roundTripEfficiency;
      battery.currentWh += (draw * battery.roundTripEfficiency) / ticksPerHour;
      storedWh += (draw * battery.roundTripEfficiency) / ticksPerHour;
      charge += draw;
      storageLossWh +=
        (draw * (1 - battery.roundTripEfficiency)) / ticksPerHour;
      leftovers -= draw;
    }
  }
  transmission.lines.forEach((line) => {
    if (ownedUtilityConnection(state, line.corridorId)) line.currentFlowW = 0;
  });
  const operatingLines = transmission.lines.filter(
    ({ yearsToBuildLeft, corridorId }) =>
      yearsToBuildLeft <= 0 &&
      !isPeerCorridorId(corridorId) &&
      !ownedUtilityConnection(state, corridorId),
  );
  const intertieContext = intertieContextForGame(state);
  const tradingYear = intertieYear(now.minute, state.startingYear);
  let transmissionCapacity = 0;
  let marketImportLimitW = 0;
  let marketExportLimitW = 0;
  const offers: (IntertieOffer & { emissionsKgco2ePerMWh: number })[] = [];
  for (const line of operatingLines) {
    const rating = transmissionRatingW(line, now);
    const limits = intertieOfferLimits(line, intertieContext, now.minute, now);
    const pricePerMWh = adjacentMarketPricePerMWh(
      line.corridorId,
      intertieContext,
      now.minute,
      now,
    );
    transmissionCapacity += rating;
    offers.push({
      ...limits,
      pricePerMWh,
      emissionsKgco2ePerMWh: limits.marketId
        ? importEmissionsKgco2ePerMWh(limits.marketId, tradingYear)
        : 0,
    });
  }
  marketImportLimitW = allocateIntertieFlows(
    offers,
    Infinity,
    0,
  ).importedW.reduce((sum, w) => sum + w, 0);
  marketExportLimitW = allocateIntertieFlows(
    offers,
    0,
    Infinity,
  ).exportedW.reduce((sum, w) => sum + w, 0);
  // Export already-produced surplus; unused dispatchable capacity remains ready without
  // burning fuel or pretending that a reserve is electricity supplied to customers.
  const batteryAfter = trackCustomerBattery
    ? dispatchCustomerBattery(batteryFleet, batteryBefore.storedWh, {
        rooftopSurplusW: now.rooftopSurplusW ?? 0,
        gridSurplusW: Math.max(
          0,
          supply - charge - now.demandW - (peer?.importedW ?? 0),
        ),
        stepMinutes,
        enabled: batteryEnabled && batteryBefore.dischargeW === 0,
        peak: batteryPeak,
      })
    : EMPTY_CUSTOMER_BATTERY_DISPATCH;
  if (trackCustomerBattery) {
    now.customerBatteryWh = batteryAfter.storedWh;
    now.customerBatteryChargeW = batteryAfter.chargeW;
    now.customerBatteryGridChargeW = batteryAfter.gridChargeW;
    now.customerBatteryLossWh = batteryBefore.lossWh + batteryAfter.lossWh;
  }
  const grossLocalSupplyW =
    supply - (peer?.importedW || 0) + (peer?.exportedW || 0);
  const localSupplyW = supply - charge - batteryAfter.gridChargeW;
  const clearing = clearTransmissionMarket({
    // Contract/load arithmetic may leave a few ULPs at the served-load boundary.
    localSupplyW: state.utilityExpansion
      ? supplyAtDemandBoundary(localSupplyW, now.demandW)
      : localSupplyW,
    demandW: now.demandW,
    capacityW: transmissionCapacity,
    importLimitW: marketImportLimitW,
    exportLimitW: marketExportLimitW,
    policy: transmission.tradingPolicy,
  });
  const importedW =
    clearing.importedW + (peer?.importedW || 0) + entitlementDeliveredW;
  const exportedW = clearing.exportedW + (peer?.exportedW || 0);
  // The player gives earlier interties the first chance to import or export.
  const flows = allocateIntertieFlows(
    offers,
    clearing.importedW,
    clearing.exportedW,
  );
  // Keep the row readings aligned with the aggregate flow written to this tick, including
  // month-boundary pre-rolls: those replace the live current tick with the new weather frame.
  // Forecasts dispatch cloned lines; only their current-tick readings are copied back below.
  operatingLines.forEach((line, index) => {
    line.currentFlowW = flows.importedW[index] - flows.exportedW[index];
  });
  let importCostPerHour = 0;
  let exportRevenuePerHour = 0;
  let importEmissionsWeight = 0;
  let importEmissionsBasisW = 0;
  offers.forEach((offer, index) => {
    importCostPerHour += flows.importedW[index] * offer.pricePerMWh;
    exportRevenuePerHour += flows.exportedW[index] * offer.pricePerMWh;
    // Actual imports carry their own mix; with none flowing, show the mix that would arrive.
    const basisW = importedW > 0 ? flows.importedW[index] : offer.importLimitW;
    importEmissionsWeight += basisW * offer.emissionsKgco2ePerMWh;
    importEmissionsBasisW += basisW;
  });
  importCostPerHour += (peer?.importedW || 0) * peerTradePrice(state, now);
  exportRevenuePerHour += (peer?.exportedW || 0) * peerTradePrice(state, now);
  let entitlementLeftW = entitlementDeliveredW;
  for (const offer of entitlementOffers) {
    const delivered = Math.min(entitlementLeftW, offer.capacityW);
    entitlementLeftW -= delivered;
    importCostPerHour += delivered * offer.pricePerMWh;
    importEmissionsWeight += delivered * offer.emissionsKgPerMWh;
    importEmissionsBasisW += delivered;
  }
  importEmissionsWeight +=
    (peer?.importedW || 0) * (peer?.importEmissionsKgPerMWh || 0);
  importEmissionsBasisW += peer?.importedW || 0;
  const flowW = importedW + exportedW;
  const marketPricePerMWh =
    flowW > 0
      ? (importCostPerHour + exportRevenuePerHour) / flowW
      : transmissionCapacity > 0
        ? offers.reduce((sum, offer) => sum + offer.pricePerMWh, 0) /
          offers.length
        : 0;
  supply = clearing.localAvailableSupplyW;
  if (state.utilityExpansion) {
    now.entitlementImportedW = entitlementDeliveredW;
    now.entitlementImportCapacityW = entitlementCapacityW;
  }
  now.importedW = importedW;
  now.exportedW = exportedW;
  now.transmissionCapacityW = transmissionCapacity;
  now.marketPricePerMWh = marketPricePerMWh;
  now.supplyW = supply;
  // Exported surplus remains available to redirect to local demand in the setup outlook.
  now.availableSupplyW =
    supply +
    spareGenerationW +
    exportedW +
    entitlementCapacityW -
    entitlementDeliveredW;
  // Surplus exports are interruptible under the game policy and can be redirected locally.
  now.reserveW =
    supply -
    now.demandW +
    reachableHeadroomW +
    exportedW +
    entitlementCapacityW -
    entitlementDeliveredW;
  now.importKgco2ePerMWh =
    importEmissionsBasisW > 0
      ? importEmissionsWeight / importEmissionsBasisW
      : 0;

  now.supplyByFuel = supplyByFuel;
  now.storedWh = storedWh;
  now.storageLossWh = storageLossWh;
  now.storageChargeW = charge;
  now.storageDischargeW = dischargedW;
  now.hydroReservoirWh = hydroReservoirWh;
  now.hydroReservoirCapacityWh = hydroReservoirCapacityWh;
  now.hydroSpillWh = hydroSpillWh;
  now.hydroMandatedReleaseW = hydroMandatedReleaseW;

  // Update finances
  const supplyWh =
    (Math.min(now.supplyW, now.demandW) / ticksPerHour) * GAME_TO_REAL_YEARS;
  // Scale the representative simulated day to the real month it stands for.
  const demandWh = (now.demandW / ticksPerHour) * GAME_TO_REAL_YEARS;
  // Re-read the base rate for live slider edits; demand forecasts may have been
  // generated before that edit. Forecast passes advance their own policy copy.
  now.customerBillingRate = customerBillingRate(
    state,
    now,
    customerBaseRateAt(state, tickDate),
  );
  const customerRevenue =
    (supplyWh / 1000) * (now.customerBillingRate ?? state.dollarsPerkWh);
  const importedWh = (importedW / ticksPerHour) * GAME_TO_REAL_YEARS;
  const exportedWh = (exportedW / ticksPerHour) * GAME_TO_REAL_YEARS;
  const expensesImports =
    importedW > 0
      ? (importedWh / 1000000) * (importCostPerHour / importedW)
      : 0;
  const revenueExports =
    exportedW > 0
      ? (exportedWh / 1000000) * (exportRevenuePerHour / exportedW)
      : 0;
  // Immediate choice and retrofit transactions belong to the frame of the tick they were made
  // in. At a month's last tick the clock clamps prev and now to the same final frame, whose cash
  // already carries them, so that pass still reports them in the frame's revenue and expenses but
  // leaves them out of its cash delta. A current-tick re-forecast passes a copied frame and
  // re-adds each exactly once.
  const rebookingFrame = prev === now;
  const bookedThisFrame = (event: ActiveWorldEventType) =>
    event.startsMinute === now.minute;
  // Forecast payments are virtual receipts through this same transaction owner. Live state
  // only receives a receipt when updateWorldEvents activates the event at its owning boundary.
  const rules = scenarioRules(
    getScenario(state.scenarioId, state.customScenario),
    state,
  );
  const futureContext =
    rules &&
    now.minute > state.date.minute &&
    now.minute % MINUTES_PER_MONTH === 0
      ? storyContextAt(state, tickDate)
      : undefined;
  const futureReceipts =
    rules &&
    !state.storyEffectsDisabled &&
    now.minute > state.date.minute &&
    now.minute % MINUTES_PER_MONTH === 0
      ? [
          ...resolveStoryAtDate(futureContext!).occurrences,
          ...futureContext!.occurrences.filter(
            (event) =>
              event.attributes.ruleChoice === true &&
              event.attributes.automatic === true &&
              event.startsMinute === now.minute,
          ),
        ].filter(
          (event) =>
            (event.attributes.ruleEvent === true ||
              event.attributes.ruleChoice === true) &&
            event.forecastable !== false &&
            !state.worldEvents.occurrences.some(
              (recorded) => recorded.key === event.key,
            ),
        )
      : [];
  const transactionOccurrences = futureReceipts.length
    ? [...state.worldEvents.occurrences, ...futureReceipts]
    : state.worldEvents.occurrences;
  const choiceGrant = transactionOccurrences
    .filter(
      (event) =>
        (event.attributes.scenarioChoice === true ||
          event.attributes.ruleEvent === true) &&
        bookedThisFrame(event),
    )
    .reduce(
      (total, event) => total + Number(event.attributes.upfrontGrant || 0),
      0,
    );
  const immediateCosts = transactionOccurrences
    .filter(
      (event) =>
        (event.attributes.scenarioChoice === true ||
          event.attributes.ruleEvent === true ||
          event.attributes.retrofit === true) &&
        bookedThisFrame(event),
    )
    .reduce((total, event) => total + Number(event.attributes.cost || 0), 0);
  const revenue =
    customerRevenue + revenueExports + (rebookingFrame ? 0 : choiceGrant);

  // Facilities expenses
  let kgco2e = 0;
  // The part of kgco2e the carbon fee is charged on: biogenic combustion is exempt
  let feeableKgco2e = 0;
  // Some authored emergencies carry company-level response costs that do not belong to a single
  // plant, such as field crews and rebuilding damaged distribution equipment.
  let expensesOM =
    (tickStoryEffects.operatingExpensePerMonth || 0) / ticksPerMonth;
  if (!rebookingFrame) expensesOM += immediateCosts;
  // Hail repair costs fall due one tick after onset, in the window (prev, now]. The pre-roll
  // frames and a forecast's first frame share prev and now minutes, so they never charge one.
  const hazardOneTimeCosts = state.worldEvents.active.filter(
    (event) => typeof event.attributes.oneTimeCost === "number",
  );
  expensesOM += oneTimeWorldEventCost(hazardOneTimeCosts, prev, now);
  let expensesFuel = 0;
  let expensesInterest = 0;
  let principalRepayment = 0;
  // Hoisted out of the loop below, the way the demand pass at the top of this file already does
  // it: prices move by the month, and this is per facility per tick
  // At rollover the live clock has advanced beyond the timeline and rebooks its last frame
  // using the closing clock's price. Preserve that accounting while pricing future samples
  // at their own month, rather than the forecast's starting month.
  const fuelDate = now.minute < state.date.minute ? state.date : tickDate;
  const fuelPrices = getEffectiveFuelPrices(
    fuelDate,
    state,
    fuelDate.minute === now.minute ? tickStoryEffects : undefined,
  );
  // Attribute sales proportionally to gross local output and imports. Using net supply
  // after charging or exports would credit local facilities with more than the company earned.
  // The imported share remains outside local facility lifetime revenue.
  const revenueBasisW = grossLocalSupplyW + importedW;
  const revenuePerSuppliedW =
    revenueBasisW > 0 ? (customerRevenue + revenueExports) / revenueBasisW : 0;
  // Non-fuel operating costs were quoted in each facility's purchase-month dollars and escalate
  // with inflation from there (see operatingCostEscalation)
  const costIndexNow = getInflationIndex(
    tickDate,
    state.startingYear,
    state.seed,
  );
  facilities.forEach((g: FacilityOperatingType) => {
    // Everything this facility costs the company this tick, so it can be booked against the
    // facility as well as into the company's own totals below
    let facilityExpenses = 0;
    if (g.yearsToBuildLeft === 0) {
      // Output-dependent costs use the same representative-month scaling as fuel and lifetime
      // generation. A paused plant may still be ramping down internally, but it produces and
      // incurs no variable O&M while it is disconnected from dispatch.
      const deliveredW = g.paused ? 0 : Math.max(0, g.currentW);
      const generatedWh = (deliveredW / ticksPerHour) * GAME_TO_REAL_YEARS;
      let facilityOM = 0;
      if (g.paused) {
        // paused facilities only pay half of their operating costs
        facilityOM += g.annualOperatingCost / ticksPerYear / 2;
      } else {
        facilityOM += g.annualOperatingCost / ticksPerYear;
      }
      facilityOM +=
        (generatedWh / 1000000) * (g.variableOperatingCostPerMWh || 0);
      const started = startedFacilityIds.has(g.id);
      if (started) {
        // One simulated day stands for the average month. The visible off-to-on edge therefore
        // represents the same daily start repeated throughout that month.
        facilityOM += (g.costPerStart || 0) * GAME_TO_REAL_YEARS;
      }
      facilityOM *=
        ((g.fuel &&
          tickStoryEffects.operatingCostMultipliersByFuel?.[g.fuel]) ||
          1) *
        (costIndexNow / (g.costIndexAtBuild || 1));
      facilityExpenses += facilityOM;
      expensesOM += facilityOM;
      const fuel = g.fuel && FUELS[g.fuel];
      if (fuel) {
        // Burned for delivered output only: a paused plant still winding down internally sells
        // nothing, so it buys no fuel and emits nothing, like its variable O&M above.
        const fuelBtu =
          ((deliveredW * (g.btuPerWh || 0)) / ticksPerHour) *
          GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
        // Hydro and geothermal carry a zero-emission FUELS entry so carbon accounting can name
        // them, but they do not buy a fuel and therefore have no entry in the price table. In
        // JavaScript even zero times undefined is NaN; the first operating tick after construction
        // used to feed that through expenses into cash, where saving or charting exposed it as
        // null. An unpriced resource costs zero here, matching generatorCostPerMWh above.
        const facilityFuel = (fuelBtu * (fuelPrices[g.fuel] ?? 0)) / 1000000;
        const facilityKgco2e = fuelBtu * fuel.kgCO2ePerBtu;
        const facilityFeeableKgco2e = fuelBtu * feeableKgCO2ePerBtu(g.fuel);
        expensesFuel += facilityFuel;
        kgco2e += facilityKgco2e;
        feeableKgco2e += facilityFeeableKgco2e;
        facilityExpenses += facilityFuel + carbonFee * facilityFeeableKgco2e;
      }
      if (g.loanAmountLeft > 0) {
        const paymentInterest = getPaymentInterest(
          g.loanAmountLeft,
          g.interestRate,
        );
        // Never more principal than is actually outstanding. The last payment of a loan is a
        // whole tick's worth against whatever fraction of it is left, so without the floor the
        // balance settles a few dollars below zero and stays there for the rest of the run --
        // which reads as the lender owing the player money, counts towards net worth, and trips
        // the loan invariant on every tick from then on
        const paymentPrincipal = Math.min(
          (g.loanMonthlyPayment - paymentInterest) / ticksPerMonth,
          g.loanAmountLeft,
        );
        expensesInterest += paymentInterest / ticksPerMonth;
        principalRepayment += paymentPrincipal;
        g.loanAmountLeft -= paymentPrincipal;
        // The last payment of a loan is the only interesting one, and nothing else on screen
        // marks it: the interest line simply stops going down
        if (!simulated && g.loanAmountLeft <= 0) {
          logGameEvent(state, "LOAN", `Loan paid off: ${g.name}`);
        }
        facilityExpenses += paymentInterest / ticksPerMonth;
      }
      // Only a real tick is a tick of this facility's life. The pre-roll frames after a month
      // rollover and every tick of every forecast come through here too, and neither happened
      if (!simulated) {
        // What the supply pass above actually counted: a paused facility is still winding
        // down, and those watts are deliberately left out of the company's supply, so
        // crediting them here would book revenue nobody was paid for. Its potential keeps
        // accruing though -- being switched off is exactly what a capacity factor is for
        g.lifetimeWh += generatedWh;
        g.lifetimePotentialWh += (g.peakW / ticksPerHour) * GAME_TO_REAL_YEARS;
        g.lifetimeRevenue += deliveredW * revenuePerSuppliedW;
        g.lifetimeExpenses +=
          facilityExpenses +
          oneTimeWorldEventCost(
            hazardOneTimeCosts.filter(
              (event) => event.attributes.facilityId === g.id,
            ),
            prev,
            now,
          );
        if (started) {
          g.lifetimeStarts = (g.lifetimeStarts || 0) + GAME_TO_REAL_YEARS;
        }
      }
    } else {
      // Full amortizing payments start with the loan, as the purchase screen quotes and as
      // interties already do: construction is not an interest-only holiday.
      const paymentInterest = getPaymentInterest(
        g.loanAmountLeft,
        g.interestRate,
      );
      if (g.loanAmountLeft > 0) {
        const paymentPrincipal = Math.min(
          (g.loanMonthlyPayment - paymentInterest) / ticksPerMonth,
          g.loanAmountLeft,
        );
        principalRepayment += paymentPrincipal;
        g.loanAmountLeft -= paymentPrincipal;
      }
      facilityExpenses = paymentInterest / ticksPerMonth;
      expensesInterest += facilityExpenses;
      // A half-built plant is already costing interest, and a row that only started counting on
      // the day it switched on would hide the cheapest place to notice that
      if (!simulated) {
        g.lifetimeExpenses += facilityExpenses;
      }
    }
  });
  let transmissionPrincipalRepayment = 0;
  // Intertie O&M is authored in the same 2023 dollars as the facility tables, so it is carried
  // into the run's money the same way: deflated to the starting year, then escalated with the
  // game's inflation. Line capex is still charged at the authored quote, because saves validate
  // a line's investment by rebuilding those quotes exactly.
  const transmissionCostIndex = getCostTableIndex(
    tickDate,
    state.startingYear,
    state.seed,
  );
  transmission.lines
    .filter(
      (line) =>
        line.yearsToBuildLeft <= 0 && !isPeerCorridorId(line.corridorId),
    )
    .forEach((line) => {
      expensesOM +=
        (line.annualOperatingCost *
          transmissionCostIndex *
          (line.paused ? 0.5 : 1)) /
        ticksPerYear;
    });
  transmission.lines.forEach((line) => {
    if (line.loanAmountLeft <= 0) return;
    const paymentInterest = getPaymentInterest(
      line.loanAmountLeft,
      line.interestRate,
    );
    const paymentPrincipal = Math.min(
      (line.loanMonthlyPayment - paymentInterest) / ticksPerMonth,
      line.loanAmountLeft,
    );
    expensesInterest += paymentInterest / ticksPerMonth;
    transmissionPrincipalRepayment += paymentPrincipal;
    line.loanAmountLeft -= paymentPrincipal;
  });
  let corporatePrincipalRepayment = 0;
  if (state.utilityExpansion) {
    for (const loan of state.utilityExpansion.loans) {
      if (loan.loanAmountLeft <= 0) continue;
      const interest =
        getPaymentInterest(loan.loanAmountLeft, loan.interestRate) /
        ticksPerMonth;
      const principal = Math.max(
        0,
        Math.min(
          loan.loanAmountLeft,
          loan.loanMonthlyPayment / ticksPerMonth - interest,
        ),
      );
      if (!preRoll && advanceConstruction) {
        loan.loanAmountLeft -= principal;
        corporatePrincipalRepayment += principal;
      }
      expensesInterest += interest;
    }
    const annualNetworkOM = utilityNetworkAnnualOM(
      [
        "champlain",
        ...state.utilityExpansion.acquisitions
          .filter((receipt) => receipt.minute <= now.minute)
          .map((receipt) => receipt.targetId),
      ],
      prev.customers,
      tickDate.year,
    );
    expensesOM +=
      (annualNetworkOM * costIndexNow * difficulty.expensesOM) /
      (12 * ticksPerMonth);
  }
  const expensesCarbonFee = carbonFee * feeableKgco2e;

  // Customers
  // Demand is the customer count times a multiple, so a run that blacks out for long enough
  // rounds its last customer away and arrives here with no demand at all. Without the guard that
  // is 0/0, and the NaN goes straight into the customer count and the cash balance and stays
  // there -- a lost game turned into a corrupted one, with no way back to a number
  const percentDemandUnfulfilled =
    demandWh > 0 ? (demandWh - supplyWh) / demandWh : 0;
  const organicGrowthRate =
    ORGANIC_GROWTH_MAX_ANNUAL -
    difficulty.blackoutPenalty * percentDemandUnfulfilled;
  const scenario =
    getScenario(state.scenarioId, state.customScenario) || SCENARIOS[0];

  // Save new financial info
  now.customerRate = updateCustomerRate(
    prev.customerRate || state.customerRate,
    prev.customerBillingRate ?? state.dollarsPerkWh,
    tickScale,
  );
  now.customers = nextCustomerCount({
    customers: prev.customers,
    customerRate: now.customerRate,
    marketRate: getMarketRate(
      scenario.dollarsPerkWh,
      tickDate,
      state.startingYear,
      state.seed,
    ),
    marketSize: customerMarketSizeAt(state.customerMarketSize, now.minute),
    ownership: scenario.ownership,
    organicGrowthRate,
    tickScale,
  });
  if (state.utilityExpansion && !preRoll && advanceConstruction) {
    const retention = Math.min(
      1,
      now.customers / expansionRetentionBaseline(state),
    );
    state.utilityExpansion.networkAssets.forEach((asset) => {
      asset.retentionLowWatermark = Math.min(
        asset.retentionLowWatermark,
        retention,
      );
    });
  }
  now.cash = Math.round(
    prev.cash +
      revenue -
      expensesImports -
      expensesOM -
      expensesFuel -
      expensesCarbonFee -
      expensesInterest -
      (now.expensesPolicy || 0) -
      principalRepayment -
      transmissionPrincipalRepayment -
      corporatePrincipalRepayment,
  );
  now.netWorth = getNetWorth(
    facilities,
    now.cash,
    now.minute,
    transmission.lines,
    state,
  );
  now.revenue = revenue + (rebookingFrame ? choiceGrant : 0);
  now.revenueExports = revenueExports;
  now.revenueGrants = choiceGrant;
  now.expensesImports = expensesImports;
  now.expensesOM = expensesOM + (rebookingFrame ? immediateCosts : 0);
  now.expensesFuel = expensesFuel;
  now.expensesCarbonFee = expensesCarbonFee;
  now.expensesInterest = expensesInterest;
  now.localKgco2e = kgco2e;
  now.importedKgco2e = (importedWh / 1000000) * now.importKgco2ePerMWh;
  // Deliberately added here and not to the `kgco2e` accumulator above, which is what
  // expensesCarbonFee is charged on. A carbon fee prices what a grid burns in the jurisdiction
  // levying it; embodied emissions are mostly incurred in someone else's supply chain, years
  // earlier, and are not what such a scheme reaches. They still count towards the score.
  now.constructionKgco2e = constructionKgco2e;
  now.kgco2e = now.localKgco2e + now.importedKgco2e + now.constructionKgco2e;
  // Deliberately this tick's own month rather than `date`, which is the month the game is
  // actually in and is shared by every tick of a forecast. Reading it from the tick is what lets
  // the same line serve the record and the projection: history keeps what the rate was, and the
  // forecast walks prime out to wherever it is heading instead of flat-lining today's value all
  // the way to December. The credit premium is held fixed across the horizon on purpose - what
  // the player does between now and then is exactly what a forecast cannot know.
  const tickMonth = getMonthYearFromMinute(now.minute, state.startingYear);
  now.inflationRate = getInflationRate(tickMonth, state.seed);
  now.interestRate = getPrimeRate(tickMonth, state.seed) * state.creditPremium;

  if (noElapsed) {
    for (const { node, value } of noElapsed.facilities) {
      const output = node.currentW,
        committed = node.committed;
      for (const key of Object.keys(node))
        if (!(key in value))
          delete (node as unknown as Record<string, unknown>)[key];
      Object.assign(node, value, { currentW: output, committed });
    }
    for (const { node, value } of noElapsed.lines)
      Object.assign(node, value, { currentFlowW: node.currentFlowW });
    noElapsed.loans.forEach(({ node, value }) => Object.assign(node, value));
    state.commissionedHydroSiteIds = noElapsed.commissioned;
    now.cash = noElapsed.frame.cash;
    now.customers = noElapsed.frame.customers;
    now.customerRate = noElapsed.frame.customerRate;
    for (const key of [
      "customerBatteryWh",
      "customerBatteryWhStart",
      "customerBatteryLossWh",
    ] as const)
      now[key] = noElapsed.frame[key];
    now.storedWh = facilities.reduce(
      (sum, facility) => sum + (isStorage(facility) ? facility.currentWh : 0),
      0,
    );
    now.hydroReservoirWh = facilities.reduce(
      (sum, facility) => sum + (facility.reservoirWh ?? 0),
      0,
    );
    now.netWorth = getNetWorth(
      facilities,
      now.cash,
      now.minute,
      transmission.lines,
      state,
    );
  }
  return now;
}

type ForecastObserver = (state: GameType, tick: TickPresentFutureType) => void;

function supplyForecastPass(
  state: GameType,
  simulated?: boolean,
  withoutMinimumStableOutput = false,
  stepMinutes = TICK_MINUTES,
  observe?: ForecastObserver,
  preserveCurrentFrame = false,
): TickPresentFutureType[] {
  // updateSupplyFacilitiesFinances ramps generators, charges batteries and pays down loans by
  // mutating the facilities in place, so forecasting has to run against a copy of them. A shallow
  // spread shares the same facility objects, which let a forecast leave the real fleet sitting at
  // its end-of-horizon state -- resuming a paused nuclear plant snapped straight to full output
  // instead of ramping, and every reforecast silently aged construction and loans by a whole day.
  const newState = {
    ...state,
    policies: cloneDeep(state.policies),
    utilityExpansion: cloneDeep(state.utilityExpansion),
    commissionedHydroSiteIds: [...state.commissionedHydroSiteIds],
    facilities: cloneDeep(state.facilities),
    transmission: cloneDeep(state.transmission ?? emptyTransmissionState()),
  };
  if (withoutMinimumStableOutput) {
    newState.facilities.forEach((facility) => {
      if (!isStorage(facility)) {
        facility.minimumStableOutput = undefined;
      }
    });
  }
  const current = getTimeFromTimeline(state.date.minute, state.timeline);
  const currentCash = current?.cash;
  const currentCustomers = current?.customers;
  let prev = newState.timeline[0];
  return newState.timeline.map((t: TickPresentFutureType) => {
    const sourceTick = t;
    if (
      t.minute >= state.date.minute &&
      !(preserveCurrentFrame && t.minute === state.date.minute)
    ) {
      advanceGamePolicies(newState, Math.floor(t.minute / MINUTES_PER_MONTH));
      // Both forecast passes use private facilities, even when their caller omits `simulated`.
      // Install the conversion here so baseline dispatch and the optimized pass see the same
      // technology. The baseline must remain free of minimum-load constraints after conversion.
      newState.facilities.forEach((facility) => {
        if (
          facility.upgradeInProgress?.upgrade === "combinedCycle" &&
          t.minute >= facility.upgradeInProgress.completesMinute &&
          facility.gasCycle === "simple"
        ) {
          const context = newState;
          if (!context) return;
          completeGasConversion(facility, {
            ...context,
            date: getDateFromMinute(
              facility.upgradeInProgress.completesMinute,
              state.startingYear,
            ),
          });
          if (withoutMinimumStableOutput && !isStorage(facility)) {
            facility.minimumStableOutput = undefined;
          }
        }
      });
      t = { ...t };
      copyCommitmentMetadata(sourceTick, t);
      t = updateSupplyFacilitiesFinances(
        newState,
        prev,
        t,
        simulated,
        undefined,
        !withoutMinimumStableOutput,
        stepMinutes,
        // Re-evaluating this tick is not elapsed construction time. Advancing the clone here
        // would drop one tick's emissions from the future and open projects one tick early.
        t.minute !== state.date.minute,
      );
      // The current tick already happened. Reforecast its supply against the player's action,
      // but keep the transaction and customer balance that caused this reforecast. Otherwise
      // rebuilding from the previous tick erases a purchase refund (and, symmetrically, a cost).
      if (t.minute === state.date.minute) {
        // A player's action changes the forecast, not emissions already recorded this tick.
        t.constructionKgco2e = current?.constructionKgco2e || 0;
        t.kgco2e =
          (t.localKgco2e || 0) + (t.importedKgco2e || 0) + t.constructionKgco2e;
        if (currentCash !== undefined) {
          t.cash = currentCash;
        }
        if (currentCustomers !== undefined) {
          t.customers = currentCustomers;
        }
        t.netWorth = getNetWorth(
          state.facilities,
          t.cash,
          t.minute,
          // Just like currentCash, the live transmission balance already represents this tick.
          // The cloned line has made one forecast payment, so using it here would grant project
          // equity before the matching principal has actually left cash.
          state.transmission?.lines,
          state,
        );
        // The clone just re-dispatched this very tick against the action that triggered the
        // reforecast, so its per-line flow is the fresh answer and the live lines' is the one
        // from before it. Copy it back, or an intertie row keeps last tick's reading until the
        // clock moves again -- and the clock is paused for every policy decision.
        const forecastFlows = new Map(
          newState.transmission.lines.map((line) => [
            line.id,
            line.currentFlowW,
          ]),
        );
        state.transmission?.lines.forEach((line) => {
          const flow = forecastFlows.get(line.id);
          if (flow !== undefined) {
            line.currentFlowW = flow;
          }
        });
      }
    }
    observe?.(newState, t);
    prev = t;
    return t;
  });
}

/** Forecast a rate choice through the bankruptcy check at rollover, on a private copy. */
export function forecastMonthClosingCashAtCustomerRate(
  state: GameType,
  dollarsPerkWh: number,
): number {
  const forecast = cloneDeep(state);
  forecast.dollarsPerkWh = dollarsPerkWh;
  forecast.rateFollowsInflation = false;
  forecast.timeline = reforecastSupply(forecast, true);
  const closesMinute = (state.date.monthsElapsed + 1) * MINUTES_PER_MONTH;
  for (
    let minute = state.date.minute + TICK_MINUTES;
    minute <= closesMinute;
    minute += TICK_MINUTES
  ) {
    forecast.date = getDateFromMinute(minute, forecast.startingYear);
    completeRetrofits(forecast, true);
    const now = getTimeFromTimeline(minute, forecast.timeline);
    const prev = getTimeFromTimeline(minute - TICK_MINUTES, forecast.timeline);
    if (!now || !prev) return -Infinity;
    updateSupplyFacilitiesFinances(forecast, prev, now, true);
  }
  // The real rollover books one more tick against the final forecast frame before checking cash.
  return (
    getTimeFromTimeline(closesMinute, forecast.timeline)?.cash ?? -Infinity
  );
}

function reforecastSupply(
  state: GameType,
  simulated?: boolean,
  stepMinutes = TICK_MINUTES,
  observe?: ForecastObserver,
  preserveCurrentFrame = false,
): TickPresentFutureType[] {
  // First record the merit-order request each generator would receive without minimum-load
  // constraints. The optimized pass then scans those per-facility requests to compare the cost
  // of remaining online with the cost of the next start. Keeping this as two linear passes avoids
  // recursively re-simulating the fleet for every plant on every tick.
  const baseline = supplyForecastPass(
    state,
    true,
    true,
    stepMinutes,
    undefined,
    preserveCurrentFrame,
  );
  // Recorded ticks can be Immer drafts when this is called from a reducer. Commitment metadata
  // is deliberately attached with Object.defineProperty, which Immer forbids on a draft; the
  // optimizer only reads from the current tick onwards anyway, so leave the recorded past alone.
  const futureBaseline = baseline.slice(
    forecastIndexAt(state, state.date.minute) + (preserveCurrentFrame ? 1 : 0),
  );
  state.facilities.forEach((facility) => {
    if (!isStorage(facility) && (facility.minimumStableOutput || 0) > 0) {
      const conversionMinute =
        facility.upgradeInProgress?.upgrade === "combinedCycle"
          ? facility.upgradeInProgress.completesMinute
          : undefined;
      const converted =
        conversionMinute === undefined ? undefined : { ...facility };
      if (converted && conversionMinute !== undefined) {
        const context = state;
        if (!context) return;
        completeGasConversion(converted, {
          ...context,
          date: getDateFromMinute(conversionMinute, state.startingYear),
        });
      }
      prepareGeneratorCommitment({
        facilityId: facility.id,
        forecast: futureBaseline,
        minimumOperatingCost: (futureTick) =>
          minimumStableOperatingCost(
            state,
            converted &&
              conversionMinute !== undefined &&
              futureTick.minute >= conversionMinute
              ? converted
              : facility,
            futureTick,
            stepMinutes,
          ),
      });
    }
  });
  return supplyForecastPass(
    { ...state, timeline: baseline },
    simulated,
    false,
    stepMinutes,
    observe,
    preserveCurrentFrame,
  );
}

/** The actual weather trajectory used to settle live ticks and resumed games. */
export function generateNewTimeline(
  state: GameType,
  cash: number,
  customers: number,
  ticks = TICKS_PER_DAY,
  stepMinutes = TICK_MINUTES,
  observe?: ForecastObserver,
): TickPresentFutureType[] {
  return generateTimeline(
    state,
    cash,
    customers,
    ticks,
    stepMinutes,
    false,
    observe,
  );
}

/** Player-facing projections run the same demand/dispatch engine on estimated weather. */
export function generateForecastTimeline(
  state: GameType,
  cash: number,
  customers: number,
  ticks = TICKS_PER_DAY,
  stepMinutes = TICK_MINUTES,
  observe?: ForecastObserver,
): TickPresentFutureType[] {
  return generateTimeline(
    state,
    cash,
    customers,
    ticks,
    stepMinutes,
    true,
    observe,
  );
}

function generateTimeline(
  readOnlyState: GameType,
  cash: number,
  customers: number,
  ticks: number,
  stepMinutes: number,
  forecastWeather: boolean,
  observe?: ForecastObserver,
): TickPresentFutureType[] {
  // Forecasts only read the live state. Snapshot a draft once so the horizon does not repeatedly
  // traverse Immer proxies for location, events, history and other shared inputs. `current`, not
  // `original`, includes this tick's completed construction, policies and month-boundary events.
  if (isDraft(readOnlyState)) readOnlyState = current(readOnlyState);
  const tickScale = stepMinutes / TICK_MINUTES;
  // Everything below runs against a private copy, because reforecastSupply ramps generators and
  // pays down loans by mutating the facilities it is handed. Only the facilities need the deep
  // clone though: the timeline is overwritten on the very next line, and by the end of a long
  // scenario the monthly history is hundreds of entries that nothing in the forecast reads.
  // Deep cloning either of them was work thrown away, on a function that can run a year of
  // simulation several times a second.
  const state = {
    ...readOnlyState,
    utilityExpansion: cloneDeep(readOnlyState.utilityExpansion),
    commissionedHydroSiteIds: [...readOnlyState.commissionedHydroSiteIds],
    facilities: cloneDeep(readOnlyState.facilities),
    transmission: cloneDeep(
      readOnlyState.transmission ?? emptyTransmissionState(),
    ),
    // Story checkpoints only need the trailing year, and scheduled forecast effects resolve from
    // the same immutable facts as live play. Keeping twelve entries is cheap and avoids a second
    // forecast-only narrative state.
    monthlyHistory: readOnlyState.monthlyHistory.slice(0, 12),
    timeline: new Array(ticks) as TickPresentFutureType[],
  };
  // Loop invariant: the fleet is fixed across the horizon and the cash is a parameter, so this
  // was the same number recomputed for every one of up to a year's worth of ticks
  const netWorth = getNetWorth(
    state.facilities,
    cash,
    state.date.minute,
    state.transmission?.lines,
    state,
  );
  const currentCustomerRate =
    getTimeFromTimeline(readOnlyState.date.minute, readOnlyState.timeline)
      ?.customerRate || readOnlyState.customerRate;
  // Retention responds to the last delivered-energy bill, with one tick of lag.
  // Carry that signal across month boundaries and isolated forecast horizons.
  const currentBillingRate =
    getTimeFromTimeline(readOnlyState.date.minute, readOnlyState.timeline)
      ?.customerBillingRate ??
    readOnlyState.timeline.at(-1)?.customerBillingRate ??
    readOnlyState.dollarsPerkWh;
  for (let i = 0; i < ticks; i++) {
    state.timeline[i] = {
      minute: state.date.minute + i * stepMinutes,
      supplyW: 0,
      demandW: 0,
      demandByType: {
        Residential: 0,
        Commercial: 0,
        Industrial: 0,
        Transportation: 0,
        Mining: 0,
        "Data Centers": 0,
      },
      solarIrradianceWM2: 0,
      windKph: 0,
      windAirborneKph: 0,
      temperatureC: 0,
      cash,
      customers,
      customerRate: currentCustomerRate,
      customerBillingRate: currentBillingRate,
      netWorth,
      revenue: 0,
      expensesFuel: 0,
      expensesOM: 0,
      expensesCarbonFee: 0,
      expensesInterest: 0,
      expensesPolicy: 0,
      expensesImports: 0,
      revenueExports: 0,
      revenueGrants: 0,
      importedW: 0,
      exportedW: 0,
      transmissionCapacityW: 0,
      marketPricePerMWh: 0,
      kgco2e: 0,
      localKgco2e: 0,
      importedKgco2e: 0,
      constructionKgco2e: 0,
      reserveW: 0,
      importKgco2ePerMWh: 0,
      // Both overwritten by updateSupplyFacilitiesFinances, from each tick's own date
      interestRate: 0,
      inflationRate: 0,
      // reforecastWeatherAndPrices sets both of these on the next line, for every tick from
      // the current minute onwards -- which is all of them, since the timeline starts there.
      // Initialised anyway so a tick is a complete TickPresentFutureType the moment it exists,
      // rather than one that happens to be patched up before anything reads it.
      storedWh: 0,
      precipitationMm: 0,
      snowpackMm: 0,
      hydroRunoffMm: 0,
      hydroReservoirWh: 0,
      hydroReservoirCapacityWh: 0,
      hydroSpillWh: 0,
      hydroMandatedReleaseW: 0,
      storageLossWh: 0,
      supplyByFuel: {} as FuelProductionType,
      // Asserted because FuelPricesType carries a `[index: string]: number` index signature,
      // which a fresh object literal with a non-number field cannot satisfy. Same reason
      // reforecastWeatherAndPrices asserts its own tick literal.
    } as TickPresentFutureType;
  }
  const previousDemandTick = readOnlyState.timeline.findLast(
    (tick) => tick.minute < state.date.minute,
  );
  state.timeline = reforecastWeatherAndPrices(state, forecastWeather);
  state.timeline = reforecastDemand(
    state,
    tickScale,
    previousDemandTick?.deferredResidential ??
      getTimeFromTimeline(state.date.minute, readOnlyState.timeline)
        ?.deferredResidentialStart ??
      [],
    previousDemandTick?.deferredThermal ??
      getTimeFromTimeline(state.date.minute, readOnlyState.timeline)
        ?.deferredThermalStart ??
      [],
    previousDemandTick?.deferredCharging ??
      getTimeFromTimeline(state.date.minute, readOnlyState.timeline)
        ?.deferredChargingStart ??
      [],
    readOnlyState.timeline.length
      ? readOnlyState.timeline.reduce(
          (sum, tick) => sum + tick.demandByType.Transportation,
          0,
        ) / readOnlyState.timeline.length
      : 0,
  );
  const batteryCarry =
    previousDemandTick?.customerBatteryWh ??
    getTimeFromTimeline(state.date.minute, readOnlyState.timeline)
      ?.customerBatteryWhStart ??
    0;
  if (state.timeline[0] && batteryCarry > 0) {
    state.timeline[0].customerBatteryWhStart = batteryCarry;
    state.timeline[0].customerBatteryWh = batteryCarry;
  }
  state.timeline = reforecastSupply(state, true, stepMinutes, observe);
  return state.timeline;
}

/**
 * Edits the state in place to handle all of the one-off consequences of building
 * (not including reforecasting, which should be done once after multiple builds)
 */
function buildFacilityHelper(
  state: GameType,
  g: FacilityShoppingType,
  financed: boolean,
  newGame = false,
  initialAgeYears = 0,
  initialReservoirFraction = 0.5,
  hydroSiteId?: string,
): GameType {
  const now = getTimeFromTimeline(state.date.minute, state.timeline);

  if (now) {
    let financing = {
      loanAmountTotal: 0,
      loanAmountLeft: 0,
      loanMonthlyPayment: 0,
      interestRate: 0, // Nothing borrowed, nothing owed
    };
    if (newGame) {
      // Don't charge anything for initial builds
    } else {
      const terms = purchaseTerms(
        g.buildCost,
        financed,
        state.interestRate,
        0,
        facilityLoanMonths(g.lifespanYears),
      );
      now.cash -= terms.amountDue;
      if (financed) {
        financing = {
          loanAmountTotal: terms.loanAmount,
          loanAmountLeft: terms.loanAmount,
          loanMonthlyPayment: terms.monthlyPayment,
          interestRate: state.interestRate,
        };
      }
    }
    // Site availability belongs to the current fleet quote, not the facility bought from it. A
    // saved operating asset must not retain a permanently stale "remaining" count.
    // Nor does the resilience option's share of the price: it is only for the build dialog.
    const {
      viableLocationsRemaining: _viableLocationsRemaining,
      resilienceExtraBuildCost: _resilienceExtraBuildCost,
      startingAssetId: _startingAssetId,
      assetId: _assetId,
      ...facilitySnapshot
    } = g as FacilityShoppingType & {
      startingAssetId?: string;
      assetId?: string;
    };
    const facility = {
      ...facilitySnapshot,
      hydroSiteId: hydroSiteId ?? g.hydroSiteId,
      // A scenario's catalog is priced in its starting year, but an inherited wind farm belongs
      // to its commissioning vintage and should use that cohort's observed degradation rate.
      ...(newGame && g.fuel === "Wind"
        ? {
            annualOutputDegradation: windAnnualOutputDegradation(
              state.date.year - initialAgeYears,
            ),
          }
        : {}),
      ...financing,
      // The quote's O&M is in this month's dollars; escalation is measured from here. The
      // starting fleet is quoted on the opening day, where the index is 1.
      ...(!newGame && hasEconomy()
        ? {
            costIndexAtBuild: getInflationIndex(
              state.date,
              state.startingYear,
              state.seed,
            ),
          }
        : {}),
      lifetimeWh: 0,
      lifetimePotentialWh: 0,
      lifetimeRevenue: 0,
      lifetimeExpenses: 0,
      lifetimeStarts: newGame ? startingFacilityStarts(g, initialAgeYears) : 0,
      id:
        state.facilities.reduce(
          (max: number, f: FacilityOperatingType) => (max > f.id ? max : f.id),
          0,
        ) + 1,
      currentW: newGame && g.peakWh === undefined ? g.peakW : 0,
      committed:
        g.minimumStableOutput !== undefined && g.peakWh === undefined
          ? newGame
          : undefined,
      generatingLastRealTick:
        g.tracksStarts && newGame && g.peakWh === undefined,
      yearsToBuildLeft: newGame ? 0 : g.yearsToBuild,
      // Resolved from the quote rather than recomputed later, so a standing plant keeps the
      // embodied emissions of the year it was actually built. The starting fleet was built
      // before the run opened and carries none: nothing of it is emitted on the player's watch.
      constructionKgco2eTotal: newGame
        ? 0
        : (g.constructionKgco2ePerW || 0) * g.peakW +
          (g.constructionKgco2ePerWh || 0) * (g.peakWh || 0),
      minuteCreated: state.date.minute,
      minuteOperational: newGame
        ? state.date.minute - initialAgeYears * DAYS_PER_YEAR * 24 * 60
        : undefined,
    } as FacilityOperatingType;
    if (
      isConventionalHydro(facility) &&
      facility.hydroSiteId &&
      facility.yearsToBuildLeft === 0 &&
      !state.commissionedHydroSiteIds.includes(facility.hydroSiteId)
    )
      state.commissionedHydroSiteIds.push(facility.hydroSiteId);
    if (g.fuel === "Hydro" && g.reservoirCapacityWh) {
      // A completed dam starts at a neutral mid-pool unless a scenario states the level it
      // opens on. New construction carries this initial value until commissioning rather than
      // conjuring five years of unobserved inflow.
      facility.reservoirWh = g.reservoirCapacityWh * initialReservoirFraction;
      facility.hydroLastInflowWh = 0;
      facility.hydroLastSpillWh = 0;
      facility.hydroLastMandatedReleaseWh = 0;
      facility.hydroLastBypassWh = 0;
    }
    if (g.peakWh) {
      facility.currentWh = 0;
      state.facilities.push(facility); // add storage to bottom so that it's on by default
    } else if (newGame) {
      // The authored fleet is put back into scenario order after it is built; see initGame
      state.facilities.unshift(facility);
    } else {
      // New generators go to the top so that they produce by default, and peakers above only
      // the other peakers so they are not run as baseload
      state.facilities.splice(
        defaultDispatchIndex(state.facilities, facility),
        0,
        facility,
      );
    }
  }

  return state;
}

function getNetWorth(
  facilities: FacilityOperatingType[],
  cash: number,
  currentMinute: number,
  transmissionLines: readonly TransmissionLineOperatingType[] = [],
  game?: Pick<GameType, "utilityExpansion">,
): number {
  let netWorth = cash;
  facilities.forEach((g: FacilityOperatingType) => {
    netWorth += facilityCashBack(g, currentMinute);
  });
  transmissionLines.forEach((line) => {
    // The project is worth what has been paid for it at every construction stage. At purchase,
    // cost less the new loan is exactly the down payment, keeping net worth neutral. Each later
    // principal payment then moves value from cash into project equity instead of disappearing
    // from the balance sheet before the line opens.
    netWorth += line.buildCost - line.loanAmountLeft;
  });
  return netWorth + (game ? expansionNetWorth(game, currentMinute) : 0);
}
