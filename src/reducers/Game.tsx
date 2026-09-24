import {
  accessContextForGame,
  corridorsForGame,
  effectiveMarket,
} from "../data/IntertieAccess";
import { beginIntertieStress } from "./GameActions";
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
  hasChronicBlackouts,
  scenarioObjectiveFailure,
} from "../helpers/ObjectiveRules";
import { chooseScenarioResponse } from "./GameActions";
import {
  validBuildFacility,
  validRetrofitFacility,
} from "../helpers/BuildValidation";
import {
  pendingScenarioChoice,
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
} from "../helpers/Policies";
import { POLICIES, POLICY_IDS } from "../data/Policies";
import { policyChoiceLabel } from "../helpers/PolicyWindow";
import {
  schedulePolicy,
  cancelPolicy,
  openPolicyDecision,
  closePolicyDecision,
  pageHidden,
  pageVisible,
} from "./GameActions";
import type { AppDispatch } from "../Store";
import cloneDeep from "lodash.clonedeep";
import { createSlice, original, PayloadAction } from "@reduxjs/toolkit";
import { submitHighscore } from "./User";
import {
  getDateFromMinute,
  getMonthYearFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeHistory,
  summarizeTimeline,
  getSunriseSunset,
} from "../helpers/DateTime";
import {
  facilityCashBack,
  getCreditInputs,
  getCreditPremium,
  getMonthlyPayment,
  getPaymentInterest,
  facilityOutputFactor,
  estimatedAnnualOperatingCost,
} from "../helpers/Financials";
import { getInflationRate, getPrimeRate } from "../data/Economy";
import {
  CUSTOMER_MARKET_MULTIPLIER,
  customerMarketSizeAt,
  getMarketRate,
  nextCustomerCount,
  updateCustomerRate,
} from "../helpers/Customers";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
} from "../helpers/Format";
import { arrayMove, newSeed, roundToSignificantDigits } from "../helpers/Math";
import { computeScoreBreakdown, totalScore } from "../helpers/Scoring";
import { formatLargeMass } from "../helpers/Units";
import { buildStartedMessage } from "../helpers/BuildConsequences";
import { buildVictoryDebrief } from "../helpers/Debrief";
import { buildStoryPeriodSnapshot, buildStorySnapshot } from "../helpers/Story";
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
import {
  adjacentMarketPricePerMWh,
  allocateIntertieFlows,
  neighborImportSupplyW,
  clearTransmissionMarket,
  intertieContextForGame,
  intertieUpgradeQuote,
  intertieBuildQuote,
  intertieImportLimitW,
  IntertieOffer,
  transmissionRatingW,
} from "../helpers/Transmission";
import {
  DEMAND_TYPES,
  demandByTypeAt,
  temperatureDemandWattsPerCustomer,
} from "../data/DemandProfiles";
import {
  combineStoryEffects,
  resolveStoryAtDate,
  STORY_ARC_DEFINITIONS,
} from "../data/WorldEvents";
import {
  getMonthlyClimatology,
  getRawSolarIrradianceWM2,
  getWeather,
} from "../data/Weather";
import {
  activePreparedness,
  activeWildfire,
  dailyFireWeatherReading,
  isWildfireHazardEligible,
  sampleWildfireIncident,
  WILDFIRE_DEFINITION_ID,
  wildfireDraw,
  wildfireInCooldown,
  wildfireMonthlyProbability,
  wildfireOccurrenceKey,
  weatherFireRiskModifier,
} from "../helpers/Wildfire";
import { getWildfireProfile } from "../data/WildfireProfiles";
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
  retrofitCost,
  retrofittedResilience,
  sampleHailImpacts,
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
  DOWNPAYMENT_PERCENT,
  FUELS,
  GAME_TO_REAL_YEARS,
  INTEREST_RATE_YEARLY,
  LOAN_MONTHS,
  ORGANIC_GROWTH_MAX_ANNUAL,
  TICK_MINUTES,
  TICK_MS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
  YEARS_PER_TICK,
  LOCATIONS,
} from "../Constants";
import {
  GENERATORS,
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
import { getPlayedScenarioIds, recordScenarioPlayed } from "../LocalStorage";
import {
  CUSTOM_SCENARIO_ID,
  getNextTutorial,
  getScenario,
  SCENARIOS,
  TUTORIALS,
} from "../data/Scenarios";
import { getStore } from "../StoreRegistry";
import { start, loaded, quit, resume, startReplay } from "./GameActions";
import { clearSaveFor } from "../SaveGame";
import { recordReplayAction, recordedDelta, serializeReplay } from "../Replay";
import {
  ActiveWorldEventType,
  ConstructionEmissions,
  DateType,
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
  ScenarioFacilityType,
  ScenarioType,
  ScoreBreakdownType,
  SpeedType,
  StorageOperatingType,
  TickPresentFutureType,
  FuelProductionType,
  ReplayActionType,
  RetrofitFacilityAction,
  TradingPolicyType,
  TransmissionLineOperatingType,
  VictoryType,
  WorldEventEffectsType,
} from "../Types";

interface BuildFacilityAction {
  facility: FacilityShoppingType;
  financed: boolean;
}

interface ReprioritizeFacilityAction {
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
const MAX_PRESENTATION_FPS = 60;
const MIN_PRESENTATION_INTERVAL_MS = 1000 / MAX_PRESENTATION_FPS;
// Only for restoring speed after a blocking dialog (bankrupt/fired/win) closes -- NOT used to
// decide whether the tick loop needs restarting, since state.speed can change without going
// through setSpeed (e.g. dialogClose below), which would desync a "previous speed" comparison.
let speedBeforeDialog = "PAUSED" as SpeedType;
// Same idea for full-screen decision cards over a game that would otherwise keep ticking.
// Undefined whenever a card isn't what paused us, so leaving one never resumes a deliberate
// pause. Construction catalogs belong here too: the quote should not change while it is read.
let speedBeforeBlockingCard: SpeedType | undefined;
let speedBeforeManualHelp: SpeedType | undefined;
// While hidden, pause owners read and update this foreground speed; the real clock stays
// paused even if a dialog or card opens or closes before the page returns.
let speedBeforeHidden: SpeedType | undefined;
const BLOCKING_CARDS = new Set([
  "MAIN_MENU",
  "MANUAL",
  "BUILD_GENERATORS",
  "BUILD_STORAGE",
  "BUILD_INTERTIES",
  "CHALLENGE",
  "NEW_GAME",
  "NEW_GAME_DETAILS",
  "CUSTOM_GAME",
]);
// Tracks whether the self-rescheduling tick() loop is currently alive, so that any transition
// out of PAUSED (manual speed click, tutorial script, dialog closing) reliably restarts it.
let tickLoopRunning = false;
// Edge-detects the blackout toast, so a sustained blackout announces itself once rather than
// four times an hour of game time
let previouslyInBlackout = false;
// What the blackout currently underway has cost, so the event log can say how bad it was once
// it's over. Reset on each edge into one; meaningless while the lights are on
let blackoutStartMinute = 0;
let blackoutUnservedWh = 0;
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
  // An important event creates a decision point. Replays remain passive records, and an already
  // paused player stays deliberately paused rather than acquiring a speed to restore later.
  if (options.pause && !state.replayPlayback) {
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
  const burned = new Set<string>();
  state.facilities.forEach((f: FacilityOperatingType) => {
    const fuel = (f as Partial<GeneratorOperatingType>).fuel;
    // Wind and sun are fuels the game names but nobody prices
    if (fuel && previous[fuel] !== undefined && prices[fuel] !== undefined) {
      burned.add(fuel);
    }
  });
  burned.forEach((fuel: string) => {
    if (storyPriceFuels.has(fuel as FuelNameType)) {
      return;
    }
    const change = (prices[fuel] - previous[fuel]) / previous[fuel];
    if (Math.abs(change) < FUEL_PRICE_SPIKE) {
      return;
    }
    logGameEvent(
      state,
      "FUEL_PRICE",
      `${fuel} ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% to ${formatMoneyConcise(prices[fuel])}/MMBtu`,
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
    (FUELS[generator.fuel]?.kgCO2ePerBtu || 0) *
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
    const generator = facility as Partial<GeneratorOperatingType>;
    if (!generator.fuel) {
      return;
    }
    const cost = generatorCostPerMWh(
      facility as GeneratorOperatingType,
      prices,
      effectiveCarbonFee(state.date, state),
      operatingCostMultipliers?.[generator.fuel] || 1,
    );
    if (cost === undefined) {
      return;
    }
    // A fuel can have several plants. The cheapest one is the one dispatch order can actually
    // choose at the margin, and avoids plant size turning the comparison into an average.
    costs[generator.fuel] = Math.min(costs[generator.fuel] ?? Infinity, cost);
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
          reportedKey: `fuel-crossover:${fuel}`,
          pause: true,
        },
      );
    },
  );
}

const MAX_WORLD_EVENT_CHECKS = 2400;

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
    !STORY_ARC_DEFINITIONS.some((arc) => arc.scenarioId === state.scenarioId)
  ) {
    return storyPriceFuels;
  }
  const resolved = resolveStoryAtDate({
    seed: state.seed,
    scenarioId: state.scenarioId,
    difficulty: state.difficulty,
    date: state.date,
    location: state.location,
    snapshot: buildStorySnapshot(
      state.monthlyHistory,
      state.facilities,
      state.date.minute,
    ),
    periodSnapshots: Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((months) => [
        months,
        buildStoryPeriodSnapshot(state.monthlyHistory, months),
      ]),
    ),
    occurrences: state.worldEvents.occurrences,
  });
  resolved.occurrences.forEach((occurrence) => {
    if (state.worldEvents.checkedKeys.includes(occurrence.key)) {
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
      pause: occurrence.importance === "CRITICAL",
    });
  });
  if (state.worldEvents.checkedKeys.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.checkedKeys.splice(
      0,
      state.worldEvents.checkedKeys.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  if (state.worldEvents.occurrences.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.occurrences.splice(
      0,
      state.worldEvents.occurrences.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  return storyPriceFuels;
}

/**
 * Runs the recurring regional wildfire hazard check at monthly rollover, before this month's
 * forecast is built. An eligible location (a profiled area in a custom game -- never the authored
 * scenario 111, whose fixed firestorm is preserved) rolls one addressed draw per month. An
 * ignition persists a time-bounded occurrence whose effects flow through the same story-effect
 * machinery as authored events, so disconnected load, constrained generators and restoration cost
 * are accounted exactly once. The check is a pure function of (seed, location, absolute month),
 * so saving, forecasting or reordering evaluation cannot reroll it; the dedupe key keeps a resumed
 * month from announcing twice.
 */
function updateWildfireHazards(state: GameType): void {
  if (!isWildfireHazardEligible(state)) {
    return;
  }
  const profile = getWildfireProfile(state.location.id);
  if (!profile) {
    return;
  }
  const locationId = state.location.id;
  const monthsElapsed = state.date.monthsElapsed;
  // Report restoration for any wildfire that just expired at the start of this month. Occurrences
  // retain expired incidents, so this is detected from them (active no longer holds it).
  state.worldEvents.occurrences.forEach((event) => {
    if (event.definitionId !== WILDFIRE_DEFINITION_ID) {
      return;
    }
    if (!event.key.startsWith(`wildfire:${locationId}:`)) {
      return;
    }
    if (event.endsMinute !== state.date.minute) {
      return; // Still active, or expired in an earlier month.
    }
    const selectedNames = (event.attributes.selectedFacilityNames ||
      []) as string[];
    logGameEvent(
      state,
      "WORLD_EVENT",
      `Wildfire restoration complete: safety shutoffs are lifted and ${selectedNames.length ? selectedNames.join(", ") : "affected generators"} return to normal.`,
      {
        importance: "NOTABLE",
        actionTarget: { card: "FACILITIES", view: "FLEET" },
        title: "Wildfire restoration complete",
        concept: "supply",
        storyPhaseKey: event.key,
        reportedKey: `wildfire-recovery:${event.key}`,
      },
    );
  });
  // One active wildfire per region, and a cooldown after each incident.
  if (activeWildfire(state.worldEvents.active, locationId)) {
    return;
  }
  if (
    wildfireInCooldown(
      state.worldEvents.occurrences,
      locationId,
      monthsElapsed,
      profile,
    )
  ) {
    return;
  }
  const occurrenceKey = wildfireOccurrenceKey(locationId, monthsElapsed);
  if (state.worldEvents.checkedKeys.includes(occurrenceKey)) {
    return; // Already checked this month (e.g. a save resumed mid-month).
  }
  const monthIndex = state.date.monthNumber - 1;
  const modifier = weatherFireRiskModifier(
    dailyFireWeatherReading(state.date, state.seed),
    getMonthlyClimatology(monthIndex),
  );
  const probability = wildfireMonthlyProbability(profile, monthIndex, modifier);
  const ignites =
    wildfireDraw(state.seed, locationId, monthsElapsed, "occurrence") <
    probability;
  if (!ignites) {
    state.worldEvents.checkedKeys.push(occurrenceKey);
    if (state.worldEvents.checkedKeys.length > MAX_WORLD_EVENT_CHECKS) {
      state.worldEvents.checkedKeys.splice(
        0,
        state.worldEvents.checkedKeys.length - MAX_WORLD_EVENT_CHECKS,
      );
    }
    return;
  }
  const snapshot = buildStorySnapshot(
    state.monthlyHistory,
    state.facilities,
    state.date.minute,
  );
  const prepared = activePreparedness(
    state.worldEvents.occurrences,
    locationId,
    monthsElapsed,
  );
  const incident = sampleWildfireIncident({
    profile,
    seed: state.seed,
    locationId,
    monthsElapsed,
    snapshot,
    prepared,
  });
  const startsMinute = monthsElapsed * MINUTES_PER_MONTH;
  const endsMinute =
    (monthsElapsed + incident.durationMonths) * MINUTES_PER_MONTH;
  const outputMultipliers = Object.fromEntries(
    incident.selectedFacilityIds.map((id) => [
      String(id),
      incident.outputMultiplier,
    ]),
  );
  const affected = incident.selectedFacilityNames.length
    ? incident.selectedFacilityNames.join(", ")
    : "no operating generators";
  const endLabel = getDateFromMinute(endsMinute - 1, state.startingYear);
  const message = `${prepared ? "Prepared crews are in place. " : ""}${Math.round(incident.disconnectedDemand * 100)}% of customer load is disconnected by safety shutoffs while ${affected} are limited to ${Math.round(incident.outputMultiplier * 100)}% output, with restoration costing ${formatMoneyConcise(incident.restorationCostPerMonth)} per month through ${endLabel.month} ${endLabel.year}.`;
  const occurrence: ActiveWorldEventType = {
    key: occurrenceKey,
    definitionId: WILDFIRE_DEFINITION_ID,
    startsMinute,
    endsMinute,
    // A hidden surprise until it happens; once persisted its effects still enter forecasts.
    forecastable: false,
    title: "Wildfire emergency",
    message,
    concept: "danger",
    importance: "CRITICAL",
    actionTarget: { card: "FACILITIES", view: "FLEET" },
    attributes: {
      locationId,
      monthsElapsed,
      prepared,
      severity: incident.severity,
      disconnectedDemand: incident.disconnectedDemand,
      outputMultiplier: incident.outputMultiplier,
      targetCapacityShare: incident.targetCapacityShare,
      durationMonths: incident.durationMonths,
      selectedFacilityIds: incident.selectedFacilityIds,
      selectedFacilityNames: incident.selectedFacilityNames,
      restorationCostPerMonth: incident.restorationCostPerMonth,
    },
    effects: {
      demandMultiplier: 1 - incident.disconnectedDemand,
      facilityOutputMultipliersById: outputMultipliers,
      operatingExpensePerMonth: incident.restorationCostPerMonth,
    },
  };
  state.worldEvents.checkedKeys.push(occurrenceKey);
  state.worldEvents.active.push(occurrence);
  state.worldEvents.occurrences.push(occurrence);
  if (state.worldEvents.checkedKeys.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.checkedKeys.splice(
      0,
      state.worldEvents.checkedKeys.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  if (state.worldEvents.occurrences.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.occurrences.splice(
      0,
      state.worldEvents.occurrences.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  logGameEvent(state, "WORLD_EVENT", message, {
    importance: "CRITICAL",
    actionTarget: occurrence.actionTarget,
    title: occurrence.title,
    concept: occurrence.concept,
    storyPhaseKey: occurrence.key,
    turningPointPriority: 120,
    reportedKey: occurrence.key,
    pause: true,
  });
}

/** Keeps the hazard dedupe and occurrence records bounded, like the authored-story path. */
function trimWorldEventRecords(state: GameType) {
  if (state.worldEvents.checkedKeys.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.checkedKeys.splice(
      0,
      state.worldEvents.checkedKeys.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  if (state.worldEvents.occurrences.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.occurrences.splice(
      0,
      state.worldEvents.occurrences.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
}

// Below this share of the solar fleet, hail on hail-resistant panels is logged without pausing.
const NEGLIGIBLE_RESISTANT_HAIL_SHARE = 0.05;

function formatDays(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Hail and extreme-cold checks at monthly rollover, after the authored story and wildfire, before
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
  // The effects cache keys active events by key, not by their effects, and a cold snap keeps its
  // key and window here. Selling is rare, so dropping the whole cache is the cheap correct fix.
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
    occurrences.map((event) => [event.key, event.attributes]),
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
    state.scenarioId === 104 ||
    state.scenarioId === 111 ||
    (state.scenarioId === 102 &&
      date.monthsElapsed >= 72 &&
      date.monthsElapsed < 96);
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
          ].join(":"),
        )
        .sort()
        .join(";")
    : "";
  return [
    state.scenarioId,
    state.difficulty,
    state.seed,
    date.monthsElapsed,
    fleetKey,
    occurrencesKey(state.worldEvents.occurrences),
  ].join("|");
}

function storyEffectsAt(date: DateType, state: GameType) {
  const activeKey = state.worldEvents.active
    .map((event) => event.key)
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
  const persisted = state.worldEvents.active.filter(
    (event) =>
      date.minute >= event.startsMinute && date.minute < event.endsMinute,
  );
  if (
    state.storyEffectsDisabled ||
    !STORY_ARC_DEFINITIONS.some((arc) => arc.scenarioId === state.scenarioId)
  ) {
    const effects = combineStoryEffects(persisted);
    storyEffectsCache.set(cacheKey, effects);
    return effects;
  }
  const persistedKeys = new Set(persisted.map((event) => event.key));
  const scheduled = resolveStoryAtDate({
    seed: state.seed,
    scenarioId: state.scenarioId,
    difficulty: state.difficulty,
    date,
    location: state.location,
    snapshot: buildStorySnapshot(
      state.monthlyHistory,
      state.facilities,
      date.minute,
    ),
    occurrences: state.worldEvents.occurrences,
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
): FuelPricesType {
  const prices = getFuelPricesPerMBTU(date, state.seed, state.location);
  const multipliers = storyEffectsAt(date, state).fuelPriceMultipliers;
  if (!multipliers) {
    return prices;
  }
  const effective = { ...prices };
  Object.entries(multipliers).forEach(([fuel, multiplier]) => {
    if (multiplier !== undefined && effective[fuel] !== undefined) {
      effective[fuel] *= multiplier;
    }
  });
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
  if (state.speed !== "PAUSED" && !tickLoopRunning) {
    tickLoopRunning = true;
    previousTickMs = performance.now();
    accumulatedTickMs = 0;
    setTimeout(
      () => getStore().dispatch(gameSlice.actions.tick()),
      Math.max(TICK_MS[state.speed], MIN_PRESENTATION_INTERVAL_MS),
    );
  }
}

// Backgrounding is an outer pause: UI transitions still update the speed to restore,
// but may never restart the actual clock until the page is visible.
function foregroundSpeed(state: GameType): SpeedType {
  return speedBeforeHidden ?? state.speed;
}

function setForegroundSpeed(state: GameType, speed: SpeedType) {
  if (speedBeforeHidden !== undefined) {
    speedBeforeHidden = speed;
  } else {
    state.speed = speed;
  }
}

// Puts the clock back the way the player left it before a full-screen card paused it
function restoreSpeedAfterBlockingCard(state: GameType) {
  if (speedBeforeBlockingCard === undefined) {
    return;
  }
  setForegroundSpeed(state, speedBeforeBlockingCard);
  speedBeforeBlockingCard = undefined;
  ensureTicking(state);
}

export const gameSlice = createSlice({
  name: "game",
  initialState: initialGame,
  reducers: {
    tick: (state) => {
      if (!state.inGame || state.speed === "PAUSED") {
        tickLoopRunning = false;
        return;
      }
      tickLoopRunning = true;

      // Accumulate wall time before doing any simulation work. The old loop reset its timestamp
      // inside every iteration, losing both reducer time and the fractional remainder. That made
      // the clock run slower precisely when a frame was expensive. FAST also dispatched at
      // 100Hz; batching its 10ms simulation steps behind a 60Hz presentation ceiling preserves
      // every deterministic tick while giving React at most one update per display frame.
      const nowMs = performance.now();
      accumulatedTickMs += Math.max(0, nowMs - previousTickMs);
      previousTickMs = nowMs;
      const simulationStepMs = TICK_MS[state.speed];
      while (accumulatedTickMs >= simulationStepMs) {
        tickState(state);
        accumulatedTickMs -= simulationStepMs;
        if (!state.inGame || (state.speed as SpeedType) === "PAUSED") {
          tickLoopRunning = false;
          return;
        }
      }

      setTimeout(
        () => getStore().dispatch(gameSlice.actions.tick()),
        Math.max(simulationStepMs, MIN_PRESENTATION_INTERVAL_MS),
      );
    },
    delta: (state, action: PayloadAction<Partial<GameType>>) => {
      // Assigned onto the draft rather than spread into a new object, which is equivalent for a
      // partial merge and is what lets the recorder below append to the draft's own log. Immer
      // rejects a reducer that both mutates its draft and returns a replacement for it
      const {
        policies: _policies,
        policyPause: _policyPause,
        scenarioChoicePause: _scenarioChoicePause,
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
      const recorded = recordedDelta(action.payload);
      const rateBefore = state.dollarsPerkWh;
      Object.assign(state, payload);
      if (recorded && recorded.dollarsPerkWh !== rateBefore) {
        recordMeaningfulDecision(state, {
          lever: "rate",
          label: "Set the customer electricity rate",
          kind: "rate",
          before: String(rateBefore),
          after: String(recorded.dollarsPerkWh),
        });
        recordReplayAction(state, "delta", recorded);
      }
    },
    initGame: (state, action: PayloadAction<NewGameAction>) => {
      delete state.tutorialIntertieStress;
      delete state.policies;
      delete state.policyPause;
      const a = action.payload;
      previouslyInBlackout = false;
      blackoutUnservedWh = 0;
      previousFuelPrices = undefined;
      state.eventLog = [] as GameEventType[];
      state.reportedEventKeys = [];
      state.eventLogReadThroughId = 0;
      state.worldEvents = { active: [], occurrences: [], checkedKeys: [] };
      state.fuelCostSnapshot = undefined;
      state.meaningfulDecisions = [];
      state.transmission = undefined;
      state.timeline = [] as TickPresentFutureType[];
      // A game being watched is not a game being recorded; anything else starts an empty log,
      // which is also what tells serializeReplay the run was recorded from its very first minute
      state.replayLog = state.replayPlayback ? undefined : [];
      state.seed = a.seed !== undefined ? a.seed : newSeed();
      const scenario =
        getScenario(state.scenarioId, state.customScenario) || SCENARIOS[0];
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
        state.replayPlayback
          ? "replay"
          : scenario.tutorialSteps
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
      // repriced against its own results at the first month rollover, and every one after.
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
      state.customerMarketSize = startingCustomers * CUSTOMER_MARKET_MULTIPLIER;
      state.startingDemandScale = scenario.startingDemandScale ?? 1;
      state.loadAdditions = cloneDeep(scenario.loadAdditions || []);
      state.location = a.location;
      state.commissionedHydroSiteIds = [];
      const hydroAssignments = resolveStartingHydroSites(
        state.location,
        startingFacilities,
        getHydroInventoryKey(state),
      );
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
            hydroSiteId: _hydroSiteId,
            initialAgeYears = 0,
            initialReservoirFraction,
            label,
            ...facilitySearch
          } = search;
          // Scenario research may carry more precision than is useful to a player. Resolve the
          // catalog quote from the rounded size so its costs and technology-derived fields agree
          // with the two-significant-digit nameplate the operating facility receives.
          if (
            facilitySearch.peakW !== undefined &&
            facilitySearch.name !== "Hydro" &&
            facilitySearch.fuel !== "Hydro"
          ) {
            facilitySearch.peakW = roundToSignificantDigits(
              facilitySearch.peakW,
              2,
            );
          }
          if (facilitySearch.peakWh !== undefined) {
            facilitySearch.peakWh = roundToSignificantDigits(
              facilitySearch.peakWh,
              2,
            );
          }
          const generator = GENERATORS(
            state,
            facilitySearch.peakW || 1000000,
            [],
            [],
          ).find((g: FacilityShoppingType) =>
            matchesFacilitySearch(g, facilitySearch),
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
            if (label) {
              const built = state.facilities.find(
                ({ id }) => !existingIds.has(id),
              );
              if (built) {
                built.name = label;
              }
            }
          } else {
            const storage = STORAGE(
              state,
              facilitySearch.peakWh || 1000000,
            ).find((g: FacilityShoppingType) =>
              matchesFacilitySearch(g, facilitySearch),
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
              if (label) {
                const built = state.facilities.find(
                  ({ id }) => !existingIds.has(id),
                );
                if (built) {
                  built.name = label;
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

      // The first blank timeline is created before the authored fleet is resolved. Hydrology is
      // intentionally skipped for a fleet with no Hydro, so refresh it now that a starting dam
      // may exist; otherwise its first forecast has zero inflow for every month.
      if (state.facilities.some((facility) => facility.fuel === "Hydro")) {
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
      // Establish the comparison before time moves. A fleet that was already dearer on day one
      // has not crossed anything; the first monthly ordering change is the event.
      state.fuelCostSnapshot = currentFuelCosts(state);
      // Anything the player did before the clock first moved -- setting a rate on the way in.
      // tickState picks up everything after this
      applyPendingReplayActions(state);
    },
    buildFacility: (state, action: PayloadAction<BuildFacilityAction>) => {
      if (applyBuildFacility(state, action.payload)) {
        recordReplayAction(state, "buildFacility", action.payload);
      }
    },
    buildTransmissionLine: (
      state,
      action: PayloadAction<BuildTransmissionLineAction>,
    ) => {
      if (applyBuildTransmissionLine(state, action.payload)) {
        recordReplayAction(state, "buildTransmissionLine", action.payload);
      }
    },
    upgradeTransmissionLine: (
      state,
      action: PayloadAction<UpgradeTransmissionLineAction>,
    ) => {
      if (applyUpgradeTransmissionLine(state, action.payload)) {
        recordReplayAction(state, "upgradeTransmissionLine", action.payload);
      }
    },
    setTradingPolicy: (state, action: PayloadAction<TradingPolicyType>) => {
      if (applyTradingPolicy(state, action.payload)) {
        recordReplayAction(state, "setTradingPolicy", action.payload);
      }
    },
    sellFacility: (state, action: PayloadAction<number>) => {
      if (applySellFacility(state, action.payload)) {
        recordReplayAction(state, "sellFacility", action.payload);
      }
    },
    togglePauseFacility: (state, action: PayloadAction<number>) => {
      if (applyTogglePauseFacility(state, action.payload)) {
        recordReplayAction(state, "togglePauseFacility", action.payload);
      }
    },
    reprioritizeFacility: (
      state,
      action: PayloadAction<ReprioritizeFacilityAction>,
    ) => {
      if (applyReprioritizeFacility(state, action.payload)) {
        recordReplayAction(state, "reprioritizeFacility", action.payload);
      }
    },
    retrofitFacility: (
      state,
      action: PayloadAction<RetrofitFacilityAction>,
    ) => {
      if (
        !state.replayPlayback &&
        applyRetrofitFacility(state, action.payload)
      ) {
        recordReplayAction(state, "retrofitFacility", action.payload);
      }
    },
    setSpeed: (state, action: PayloadAction<SpeedType>) => {
      if (
        state.tutorialIntertieStress?.active &&
        !state.replayPlayback &&
        state.tutorialStep < 18 &&
        action.payload !== "PAUSED"
      )
        return;
      if (pendingScenarioChoice(state) && action.payload !== "PAUSED") return;
      delete state.policyPause;
      // Global keyboard shortcuts still fire over full-screen cards. Keep their quotes and
      // instructions frozen until the player actually closes the card. A backgrounded page
      // freezes the same way: pageVisible is the caller that resumes it.
      if (
        (speedBeforeBlockingCard !== undefined ||
          speedBeforeManualHelp !== undefined ||
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
    builder.addCase(beginIntertieStress, (state) => {
      if (
        state.scenarioId !== 112 ||
        state.customScenario ||
        state.tutorialStep !== 15 ||
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
      recordReplayAction(state, "beginIntertieStress", null);
    });
    builder.addCase(launchRun, (_state, action) => {
      const { identity, challenge } = action.payload;
      if (!projectAuthoredRunReference(identity)) return;
      speedBeforeBlockingCard = undefined;
      speedBeforeManualHelp = undefined;
      speedBeforeHidden = undefined;
      speedBeforeDialog = "PAUSED";
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
      state.runIdentity = undefined;
      state.challenge = undefined;
      state.scenarioId = action.payload;
      // An empty timeline is how the loading screen tells a new game from a resumed one, so make
      // that true by construction rather than by whichever paths happen to lead here
      state.timeline = [] as TickPresentFutureType[];
    });
    builder.addCase(resume, (_state, action) => {
      const restored = cloneDeep(action.payload);
      // cloneDeep drops the non-enumerable commitment forecast parseSave reattached
      action.payload.timeline.forEach((tick, i) =>
        copyCommitmentMetadata(tick, restored.timeline[i]),
      );
      // The tick loop's remaining module-level locals have to line up with restored state.
      const now = getTimeFromTimeline(restored.date.minute, restored.timeline);
      previouslyInBlackout = now ? now.supplyW < now.demandW : false;
      blackoutStartMinute = restored.date.minute;
      blackoutUnservedWh = 0;
      previousFuelPrices = undefined;
      speedBeforeDialog = "PAUSED";
      speedBeforeBlockingCard = undefined;
      speedBeforeManualHelp = undefined;
      speedBeforeHidden = undefined;
      // Never resume mid-tick; loaded() flips inGame once the CSVs are back
      restored.speed = "PAUSED";
      restored.inGame = false;
      // Nothing ever autosaves a replay, so anything here came out of a hand-edited save
      restored.replayPlayback = undefined;
      // tickLoopRunning is deliberately left alone: any loop still alive clears the flag and stops
      // on its next tick, since tick() bails while !inGame or PAUSED
      return restored;
    });
    /**
     * Sets a replay up to be watched. Nothing is simulated here: this only puts the scenario, the
     * location, the difficulty and the seed in place, then hands over to the loading screen, which
     * reloads the data files and calls initGame the same way it does for a new game.
     */
    builder.addCase(startReplay, (_state, action) => {
      const replay = action.payload;
      speedBeforeBlockingCard = undefined;
      speedBeforeManualHelp = undefined;
      speedBeforeHidden = undefined;
      speedBeforeDialog = "PAUSED";
      return {
        ...cloneDeep(initialGame),
        scenarioId: replay.scenarioId,
        difficulty: replay.difficulty,
        seed: replay.seed,
        // The loading screen reads this back rather than looking the scenario's location up,
        // which is what makes the replay run against the weather the original player saw
        location: cloneDeep(replay.location),
        meaningfulDecisionGateWaived: !!replay.meaningfulDecisionGateWaived,
        replayPlayback: { actions: cloneDeep(replay.actions), index: 0 },
      };
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
        const generator = facility as GeneratorOperatingType;
        return (
          !facility.peakWh &&
          (generator.minimumStableOutput || 0) > 0 &&
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
      speedBeforeBlockingCard = undefined;
      speedBeforeManualHelp = undefined;
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
      } else if (state.inGame && speedBeforeBlockingCard === undefined) {
        speedBeforeBlockingCard =
          state.policyPause?.speed ?? foregroundSpeed(state);
        delete state.policyPause;
        setForegroundSpeed(state, "PAUSED");
      }
    });
    builder.addCase(navigateBack, (state, action) => {
      if (!action.payload || !BLOCKING_CARDS.has(action.payload))
        restoreSpeedAfterBlockingCard(state);
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
    builder.addCase(dialogOpen, (state) => {
      delete state.policyPause;
      speedBeforeDialog = foregroundSpeed(state);
      setForegroundSpeed(state, "PAUSED");
    });
    builder.addCase(dialogClose, (state) => {
      setForegroundSpeed(state, speedBeforeDialog);
      ensureTicking(state);
    });
    builder.addCase(chooseScenarioResponse, (state, action) => {
      if (
        !state.replayPlayback &&
        applyScenarioResponse(state, action.payload)
      ) {
        recordReplayAction(state, "chooseScenarioResponse", action.payload);
        if (
          !pendingScenarioChoice(state) &&
          state.scenarioChoicePause !== undefined
        ) {
          setForegroundSpeed(state, state.scenarioChoicePause);
          delete state.scenarioChoicePause;
          ensureTicking(state);
        }
      }
    });
    builder.addCase(schedulePolicy, (state, action) => {
      if (
        !state.replayPlayback &&
        applyPolicyEdit(state, action.payload, false)
      )
        recordReplayAction(state, "schedulePolicy", action.payload);
    });
    builder.addCase(cancelPolicy, (state, action) => {
      if (!state.replayPlayback && applyPolicyEdit(state, action.payload, true))
        recordReplayAction(state, "cancelPolicy", action.payload);
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
  sellFacility,
  togglePauseFacility,
  reprioritizeFacility,
  retrofitFacility,
  setTradingPolicy,
  setSpeed,
  markEventsRead,
} = gameSlice.actions;

// Re-exported so that everything still imports the game's actions from one place
export { start, loaded, quit, resume, startReplay };

export default gameSlice.reducer;

// ====== HELPERS ======

/**
 * The simulation-affecting player actions, as plain functions of (state, payload).
 *
 * Both the reducers above and replay playback go through these, which is what makes a replay
 * reproduce the original run rather than an approximation of it: there is one implementation of
 * "the player built a plant", not two that have to be kept in step.
 */
function matchesFacilitySearch(
  candidate: FacilityShoppingType,
  search: Partial<FacilityShoppingType>,
): boolean {
  if (candidate.viableLocationsRemaining === 0) {
    return false;
  }
  return Object.keys(search).every(
    (property: string) => candidate[property] === search[property],
  );
}

function applyBuildFacility(
  state: GameType,
  payload: BuildFacilityAction,
): boolean {
  if (!validBuildFacility(payload)) return false;
  const requested = payload.facility;
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
  const amountDue = payload.financed
    ? built.buildCost * DOWNPAYMENT_PERCENT
    : built.buildCost;
  // The dialog's quote can be stale by the time an action lands (or a replay/import can be
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
  // a stale dialog or replay action from claiming one more site after the last one was used.
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
      ? `Cancelled construction of ${sold.name}`
      : `Sold ${sold.name}, ${sold.peakWh ? formatWattHours(sold.peakWh) : formatWatts(sold.peakW)} for ${formatMoneyConcise(facilityCashBack(sold, state.date.minute))}`,
  );
  const ownedState = `${sold.name}:${sold.peakWh ?? sold.peakW}:${sold.financed ? "financed" : "cash"}`;
  endWeatherHazardsForFacility(state, id);
  // in one loop, refund cash from selling + remove from list
  state.facilities = state.facilities.filter(
    (g: GeneratorOperatingType | StorageOperatingType) => {
      if (g.id === id) {
        const now = getTimeFromTimeline(state.date.minute, state.timeline);
        if (now) {
          now.cash += facilityCashBack(g, state.date.minute);
        }
        return false;
      }
      return true;
    },
  );
  if (isMaterialCapacityDecision(state, sold.peakW)) {
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
  payload: ReprioritizeFacilityAction,
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
  const amountDue = financed
    ? corridor.buildCost * DOWNPAYMENT_PERCENT
    : corridor.buildCost;
  if (now.cash < amountDue) return false;
  now.cash -= amountDue;
  const loanAmount = financed ? corridor.buildCost - amountDue : 0;
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
    loanMonthlyPayment: financed
      ? getMonthlyPayment(loanAmount, state.interestRate, LOAN_MONTHS)
      : 0,
    interestRate: financed ? state.interestRate : 0,
    // Nothing flows until the line is energised, which is years away
    currentFlowW: 0,
    constructionKgco2eTotal: corridor.constructionKgco2eTotal,
  };
  state.transmission.lines.push(line);
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
  if (!line || !now || line.yearsToBuildLeft > 0 || line.upgrade) return false;
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
  const amountDue = financed
    ? quote.buildCost * DOWNPAYMENT_PERCENT
    : quote.buildCost;
  if (now.cash < amountDue) return false;
  now.cash -= amountDue;
  const loanAmount = financed ? quote.buildCost - amountDue : 0;
  if (financed) {
    // One line, one loan. Rolling the new borrowing into the existing balance at the current
    // rate is the same treatment a facility's build loan gets, and it keeps a widened line from
    // needing a second schedule of its own.
    line.loanAmountLeft += loanAmount;
    line.loanMonthlyPayment = getMonthlyPayment(
      line.loanAmountLeft,
      state.interestRate,
      LOAN_MONTHS,
    );
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

/**
 * Adds a weather-resilience upgrade to a standing facility, for live play and replay. The price is
 * recomputed here from current state rather than trusted from the dialog. Like an authored
 * scenario choice, the cost is booked immediately into this tick and recorded as a zero-length
 * occurrence, so a re-forecast from the current tick re-adds it to the new frame exactly once.
 */
function applyRetrofitFacility(state: GameType, payload: unknown): boolean {
  if (!validRetrofitFacility(payload)) return false;
  const facility = state.facilities.find(({ id }) => id === payload.facilityId);
  if (!facility || facility.yearsToBuildLeft > 0) return false;
  const cost = retrofitCost(facility, state, payload.upgrade);
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (cost === undefined || !Number.isFinite(cost) || cost < 0 || !now)
    return false;
  if (now.cash < cost) return false;
  now.cash -= cost;
  now.netWorth -= cost;
  now.expensesOM += cost;
  facility.lifetimeExpenses = (facility.lifetimeExpenses || 0) + cost;
  facility.resilience = retrofittedResilience(facility, state, payload.upgrade);
  const label =
    payload.upgrade === "hailResistant"
      ? "hail-resistant panels"
      : "a cold-weather package";
  const key = `retrofit:${facility.id}:${payload.upgrade}`;
  state.worldEvents.occurrences.push({
    key,
    definitionId: key,
    startsMinute: state.date.minute,
    endsMinute: state.date.minute,
    attributes: {
      retrofit: true,
      facilityId: facility.id,
      upgrade: payload.upgrade,
      cost,
    },
    effects: {},
  });
  if (state.worldEvents.occurrences.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.occurrences.splice(
      0,
      state.worldEvents.occurrences.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
  logGameEvent(
    state,
    "BUILD",
    `Added ${label} to ${facility.name} for ${formatMoneyConcise(cost)}.`,
    {
      importance: "NOTABLE",
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    },
  );
  // Levers are lowercase kebab-case; saves reject anything else.
  const lever =
    payload.upgrade === "hailResistant"
      ? "hail-resistant"
      : "cold-weather-package";
  recordMeaningfulDecision(state, {
    lever: `resilience:${facility.id}:${lever}`,
    label: `Add ${label} to ${facility.name}`,
    kind: "asset",
    before: "standard",
    after: lever,
  });
  state.timeline = reforecastSupply(state, true);
  return true;
}

/** Accepts one authored choice for live play, replay and headless simulation. */
function applyScenarioResponse(state: GameType, payload: unknown): boolean {
  if (!validScenarioResponse(payload)) return false;
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
  now.cash += upfrontGrant - cost;
  now.netWorth += upfrontGrant - cost;
  now.revenue += upfrontGrant;
  now.expensesOM += cost;
  if (option.loadAdditions)
    state.loadAdditions = cloneDeep(option.loadAdditions);
  state.worldEvents.occurrences.push({
    key: decision.id,
    definitionId: decision.id,
    startsMinute: state.date.minute,
    endsMinute: state.date.minute,
    attributes: { choice: option.id, cost, upfrontGrant, scenarioChoice: true },
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

function applyReplayAction(state: GameType, entry: ReplayActionType) {
  const payload = entry.payload;
  switch (entry.type) {
    case "beginIntertieStress":
      if (
        state.scenarioId === 112 &&
        !state.customScenario &&
        !state.tutorialIntertieStress
      ) {
        state.tutorialIntertieStress = {
          active: true,
          startsMinute: state.date.minute,
          suppliedTicks: 0,
          completed: false,
        };
        state.timeline = reforecastSupply(state, true);
      }
      break;
    case "chooseScenarioResponse":
      applyScenarioResponse(state, payload);
      break;
    case "retrofitFacility":
      applyRetrofitFacility(state, payload);
      break;
    case "schedulePolicy":
    case "cancelPolicy":
      applyPolicyEdit(state, payload, entry.type === "cancelPolicy");
      break;
    case "buildFacility": {
      if (validBuildFacility(payload)) applyBuildFacility(state, payload);
      break;
    }
    case "buildTransmissionLine": {
      const build = payload as Partial<BuildTransmissionLineAction>;
      applyBuildTransmissionLine(state, build);
      break;
    }
    case "upgradeTransmissionLine": {
      const upgrade = payload as Partial<UpgradeTransmissionLineAction>;
      applyUpgradeTransmissionLine(state, upgrade);
      break;
    }
    case "setTradingPolicy":
      applyTradingPolicy(state, payload);
      break;
    case "sellFacility":
      if (typeof payload === "number") {
        applySellFacility(state, payload);
      }
      break;
    case "togglePauseFacility":
      if (typeof payload === "number") {
        applyTogglePauseFacility(state, payload);
      }
      break;
    case "reprioritizeFacility": {
      const move = payload as Partial<ReprioritizeFacilityAction>;
      if (Number.isFinite(move?.spotInList) && Number.isFinite(move?.delta)) {
        applyReprioritizeFacility(state, move as ReprioritizeFacilityAction);
      }
      break;
    }
    case "delta": {
      const recorded = recordedDelta((payload || {}) as Partial<GameType>);
      if (
        recorded?.dollarsPerkWh !== undefined &&
        recorded.dollarsPerkWh !== state.dollarsPerkWh
      ) {
        const before = state.dollarsPerkWh;
        Object.assign(state, recorded);
        recordMeaningfulDecision(state, {
          lever: "rate",
          label: "Set the customer electricity rate",
          kind: "rate",
          before: String(before),
          after: String(recorded.dollarsPerkWh),
        });
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Applies every recorded action the clock has reached. Called from inside the tick rather than
 * from a store subscriber because at FAST speed one dispatch of `tick` runs several ticks, and a
 * subscriber would only see the last of them -- every action in between would land late.
 */
function applyPendingReplayActions(state: GameType) {
  const playback = state.replayPlayback;
  if (!playback) {
    return;
  }
  while (
    playback.index < playback.actions.length &&
    playback.actions[playback.index].minute <= state.date.minute
  ) {
    applyReplayAction(state, playback.actions[playback.index]);
    playback.index++;
  }
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
  const played = getPlayedScenarioIds();
  const completed = TUTORIALS.filter(
    (t: ScenarioType) => played.indexOf(t.id) !== -1,
  ).length;
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
        <strong>
          {completed} of {TUTORIALS.length} missions complete
        </strong>
        {nextTutorial && (
          <span>
            <br />
            Up next: {nextTutorial.name}
          </span>
        )}
      </div>
    ),
    open: true,
    // Both buttons lead somewhere; dismissing would strand the player in a finished scenario
    notCancellable: true,
    secondaryLabel: "Back to main menu",
    secondaryAction: () => getStore().dispatch(quit()),
    actionLabel: nextTutorial ? "Next tutorial" : undefined,
    action: nextTutorial
      ? () => startTutorial(getStore().dispatch, nextTutorial.id)
      : undefined,
  });
}

// Ticks the state forward in place
// Exported so the headless simulator (src/testing/Simulator.tsx) can drive the sim
// without the wall-clock timers that the `tick` action uses.
export function tickState(state: GameType) {
  if (
    state.tutorialIntertieStress?.active &&
    !state.replayPlayback &&
    state.tutorialStep < 18
  ) {
    state.speed = "PAUSED";
    return;
  }
  const speedBeforeTick = foregroundSpeed(state);
  const stressWasActive = !!state.tutorialIntertieStress?.active;
  applyPendingReplayActions(state);
  if (pendingScenarioChoice(state)) {
    state.scenarioChoicePause ??= speedBeforeTick;
    setForegroundSpeed(state, "PAUSED");
    return;
  }
  state.date = getDateFromMinute(
    state.date.minute + TICK_MINUTES,
    state.startingYear,
  );
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  const prev = getTimeFromTimeline(
    state.date.minute - TICK_MINUTES,
    state.timeline,
  );
  if (now && prev) {
    updateSupplyFacilitiesFinances(state, prev, now);
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
    const inBlackout = now.supplyW < now.demandW;
    if (inBlackout) {
      // What the lights being out is actually costing, in the same units the score is docked in.
      // Accumulated per tick rather than worked out at the end, since the gap moves the whole
      // time the blackout lasts
      blackoutUnservedWh +=
        ((now.demandW - now.supplyW) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
    }
    if (inBlackout !== previouslyInBlackout) {
      previouslyInBlackout = inBlackout;
      if (inBlackout) {
        blackoutStartMinute = state.date.minute;
        blackoutUnservedWh = 0;
        logGameEvent(state, "BLACKOUT", "Blackout: demand outran your supply");
      } else {
        // The toast that says this vanishes in four seconds and the pulsing bar stops the moment
        // it's over, so without this a player who was looking elsewhere never learns what it cost
        logGameEvent(
          state,
          "BLACKOUT_OVER",
          `Blackout ended after ${blackoutLength(state.date.minute - blackoutStartMinute)}. The grid could not supply ${formatWattHours(blackoutUnservedWh)} of electricity demand.`,
        );
      }
      const message = inBlackout
        ? "Blackout! Demand is outrunning your supply."
        : "Blackout over - supply is meeting demand again.";
      setTimeout(() => {
        // Pausing a plant is the usual way into a blackout, and it raises its own "Paused X /
        // UNDO" toast. There's only one snackbar slot, so stealing it would take the undo away
        // at the exact moment the player most wants it. The pulsing top bar and the red sky band
        // already carry the blackout, so this toast yields rather than competes.
        if (getStore().getState().ui.snackbar.open) {
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
    if (history.length < state.date.monthsElapsed) {
      const { cash, customers } = now;
      state.customerRate = now.customerRate;

      // Record final history for the month, then generate the new timeline
      history.unshift(summarizeTimeline(state.timeline, state.startingYear));
      // Reprice the company's credit off the year that just closed, before the forecast is built
      // against it. Once a month, not once a tick: a lender looks at a year of results, and a
      // rate that moved every tick would be unplannable.
      state.creditPremium = getCreditPremium(
        getCreditInputs(
          history,
          cash,
          now.netWorth,
          state.facilities,
          state.transmission?.lines,
        ),
      );
      state.interestRate =
        getPrimeRate(state.date, state.seed) * state.creditPremium;
      const storyPriceFuels = updateWorldEvents(state);
      // The recurring regional hazard resolves on its own path, after the authored story, so a
      // custom game in a profiled area can meet a wildfire without inheriting any authored arc.
      updateWildfireHazards(state);
      updateWeatherHazards(state).forEach((fuel) => storyPriceFuels.add(fuel));
      const activatedPrograms = advancePolicies(
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
      state.timeline = generateNewTimeline(state, cash, customers);
      logFuelPriceMoves(state, storyPriceFuels);
      logFuelCrossovers(state);

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

      // ===== TRIGGERS ======
      // state is an Immer draft, and it's revoked the moment this reducer returns - so anything
      // the timeouts below need has to be read out here rather than from inside their callbacks
      const scenarioId = state.scenarioId;
      // A replay reaches every one of these the same way the original run did, and must set off
      // none of their side effects: it is not a played game, it has no score of its own to
      // submit, and the save it would clear belongs to whoever is watching. Its end screen still
      // shows, since a replay ending with "Bankrupt!" is the point of watching it
      const isReplay = !!state.replayPlayback;
      const scenario =
        getScenario(state.scenarioId, state.customScenario) || SCENARIOS[0];
      const isTutorial = Boolean(scenario.tutorialSteps);
      const activeTutorialCapstone = Boolean(
        scenario.tutorialSteps?.[state.tutorialStep]?.capstone,
      );
      // The leaderboard is keyed on scenario id alone, so custom runs - whatever cash, duration
      // and rules the player gave themselves - would be scored against each other as if they
      // were the same scenario. Replays likewise belong to the original player, not the viewer.
      const ranked = scenario.id !== CUSTOM_SCENARIO_ID && !isReplay;

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
        const score: ScoreBreakdownType = computeScoreBreakdown(
          scenario,
          summary,
        );
        const finalScore = totalScore(score);
        const difficulty = state.difficulty;
        const { id: scoredScenarioId, name: scenarioName } = scenario;
        const submitsScore = ranked;
        const runIdentity = state.runIdentity
          ? cloneDeep(state.runIdentity)
          : undefined;
        const challenge = state.challenge
          ? cloneDeep(state.challenge)
          : undefined;
        const replay = submitsScore ? serializeReplay(state) : undefined;
        const debrief = buildVictoryDebrief(
          scenario,
          summary,
          state.facilities,
          state.eventLog,
          state.monthlyHistory,
          state.dollarsPerkWh,
        );

        if (!isReplay) {
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
        }
        setTimeout(() => {
          // In the timeout rather than here in the reducer: the autosave subscriber runs as soon
          // as this returns and would write the run straight back
          if (!isReplay) {
            clearSaveFor(scenarioId);
          }
          // Read before the submit below, so "was 640" means the run before this one rather than
          // the one that just finished. getState() cannot be called while the reducer is running.
          const previousBest =
            getStore().getState().user.bests?.[String(scoredScenarioId)]?.score;
          getStore().dispatch(
            victoryOpen({
              runIdentity,
              challenge,
              scenarioId: scoredScenarioId,
              scenarioName,
              difficulty,
              score: finalScore,
              breakdown: score,
              endTitle,
              endMessage:
                typeof endMessage === "function" ? endMessage() : endMessage,
              ranked,
              previousBest,
              outcome,
              debrief,
            }),
          );
          if (submitsScore) {
            getStore().dispatch(
              submitHighscore({
                score: finalScore,
                scoreBreakdown: score, // For analytics purposes only
                scenarioId: scoredScenarioId,
                difficulty,
                replay,
              }),
            );
          }
        }, 1);
      };

      const chronicBlackouts = hasChronicBlackouts(history);
      const objectiveFailure =
        state.date.monthsElapsed === (scenario.durationMonths || 12 * 20)
          ? scenarioObjectiveFailure(
              scenario,
              history,
              state.difficulty,
              state.meaningfulDecisions,
              !!state.meaningfulDecisionGateWaived,
            )
          : undefined;
      const failure =
        now.cash < 0
          ? ({
              outcome: "bankrupt",
              title: "Bankrupt!",
              reason: undefined,
            } as const)
          : chronicBlackouts
            ? ({
                outcome: "fired",
                title: "Fired!",
                reason:
                  "Blackouts continued for 3 months, so the utility board ended your term.",
              } as const)
            : objectiveFailure
              ? ({
                  outcome: "fired",
                  title: "Mission objective missed",
                  reason: objectiveFailure,
                } as const)
              : undefined;

      if (failure) {
        const summary = summarizeHistory(history);
        const yearsSurvived = state.date.year - state.startingYear;
        const failureMessage = () =>
          `${
            failure.outcome === "bankrupt"
              ? "You've run out of money."
              : failure.reason
          }
                You survived for ${yearsSurvived} years,
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${formatLargeMass(summary.kgco2e, getStore().getState().settings.units)} of greenhouse gases, measured as CO2e.`;

        // Tutorials are intentionally unscored even when completed, so retain their guided
        // failure dialog rather than putting one tutorial attempt on the global leaderboard.
        if (isTutorial) {
          if (!isReplay) {
            logEvent("scenario_end", {
              id: scenarioId,
              type: failure.outcome === "fired" ? "blackouts" : "bankrupt",
              difficulty: state.difficulty,
            });
          }
          setTimeout(() => {
            if (!isReplay) {
              clearSaveFor(scenarioId);
            }
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
            const score = computeScoreBreakdown(scenario, summary);
            const finalScore = totalScore(score);
            const { id: scoredScenarioId, endTitle, endMessage } = scenario;
            const difficulty = state.difficulty;
            const nextTutorial = getNextTutorial(scoredScenarioId);
            if (!isReplay) {
              logEvent("scenario_end", {
                id: scoredScenarioId,
                type: "win",
                difficulty,
                score: finalScore,
              });
            }
            setTimeout(() => {
              if (!isReplay) {
                clearSaveFor(scenarioId);
              }
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

  // After the tick, the way a player's click lands after the tick that brought the clock to it
  applyPendingReplayActions(state);
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
  const sun = getSunriseSunset(date, game.location);

  // https://www.eia.gov/todayinenergy/detail.php?id=830
  // https://www.e-education.psu.edu/ebf200/node/151
  // Demand estimation: http://www.iitk.ac.in/npsc/Papers/NPSC2016/1570293957.pdf
  // Pricing estimation: http://www.stat.cmu.edu/tr/tr817/tr817.pdf
  const minutesFromDarkNormalized =
    sun.daylight === "polar-day"
      ? 1
      : sun.daylight === "polar-night"
        ? -1
        : Math.min(
            date.minuteOfDay - sun.sunrise,
            sun.sunset - date.minuteOfDay,
          ) / 420;
  const minutesFromDarkLogistics =
    1 / (1 + Math.pow(Math.E, -minutesFromDarkNormalized * 6));
  const minutesFrom9amNormalized = Math.abs(date.minuteOfDay - 540) / 120;
  const minutesFrom9amLogistics =
    1 / (1 + Math.pow(Math.E, -minutesFrom9amNormalized * 2));
  const minutesFrom5pmNormalized = Math.abs(date.minuteOfDay - 1020) / 240;
  const minutesFrom5pmLogistics =
    1 / (1 + Math.pow(Math.E, -minutesFrom5pmNormalized * 2));
  const demandMultiple =
    430 +
    temperatureDemandWattsPerCustomer(now.temperatureC, game.location) -
    40 * minutesFrom9amLogistics +
    30 * minutesFromDarkLogistics -
    65 * minutesFrom5pmLogistics;
  const effects = storyEffectsAt(date, game);
  const baselineDemandW =
    demandMultiple *
    now.customers *
    game.startingDemandScale *
    (effects.demandMultiplier || 1);
  now.demandByType = demandByTypeAt(
    baselineDemandW,
    date,
    game.startingYear,
    game.location,
    game.loadAdditions,
  );
  applyPolicyDemand(game, now);
  applyPeakDemand(
    game,
    now,
    prev.deferredResidential,
    TICK_MINUTES * tickScale,
  );
  now.customerBillingRate = customerBillingRate(game, now);
  return DEMAND_TYPES.reduce(
    (total, type) => total + now.demandByType[type],
    0,
  );
}

function reforecastWeatherAndPrices(state: GameType): TickPresentFutureType[] {
  // Resource forecasts are also shown before the player builds a hydro plant.
  const hasHydro =
    (getViableLocationCount(state.location, "Hydro") || 0) > 0 ||
    state.facilities.some((facility) => facility.fuel === "Hydro");
  const watershedId = state.location.watershedId || state.location.id;
  const hydrologyByMonth = new Map<
    string,
    ReturnType<typeof getHydroConditions>
  >();
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      const weather = getWeather(date, state.seed);
      const fuelPrices = getEffectiveFuelPrices(date, state);
      const effects = storyEffectsAt(date, state);
      const hydroKey = `${date.year}-${date.monthNumber}`;
      let hydrology = hydrologyByMonth.get(hydroKey);
      if (!hydrology) {
        hydrology = hasHydro
          ? getHydroConditions(date, state.seed, 0, watershedId)
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
): TickPresentFutureType[] {
  const projection = { ...state, policies: cloneDeep(state.policies) };
  let prev = {
    ...state.timeline[0],
    deferredResidential: initialDeferred,
  } as TickPresentFutureType;
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      advancePolicies(projection, date.monthsElapsed);
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

/** Variable cost of holding one generator at its minimum stable output for one game tick. */
function minimumStableOperatingCost(
  state: GameType,
  generator: GeneratorOperatingType,
  tick: TickPresentFutureType,
  stepMinutes = TICK_MINUTES,
): number {
  const ticksPerHour = 60 / stepMinutes;
  const minimumW = generator.peakW * (generator.minimumStableOutput || 0);
  const generatedWh = (minimumW / ticksPerHour) * GAME_TO_REAL_YEARS;
  const tickDate = getDateFromMinute(tick.minute, state.startingYear);
  const operatingCostMultiplier =
    storyEffectsAt(tickDate, state).operatingCostMultipliersByFuel?.[
      generator.fuel
    ] || 1;
  const variableOM =
    (generatedWh / 1000000) *
    (generator.variableOperatingCostPerMWh || 0) *
    operatingCostMultiplier;
  const fuel = FUELS[generator.fuel];
  if (!fuel) {
    return variableOM;
  }
  const fuelBtu =
    ((minimumW * (generator.btuPerWh || 0)) / ticksPerHour) *
    GAME_TO_REAL_YEARS;
  const fuelCost = (fuelBtu * (tick[generator.fuel] ?? 0)) / 1000000;
  const carbonCost =
    fuelBtu * fuel.kgCO2ePerBtu * effectiveCarbonFee(tickDate, state);
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
function updateSupplyFacilitiesFinances(
  state: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
  simulated?: boolean,
  preRoll?: boolean,
  optimizeCommitment = true,
  stepMinutes = TICK_MINUTES,
  advanceConstruction = true,
) {
  const { facilities, date } = state;
  const tickScale = stepMinutes / TICK_MINUTES;
  const ticksPerHour = 60 / stepMinutes;
  const ticksPerMonth = TICKS_PER_MONTH / tickScale;
  const ticksPerYear = TICKS_PER_YEAR / tickScale;
  const tickDate = getDateFromMinute(now.minute, state.startingYear);
  const difficulty = DIFFICULTIES[state.difficulty];

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
        if (!simulated) {
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
  let supply = 0;
  let spareGenerationW = 0;
  let reachableHeadroomW = 0;
  const supplyByFuel = {} as FuelProductionType;
  let charge = 0;
  let dischargedW = 0;
  let storedWh = 0;
  let storageLossWh = 0;
  let hydroReservoirWh = 0;
  let hydroReservoirCapacityWh = 0;
  let hydroSpillWh = 0;
  let hydroMandatedReleaseW = 0;
  const startedFacilityIds = new Set<number>();
  const tickStoryEffects = storyEffectsAt(tickDate, state);
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    const previousW = g.currentW;
    const generator = g as GeneratorOperatingType;
    const hasMinimumStableOutput =
      !g.peakWh && (generator.minimumStableOutput || 0) > 0;
    const previouslyCommitted = simulated
      ? (generator.committed ?? previousW > 0)
      : (generator.generatingLastRealTick ??
        generator.committed ??
        previousW > 0);
    const generatorFuel = generator.fuel as FuelNameType | undefined;
    const fuelOutputMultiplier = generatorFuel
      ? (tickStoryEffects.facilityOutputMultipliersByFuel?.[generatorFuel] ?? 1)
      : 1;
    const facilityOutputMultiplier =
      tickStoryEffects.facilityOutputMultipliersById?.[String(g.id)] ?? 1;
    const availablePeakW =
      g.peakW * fuelOutputMultiplier * facilityOutputMultiplier;
    let dispatchPeakW = availablePeakW;
    const outputFactor = facilityOutputFactor(g, now.minute);
    let mandatedW = 0;
    const hydro = g.fuel === "Hydro" && !!g.reservoirCapacityWh;
    const storage = !!g.peakWh && g.yearsToBuildLeft === 0;
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
        g.currentWh * (1 - Math.pow(1 - g.hourlyLoss, 1 / ticksPerHour));
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
            g.currentW = availablePeakW * outputFactor * solarOutputFactor;
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
          g.currentW = Math.min(g.peakW, targetW, g.currentWh * ticksPerHour);
          g.currentWh = Math.max(0, g.currentWh - g.currentW / ticksPerHour);
          supply += g.currentW;
          dischargedW += g.currentW;
        } else if (g.currentWh < g.peakWh && supply - charge > now.demandW) {
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
      if (g.peakWh) {
        const dischargeW = Math.min(g.peakW, g.currentWh * TICKS_PER_HOUR);
        const currentGridW =
          g.currentW < 0 ? g.currentW / g.roundTripEfficiency : g.currentW;
        reachableHeadroomW += Math.max(0, dischargeW - currentGridW);
      } else if (
        !["Sun", "Wind", "Offshore Wind", "Airborne Wind"].includes(g.fuel)
      ) {
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
  const operatingLines = transmission.lines.filter(
    ({ yearsToBuildLeft }) => yearsToBuildLeft <= 0,
  );
  const intertieContext = intertieContextForGame(state);
  let transmissionCapacity = 0;
  let marketImportLimitW = 0;
  let marketExportLimitW = 0;
  const offers: (IntertieOffer & { emissionsKgco2ePerMWh: number })[] = [];
  for (const line of operatingLines) {
    const rating = transmissionRatingW(line, now);
    const market = effectiveMarket(line.corridorId, intertieContext);
    const pricePerMWh = adjacentMarketPricePerMWh(
      line.corridorId,
      intertieContext,
      now.minute,
      now,
    );
    // The neighbour's archetype decides how much of the line it can fill right now.
    const importLimitW = intertieImportLimitW(
      line,
      intertieContext,
      now.minute,
      now,
    );
    const exportLimitW = Math.min(rating, market?.availableDemandW || 0);
    transmissionCapacity += rating;
    marketImportLimitW += importLimitW;
    marketExportLimitW += exportLimitW;
    offers.push({
      marketId: market?.id,
      marketImportLimitW: neighborImportSupplyW(
        line.corridorId,
        intertieContext,
        now.minute,
        now,
      ),
      marketExportLimitW: market?.availableDemandW || 0,
      importLimitW,
      exportLimitW,
      pricePerMWh,
      emissionsKgco2ePerMWh: market?.emissionsKgco2ePerMWh || 0,
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
  const grossLocalSupplyW = supply;
  const clearing = clearTransmissionMarket({
    localSupplyW: supply - charge,
    demandW: now.demandW,
    capacityW: transmissionCapacity,
    importLimitW: marketImportLimitW,
    exportLimitW: marketExportLimitW,
    policy: transmission.tradingPolicy,
  });
  const { importedW, exportedW } = clearing;
  // Merit order: the cheapest neighbour supplies first and the best-paying one buys first.
  const flows = allocateIntertieFlows(offers, importedW, exportedW);
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
  const flowW = importedW + exportedW;
  const marketPricePerMWh =
    flowW > 0
      ? (importCostPerHour + exportRevenuePerHour) / flowW
      : transmissionCapacity > 0
        ? offers.reduce((sum, offer) => sum + offer.pricePerMWh, 0) /
          offers.length
        : 0;
  supply = clearing.localAvailableSupplyW;
  now.importedW = importedW;
  now.exportedW = exportedW;
  now.transmissionCapacityW = transmissionCapacity;
  now.marketPricePerMWh = marketPricePerMWh;
  now.supplyW = supply;
  // Exported surplus remains available to redirect to local demand in the setup outlook.
  now.availableSupplyW = supply + spareGenerationW + exportedW;
  // Surplus exports are interruptible under the game policy and can be redirected locally.
  now.reserveW = supply - now.demandW + reachableHeadroomW + exportedW;
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
  now.customerBillingRate = customerBillingRate(state, now);
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
  const choiceGrant = state.worldEvents.occurrences
    .filter(
      (event) =>
        event.attributes.scenarioChoice === true && bookedThisFrame(event),
    )
    .reduce(
      (total, event) => total + Number(event.attributes.upfrontGrant || 0),
      0,
    );
  const immediateCosts = state.worldEvents.occurrences
    .filter(
      (event) =>
        (event.attributes.scenarioChoice === true ||
          event.attributes.retrofit === true) &&
        bookedThisFrame(event),
    )
    .reduce((total, event) => total + Number(event.attributes.cost || 0), 0);
  const revenue =
    customerRevenue + revenueExports + (rebookingFrame ? 0 : choiceGrant);

  // Facilities expenses
  let kgco2e = 0;
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
  const fuelPrices = getEffectiveFuelPrices(date, state);
  // Attribute sales proportionally to gross local output and imports. Using net supply
  // after charging or exports would credit local facilities with more than the company earned.
  // The imported share remains outside local facility lifetime revenue.
  const revenueBasisW = grossLocalSupplyW + importedW;
  const revenuePerSuppliedW =
    revenueBasisW > 0 ? (customerRevenue + revenueExports) / revenueBasisW : 0;
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
      const operatingFuel = (g as Partial<GeneratorOperatingType>).fuel;
      facilityOM *=
        (operatingFuel &&
          tickStoryEffects.operatingCostMultipliersByFuel?.[operatingFuel]) ||
        1;
      facilityExpenses += facilityOM;
      expensesOM += facilityOM;
      if (g.fuel && FUELS[g.fuel]) {
        const fuelBtu =
          ((g.currentW * (g.btuPerWh || 0)) / ticksPerHour) *
          GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
        // Hydro and geothermal carry a zero-emission FUELS entry so carbon accounting can name
        // them, but they do not buy a fuel and therefore have no entry in the price table. In
        // JavaScript even zero times undefined is NaN; the first operating tick after construction
        // used to feed that through expenses into cash, where saving or charting exposed it as
        // null. An unpriced resource costs zero here, matching generatorCostPerMWh above.
        const facilityFuel = (fuelBtu * (fuelPrices[g.fuel] ?? 0)) / 1000000;
        const facilityKgco2e = fuelBtu * FUELS[g.fuel].kgCO2ePerBtu;
        expensesFuel += facilityFuel;
        kgco2e += facilityKgco2e;
        facilityExpenses +=
          facilityFuel + effectiveCarbonFee(tickDate, state) * facilityKgco2e;
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
      facilityExpenses =
        getPaymentInterest(g.loanAmountLeft, g.interestRate) / ticksPerMonth;
      expensesInterest += facilityExpenses;
      // A half-built plant is already costing interest, and a row that only started counting on
      // the day it switched on would hide the cheapest place to notice that
      if (!simulated) {
        g.lifetimeExpenses += facilityExpenses;
      }
    }
  });
  let transmissionPrincipalRepayment = 0;
  operatingLines.forEach((line) => {
    expensesOM += line.annualOperatingCost / ticksPerYear;
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
  const expensesCarbonFee = effectiveCarbonFee(tickDate, state) * kgco2e;

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
      transmissionPrincipalRepayment,
  );
  now.netWorth = getNetWorth(
    facilities,
    now.cash,
    now.minute,
    transmission.lines,
  );
  now.revenue = revenue + (rebookingFrame ? choiceGrant : 0);
  now.revenueExports = revenueExports;
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

  return now;
}

function supplyForecastPass(
  state: GameType,
  simulated?: boolean,
  withoutMinimumStableOutput = false,
  stepMinutes = TICK_MINUTES,
): TickPresentFutureType[] {
  // updateSupplyFacilitiesFinances ramps generators, charges batteries and pays down loans by
  // mutating the facilities in place, so forecasting has to run against a copy of them. A shallow
  // spread shares the same facility objects, which let a forecast leave the real fleet sitting at
  // its end-of-horizon state -- resuming a paused nuclear plant snapped straight to full output
  // instead of ramping, and every reforecast silently aged construction and loans by a whole day.
  const newState = {
    ...state,
    policies: cloneDeep(state.policies),
    commissionedHydroSiteIds: [...state.commissionedHydroSiteIds],
    facilities: cloneDeep(state.facilities),
    transmission: cloneDeep(state.transmission ?? emptyTransmissionState()),
  };
  if (withoutMinimumStableOutput) {
    newState.facilities.forEach((facility) => {
      if (!facility.peakWh) {
        (facility as GeneratorOperatingType).minimumStableOutput = undefined;
      }
    });
  }
  const current = getTimeFromTimeline(state.date.minute, state.timeline);
  const currentCash = current?.cash;
  const currentCustomers = current?.customers;
  let prev = newState.timeline[0];
  return newState.timeline.map((t: TickPresentFutureType) => {
    const sourceTick = t;
    if (t.minute >= state.date.minute) {
      advancePolicies(newState, Math.floor(t.minute / MINUTES_PER_MONTH));
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
    prev = t;
    return t;
  });
}

function reforecastSupply(
  state: GameType,
  simulated?: boolean,
  stepMinutes = TICK_MINUTES,
): TickPresentFutureType[] {
  // First record the merit-order request each generator would receive without minimum-load
  // constraints. The optimized pass then scans those per-facility requests to compare the cost
  // of remaining online with the cost of the next start. Keeping this as two linear passes avoids
  // recursively re-simulating the fleet for every plant on every tick.
  const baseline = supplyForecastPass(state, true, true, stepMinutes);
  // Recorded ticks can be Immer drafts when this is called from a reducer. Commitment metadata
  // is deliberately attached with Object.defineProperty, which Immer forbids on a draft; the
  // optimizer only reads from the current tick onwards anyway, so leave the recorded past alone.
  const futureBaseline = baseline.slice(
    forecastIndexAt(state, state.date.minute),
  );
  state.facilities.forEach((facility) => {
    const generator = facility as GeneratorOperatingType;
    if (!facility.peakWh && (generator.minimumStableOutput || 0) > 0) {
      prepareGeneratorCommitment({
        facilityId: facility.id,
        forecast: futureBaseline,
        minimumOperatingCost: (futureTick) =>
          minimumStableOperatingCost(state, generator, futureTick, stepMinutes),
      });
    }
  });
  return supplyForecastPass(
    { ...state, timeline: baseline },
    simulated,
    false,
    stepMinutes,
  );
}

export function generateNewTimeline(
  readOnlyState: GameType,
  cash: number,
  customers: number,
  ticks = TICKS_PER_DAY,
  stepMinutes = TICK_MINUTES,
): TickPresentFutureType[] {
  const tickScale = stepMinutes / TICK_MINUTES;
  // Everything below runs against a private copy, because reforecastSupply ramps generators and
  // pays down loans by mutating the facilities it is handed. Only the facilities need the deep
  // clone though: the timeline is overwritten on the very next line, and by the end of a long
  // scenario the monthly history is hundreds of entries that nothing in the forecast reads.
  // Deep cloning either of them was work thrown away, on a function that can run a year of
  // simulation several times a second.
  const state = {
    ...readOnlyState,
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
        "Data centers": 0,
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
  state.timeline = reforecastWeatherAndPrices(state);
  const previousDemandTick = readOnlyState.timeline.findLast(
    (tick) => tick.minute < state.date.minute,
  );
  state.timeline = reforecastDemand(
    state,
    tickScale,
    previousDemandTick?.deferredResidential ??
      getTimeFromTimeline(state.date.minute, readOnlyState.timeline)
        ?.deferredResidentialStart ??
      [],
  );
  state.timeline = reforecastSupply(state, true, stepMinutes);
  return state.timeline;
}

/**
 * Edits the state in place to handle all of the one-off consequences of building
 * (not including reforecasting, which should be done once after multiple builds)
 * @param state
 * @param g
 * @param financed
 * @param newGame
 * @returns
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
    } else if (financed) {
      const downpayment = g.buildCost * DOWNPAYMENT_PERCENT;
      now.cash -= downpayment;
      const loanAmount = g.buildCost - downpayment;
      financing = {
        loanAmountTotal: loanAmount,
        loanAmountLeft: loanAmount,
        loanMonthlyPayment: getMonthlyPayment(
          loanAmount,
          state.interestRate,
          LOAN_MONTHS,
        ),
        interestRate: state.interestRate,
      };
    } else {
      // purchased in cash
      now.cash -= g.buildCost;
    }
    // Site availability belongs to the current fleet quote, not the facility bought from it. A
    // saved operating asset must not retain a permanently stale "remaining" count.
    // Nor does the resilience option's share of the price: it is only for the build dialog.
    const {
      viableLocationsRemaining: _viableLocationsRemaining,
      resilienceExtraBuildCost: _resilienceExtraBuildCost,
      ...facilitySnapshot
    } = g as FacilityShoppingType & { resilienceExtraBuildCost?: number };
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
      lifetimeWh: 0,
      lifetimePotentialWh: 0,
      lifetimeRevenue: 0,
      lifetimeExpenses: 0,
      lifetimeStarts: 0,
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
    } else {
      state.facilities.unshift(facility); // add generators to top so that they produce by default
    }
  }

  return state;
}

function getNetWorth(
  facilities: FacilityOperatingType[],
  cash: number,
  currentMinute: number,
  transmissionLines: readonly TransmissionLineOperatingType[] = [],
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
  return netWorth;
}
