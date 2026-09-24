import {
  accessContextForGame,
  effectiveCorridor,
  IntertieAccessContext,
} from "./data/IntertieAccess";
import { validHydroClaims } from "./data/HydroSites";
import {
  validRunIdentity,
  sameRunIdentity,
  expandAuthoredRunReference,
  normalizedInputs,
} from "./helpers/RunIdentity";
import { validInvitation } from "./helpers/Challenge";
import {
  emptyPolicies,
  validPolicies,
  validDeferredResidential,
} from "./helpers/Policies";
import packageJson from "../package.json";
import { validWorldEvent } from "./helpers/WorldEventValidation";
import { MINUTES_PER_MONTH } from "./helpers/DateTime";
import { isValidLocation } from "./helpers/Locations";
import { isValidDifficulty } from "./helpers/Difficulty";
import {
  getStorageJson,
  removeStorageKey,
  setStorageKeyValue,
} from "./LocalStorage";
import { snackbarOpen } from "./reducers/UI";
import {
  DOWNPAYMENT_PERCENT,
  TICKS_PER_MONTH,
  INTERTIE_UPGRADE_STEP,
  MAX_INTERTIE_UPGRADES,
  MONTHS,
} from "./Constants";
import {
  corridorConstructionKgco2e,
  intertieUpgradeQuote,
} from "./helpers/Transmission";
import {
  GameType,
  IntertieUpgradeType,
  TransmissionCorridorDefinitionType,
  TransmissionLineOperatingType,
} from "./Types";
import { validMeaningfulDecisions } from "./helpers/MeaningfulDecisions";
import {
  emptyTransmissionState,
  intertiesEnabledForScenario,
  corridorsForLocation,
} from "./data/AdjacentMarkets";
import { getScenario } from "./data/Scenarios";
import type { AppStore } from "./Store";

/**
 * Saving and restoring a game.
 *
 * Only the game slice is persisted. Every random draw in the simulation is addressed by
 * (seed, stream, index) rather than pulled from a running generator, so the weather and fuel price
 * caches -- which live outside Redux -- rebuild themselves identically from state.seed on the other
 * side of a reload. Nothing sequential has to be carried in the save.
 *
 * This module deliberately imports almost nothing: reducers/Game reaches back here for
 * clearSaveFor, and data/Scenarios imports reducers/Game, so importing the scenarios from here
 * would close the cycle that reducers/ImportOrder.test.tsx guards against. Callers that need to
 * know about scenarios (whether one is a tutorial, what it's called) pass that in.
 */

export const SAVE_KEY = "savedGame";

export interface SaveGameType {
  savedAt: string; // ISO 8601
  appVersion: string; // For bug reports
  game: GameType;
}

// mapStateToProps runs on every dispatch, and re-parsing ~100KB of JSON each time to decide whether
// to show a Continue button would be silly. Only ever populated by an actual read: writing and
// clearing invalidate it rather than filling it in, so what's cached is always what's in storage
// and never an alias of the live (and still mutating) game slice.
let cached: SaveGameType | null | undefined;

function approximatelyEqual(actual: unknown, expected: number): boolean {
  return (
    typeof actual === "number" &&
    Number.isFinite(actual) &&
    Math.abs(actual - expected) <= Math.max(1, expected) * 1e-9
  );
}

function validConstruction(
  raw: {
    constructionKgco2eTotal?: unknown;
    constructionKgco2eEmitted?: unknown;
  },
  maximum: number,
): boolean {
  const total =
    raw.constructionKgco2eTotal === undefined ? 0 : raw.constructionKgco2eTotal;
  const emitted =
    raw.constructionKgco2eEmitted === undefined
      ? 0
      : raw.constructionKgco2eEmitted;
  return (
    [total, emitted].every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    ) &&
    typeof total === "number" &&
    typeof emitted === "number" &&
    total <= maximum &&
    emitted <= total
  );
}

/**
 * Capacity must be the corridor's authored rating times a whole number of upgrade steps, within
 * the allowed count. Compared as a ratio rather than by equality: the reducer compounds
 * `capacityW * 1.5` one upgrade at a time, and recomputing the same power here is a different
 * floating-point operation that need not agree to the last bit.
 */
function validUpgradedCapacity(capacityW: number, corridorW: number): boolean {
  if (!(corridorW > 0) || !(capacityW > 0)) return false;
  const steps = Math.round(
    Math.log(capacityW / corridorW) / Math.log(INTERTIE_UPGRADE_STEP),
  );
  if (steps < 0 || steps > MAX_INTERTIE_UPGRADES) return false;
  return (
    Math.abs(
      capacityW / (corridorW * Math.pow(INTERTIE_UPGRADE_STEP, steps)) - 1,
    ) <= 1e-9
  );
}

/** Reconstruct the same quotes used by live purchases, including the pending job's cost. */
function validLineInvestment(
  line: Partial<TransmissionLineOperatingType>,
  corridor: TransmissionCorridorDefinitionType,
  year: number,
  context?: IntertieAccessContext,
): boolean {
  let expected = {
    corridorId: corridor.id,
    capacityW: corridor.capacityW,
    annualOperatingCost: corridor.annualOperatingCost,
  };
  let buildCost = corridor.buildCost;
  let yearsToBuild = corridor.yearsToBuild;
  let constructionKgco2e = corridorConstructionKgco2e(corridor);
  const steps = Math.round(
    Math.log(line.capacityW! / corridor.capacityW) /
      Math.log(INTERTIE_UPGRADE_STEP),
  );
  for (let step = 0; step < steps; step++) {
    const quote = intertieUpgradeQuote(expected, year, 1, 1, context);
    if (!quote) return false;
    expected = {
      ...expected,
      capacityW: quote.targetCapacityW,
      annualOperatingCost: quote.annualOperatingCost,
    };
    buildCost += quote.buildCost;
    yearsToBuild += quote.yearsToBuild;
    constructionKgco2e += quote.constructionKgco2eTotal;
  }
  if (
    !approximatelyEqual(line.annualOperatingCost, expected.annualOperatingCost)
  )
    return false;
  if (line.upgrade !== undefined) {
    if (
      typeof line.upgrade !== "object" ||
      line.upgrade === null ||
      line.yearsToBuildLeft !== 0
    )
      return false;
    const quote = intertieUpgradeQuote(expected, year, 1, 1, context);
    const upgrade = line.upgrade;
    if (
      !quote ||
      ![
        "targetCapacityW",
        "buildCost",
        "annualOperatingCost",
        "yearsToBuild",
      ].every((key) =>
        approximatelyEqual(
          upgrade[key as keyof IntertieUpgradeType],
          quote[key as keyof typeof quote],
        ),
      )
    )
      return false;
    if (
      !Number.isFinite(upgrade.yearsToBuildLeft) ||
      upgrade.yearsToBuildLeft <= 0 ||
      upgrade.yearsToBuildLeft > quote.yearsToBuild ||
      !validConstruction(upgrade, quote.constructionKgco2eTotal)
    )
      return false;
    buildCost += quote.buildCost;
  }
  return (
    approximatelyEqual(line.buildCost, buildCost) &&
    line.loanAmountLeft! <=
      buildCost * (1 - DOWNPAYMENT_PERCENT) + Math.max(1, buildCost) * 1e-9 &&
    line.yearsToBuildLeft! <= yearsToBuild &&
    validConstruction(line, constructionKgco2e)
  );
}

function validTransmissionLine(
  raw: unknown,
  year: number,
  context?: IntertieAccessContext,
): raw is TransmissionLineOperatingType {
  if (typeof raw !== "object" || raw === null) return false;
  const line = raw as Partial<TransmissionLineOperatingType>;
  const corridor = effectiveCorridor(line.corridorId || "", context);
  if (!corridor) return false;
  const nonNegative = [
    line.capacityW,
    line.buildCost,
    line.annualOperatingCost,
    line.yearsToBuildLeft,
    line.minuteCreated,
    line.loanAmountLeft,
    line.loanMonthlyPayment,
    line.interestRate,
  ];
  return (
    typeof line.name === "string" &&
    line.name.length > 0 &&
    Number.isInteger(line.id) &&
    line.id! > 0 &&
    nonNegative.every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    ) &&
    validUpgradedCapacity(line.capacityW!, corridor.capacityW) &&
    validLineInvestment(line, corridor, year, context) &&
    Number.isInteger(line.minuteCreated) &&
    line.interestRate! <= 1 &&
    line.loanMonthlyPayment! <= corridor.buildCost &&
    // Derived display state rather than a decision: the next real tick overwrites it, but it
    // is rendered before that tick lands, so an imported save cannot claim a line is moving
    // more power than it is rated for. Saves written before this field existed omit it.
    (line.currentFlowW === undefined ||
      (typeof line.currentFlowW === "number" &&
        Number.isFinite(line.currentFlowW) &&
        Math.abs(line.currentFlowW) <= line.capacityW!)) &&
    typeof line.financed === "boolean" &&
    (line.financed
      ? line.loanMonthlyPayment! > 0
      : line.loanAmountLeft === 0 &&
        line.loanMonthlyPayment === 0 &&
        line.interestRate === 0)
  );
}

function validEmissions(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const record = raw as {
    kgco2e?: number;
    localKgco2e?: number;
    importedKgco2e?: number;
    constructionKgco2e?: number;
  };
  if (
    ![record.kgco2e, record.localKgco2e, record.importedKgco2e].every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    )
  )
    return false;
  // Saves written before construction emissions existed have two components rather than three,
  // and their total is still the sum of what they do carry.
  const construction = record.constructionKgco2e ?? 0;
  if (!Number.isFinite(construction) || construction < 0) return false;
  return (
    Math.abs(
      record.kgco2e! -
        record.localKgco2e! -
        record.importedKgco2e! -
        construction,
    ) <=
    Math.max(1, record.kgco2e!) * 1e-9
  );
}

export function serializeSave(game: GameType): SaveGameType {
  return {
    savedAt: new Date().toISOString(),
    appVersion: packageJson.version,
    game,
  };
}

/**
 * Validates an untrusted blob and returns it as a save, or null if it isn't one. Takes unknown
 * rather than reading storage itself so that the same checks cover an imported file, where a
 * malformed facility would otherwise crash the sim mid-tick.
 */
export function parseSave(raw: unknown): SaveGameType | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const save = raw as Partial<SaveGameType>;
  if (typeof save.savedAt !== "string" || typeof save.appVersion !== "string") {
    return null;
  }
  const game = save.game as Partial<GameType> | undefined;
  if (typeof game !== "object" || game === null) {
    return null;
  }
  if (
    !isValidDifficulty(game.difficulty) ||
    typeof game.scenarioId !== "number" ||
    typeof game.seed !== "number" ||
    typeof game.startingYear !== "number" ||
    !Number.isFinite(game.startingYear) ||
    typeof game.customerMarketSize !== "number" ||
    !Number.isFinite(game.customerMarketSize) ||
    game.customerMarketSize <= 0 ||
    typeof game.startingDemandScale !== "number" ||
    !Number.isFinite(game.startingDemandScale) ||
    game.startingDemandScale <= 0 ||
    !Array.isArray(game.loadAdditions) ||
    game.loadAdditions.some(
      (addition) =>
        typeof addition !== "object" ||
        addition === null ||
        typeof addition.id !== "string" ||
        typeof addition.label !== "string" ||
        typeof addition.startsYear !== "number" ||
        !Number.isInteger(addition.startsYear) ||
        (addition.startsMonth !== undefined &&
          (typeof addition.startsMonth !== "number" ||
            !Number.isInteger(addition.startsMonth) ||
            addition.startsMonth < 1 ||
            addition.startsMonth > 12)) ||
        typeof addition.peakW !== "number" ||
        !Number.isFinite(addition.peakW) ||
        addition.peakW < 0 ||
        typeof addition.loadFactor !== "number" ||
        !Number.isFinite(addition.loadFactor) ||
        addition.loadFactor < 0 ||
        addition.loadFactor > 1 ||
        (addition.demandType !== "Data centers" &&
          addition.demandType !== "Mining"),
    ) ||
    typeof game.customerRate !== "number" ||
    !Number.isFinite(game.customerRate) ||
    game.customerRate < 0 ||
    // Checked in full rather than trusted, the same way decodeReplay checks a replay's: the
    // location's id becomes the path of the weather file the loading screen fetches, and its
    // lat/long and time zone drive the sun model. A save is hand-editable too
    !isValidLocation(game.location)
  ) {
    return null;
  }
  if (
    typeof game.date !== "object" ||
    game.date === null ||
    // Every field is consumed by the UI or simulation before the next tick rebuilds it.
    // Do not compare derived fields against minute: synthetic clocks may still be valid.
    [
      game.date.minute,
      game.date.minuteOfDay,
      game.date.hourOfDay,
      game.date.hourOfFullYear,
      game.date.percentOfMonth,
      game.date.percentOfYear,
      game.date.monthNumber,
      game.date.monthsElapsed,
      game.date.year,
    ].some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
    game.date.minute < 0 ||
    !MONTHS.includes(game.date.month)
  ) {
    return null;
  }
  if (!Array.isArray(game.facilities) || !validHydroClaims(game as GameType)) {
    return null;
  }
  if (
    game.facilities.some((facility) => {
      if (typeof facility !== "object" || facility === null) {
        return true;
      }
      const current = facility as Record<string, unknown>;
      const requiredNumbersInvalid = [
        current.annualOperatingCost,
        current.lifespanYears,
        current.lifetimeWh,
        current.lifetimePotentialWh,
        current.lifetimeRevenue,
        current.lifetimeExpenses,
        current.peakW,
      ].some((value) => typeof value !== "number" || !Number.isFinite(value));
      const optionalNumbersInvalid = [
        current.costPerStart,
        current.lifetimeStarts,
        current.minimumStableOutput,
        current.variableOperatingCostPerMWh,
      ].some(
        (value) =>
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value) || value < 0),
      );
      const optionalBooleansInvalid = [
        current.committed,
        current.tracksStarts,
        current.generatingLastRealTick,
      ].some((value) => value !== undefined && typeof value !== "boolean");
      return (
        !validConstruction(
          current,
          Number(current.peakW) * 20 + Number(current.peakWh || 0),
        ) ||
        requiredNumbersInvalid ||
        optionalNumbersInvalid ||
        (typeof current.minimumStableOutput === "number" &&
          current.minimumStableOutput > 1) ||
        optionalBooleansInvalid
      );
    }) ||
    !Array.isArray(game.timeline) ||
    game.timeline.some(
      (tick) =>
        !validEmissions(tick) ||
        typeof tick.reserveW !== "number" ||
        !Number.isFinite(tick.reserveW) ||
        [
          tick.storageChargeW,
          tick.storageDischargeW,
          tick.importKgco2ePerMWh,
        ].some(
          (value) =>
            typeof value !== "number" || !Number.isFinite(value) || value < 0,
        ),
    ) ||
    !Array.isArray(game.monthlyHistory) ||
    game.monthlyHistory.length >
      Math.floor(game.date.minute / MINUTES_PER_MONTH) ||
    game.monthlyHistory.some((month) => {
      if (
        typeof month !== "object" ||
        month === null ||
        !validEmissions(month)
      ) {
        return true;
      }
      const record = month as Partial<GameType["monthlyHistory"][number]>;
      const chart = record.chartAverage;
      if (
        chart !== undefined &&
        (typeof chart !== "object" ||
          chart === null ||
          !chart.demandByType ||
          !chart.supplyByFuel ||
          !chart.renewableCapacityFactors ||
          Object.values(chart).some((value) =>
            typeof value === "number"
              ? !Number.isFinite(value)
              : typeof value !== "object" ||
                value === null ||
                Object.values(value).some(
                  (entry) =>
                    typeof entry !== "number" || !Number.isFinite(entry),
                ),
          ) ||
          typeof record.chartTickWeight !== "number" ||
          !Number.isFinite(record.chartTickWeight) ||
          record.chartTickWeight <= 0)
      ) {
        return true;
      }
      return (
        typeof record.deliveredWhByFuel !== "object" ||
        record.deliveredWhByFuel === null ||
        Object.values(record.deliveredWhByFuel).some(
          (value) =>
            typeof value !== "number" || !Number.isFinite(value) || value < 0,
        ) ||
        typeof record.peakDemandW !== "number" ||
        !Number.isFinite(record.peakDemandW) ||
        record.peakDemandW < 0 ||
        (record.minimumSupplyMarginW !== undefined &&
          (typeof record.minimumSupplyMarginW !== "number" ||
            !Number.isFinite(record.minimumSupplyMarginW)))
      );
    }) ||
    !Array.isArray(game.eventLog) ||
    !Array.isArray(game.reportedEventKeys) ||
    typeof game.eventLogReadThroughId !== "number"
  ) {
    return null;
  }
  const currentMonth = Math.floor(game.date.minute / MINUTES_PER_MONTH);
  if (
    !validMeaningfulDecisions(game.meaningfulDecisions, currentMonth) ||
    (game.meaningfulDecisionGateWaived !== undefined &&
      typeof game.meaningfulDecisionGateWaived !== "boolean")
  )
    return null;
  const worldEvents = game.worldEvents as
    Partial<GameType["worldEvents"]> | undefined;
  if (
    typeof worldEvents !== "object" ||
    worldEvents === null ||
    !Array.isArray(worldEvents.active) ||
    !Array.isArray(worldEvents.occurrences) ||
    !Array.isArray(worldEvents.checkedKeys) ||
    !worldEvents.active.every(validWorldEvent) ||
    !worldEvents.occurrences.every(validWorldEvent) ||
    !worldEvents.checkedKeys.every((key) => typeof key === "string")
  ) {
    return null;
  }
  if (
    game.policies !== undefined &&
    !validPolicies(
      game.policies,
      Math.floor(game.date.minute / MINUTES_PER_MONTH),
    )
  )
    return null;
  const exercise = game.tutorialIntertieStress;
  if (
    exercise !== undefined &&
    (game.scenarioId !== 112 ||
      game.customScenario ||
      !exercise ||
      typeof exercise.active !== "boolean" ||
      typeof exercise.completed !== "boolean" ||
      !Number.isInteger(exercise.startsMinute) ||
      exercise.startsMinute < 0 ||
      exercise.startsMinute > game.date.minute ||
      !Number.isInteger(exercise.suppliedTicks) ||
      exercise.suppliedTicks < 0 ||
      exercise.suppliedTicks > TICKS_PER_MONTH ||
      (exercise.completed && exercise.active))
  )
    return null;
  const transmission = game.transmission;
  const scenario = getScenario(game.scenarioId, game.customScenario);
  const transmissionEnabled = !!(
    scenario && intertiesEnabledForScenario(scenario, game.location)
  );
  if (
    transmission !== undefined &&
    (typeof transmission !== "object" ||
      transmission === null ||
      !["BALANCED", "RELIABILITY_FIRST", "SURPLUS_ONLY", "CLOSED"].includes(
        transmission.tradingPolicy,
      ) ||
      !Array.isArray(transmission.lines) ||
      transmission.lines.some(
        (line) =>
          !validTransmissionLine(
            line,
            game.date!.year,
            accessContextForGame(game as GameType),
          ),
      ) ||
      new Set(transmission.lines.map(({ id }) => id)).size !==
        transmission.lines.length ||
      new Set(transmission.lines.map(({ corridorId }) => corridorId)).size !==
        transmission.lines.length)
  )
    return null;
  if (!transmissionEnabled && transmission?.lines.length) return null;
  const locationCorridors = game.location
    ? corridorsForLocation(game.location)
    : [];
  if (
    transmissionEnabled &&
    transmission?.lines.some(
      ({ corridorId }) =>
        !locationCorridors.some(({ id }) => id === corridorId),
    )
  )
    return null;
  if (
    game.timeline.some(
      (t) =>
        !validDeferredResidential(t.deferredResidential) ||
        !validDeferredResidential(t.deferredResidentialStart) ||
        [
          t.customerBillingRate,
          t.deferredResidentialWh,
          t.deferredResidentialWhStart,
          t.shiftedResidentialW,
        ].some(
          (value) =>
            value !== undefined && (!Number.isFinite(value) || value < 0),
        ),
    )
  )
    return null;
  if (
    [...game.timeline, ...game.monthlyHistory].some(
      (t) =>
        t.expensesPolicy !== undefined &&
        (!Number.isFinite(t.expensesPolicy) || t.expensesPolicy < 0),
    )
  )
    return null;
  const normalized = {
    ...game,
    policyPause: undefined,
    scenarioChoicePause: undefined,
    policies:
      game.policies ??
      emptyPolicies(Math.floor(game.date.minute / MINUTES_PER_MONTH)),
    transmission: transmissionEnabled
      ? (game.transmission ?? emptyTransmissionState())
      : undefined,
    meaningfulDecisions: game.meaningfulDecisions!,
    meaningfulDecisionGateWaived: game.meaningfulDecisionGateWaived ?? false,
    timeline: (game as GameType).timeline.map((t) => ({
      ...t,
      expensesPolicy: t.expensesPolicy ?? 0,
      expensesImports: t.expensesImports ?? 0,
      revenueExports: t.revenueExports ?? 0,
      importedW: t.importedW ?? 0,
      exportedW: t.exportedW ?? 0,
      transmissionCapacityW: t.transmissionCapacityW ?? 0,
      marketPricePerMWh: t.marketPricePerMWh ?? 0,
    })),
    monthlyHistory: game.monthlyHistory.map((t) => ({
      ...t,
      expensesPolicy: t.expensesPolicy ?? 0,
      expensesImports: t.expensesImports ?? 0,
      revenueExports: t.revenueExports ?? 0,
    })),
  };
  if (
    normalized.runIdentity &&
    (!validRunIdentity(normalized.runIdentity) ||
      normalized.runIdentity.seed !== normalized.seed ||
      normalized.runIdentity.scenarioId !== normalized.scenarioId ||
      normalized.runIdentity.difficulty !== normalized.difficulty ||
      normalizedInputs(normalized.location) !==
        normalizedInputs(normalized.runIdentity.inputs.location) ||
      normalized.meaningfulDecisionGateWaived ||
      normalized.storyEffectsDisabled ||
      normalized.customScenario)
  )
    return null;
  if (
    normalized.challenge &&
    (!validInvitation(normalized.challenge) ||
      !sameRunIdentity(
        normalized.runIdentity,
        expandAuthoredRunReference(normalized.challenge.run),
      ))
  )
    return null;
  return { ...save, game: normalized } as SaveGameType;
}

export function readSave(): SaveGameType | null {
  if (cached === undefined) {
    // getStorageJson already returns the fallback for missing keys and unparseable JSON
    cached = parseSave(getStorageJson<object>(SAVE_KEY, {}));
  }
  return cached;
}

// Returns false when the write didn't land, so the caller can tell the player rather than silently
// losing their game
export function writeSave(game: GameType): boolean {
  cached = undefined;
  try {
    setStorageKeyValue(SAVE_KEY, serializeSave(game), false);
  } catch (_err) {
    return false;
  }
  return true;
}

export function clearSave() {
  cached = undefined;
  removeStorageKey(SAVE_KEY);
}

/**
 * Clears the save only if it belongs to the given scenario. Scenarios end for reasons that have
 * nothing to do with what's in the save -- a tutorial runs a single month and "wins" on the way
 * past -- and throwing away someone else's saved run over that would be a nasty way to lose a game.
 */
export function clearSaveFor(scenarioId: number) {
  if (readSave()?.game.scenarioId === scenarioId) {
    clearSave();
  }
}

/**
 * Whether the slice arriving at the loading screen was restored by resume() rather than being a
 * fresh game waiting for initGame. The timeline is the tell: it's empty on a new game (start clears
 * it, and initialGame starts it empty) and only initGame or resume ever fills it.
 */
export function isResumedGame(game: GameType): boolean {
  return game.timeline.length > 0;
}

/**
 * Writes the game slice to local storage as the player plays: once at the turn of each game year,
 * plus whatever is left over on the way out. Returns its own teardown.
 *
 * A game year is 1152 ticks, so even at FAST speed this is a write every eleven seconds or so --
 * infrequent enough that it doesn't need throttling, and unthrottled means every year boundary
 * actually lands rather than being collapsed into a later one.
 *
 * isSaveableScenario is injected rather than looked up here (see the note at the top of the file);
 * pass a predicate that rejects tutorials, which are short enough not to be worth saving and would
 * otherwise need their short-lived objective state restored too.
 */
export function startAutosave(
  store: AppStore,
  isSaveableScenario: (scenarioId: number) => boolean,
): () => void {
  // The slice as of the last notification where a game was running. Quit resets the slice before
  // the subscriber sees it, so flushing on the way out needs the state as it was, not as it is.
  let live: GameType | undefined;
  let attemptedYear = -1;
  // The exact Redux snapshot that was written. Time is not enough to identify a change: while
  // paused, a player can still build, sell, reorder, change rates, or pause a facility without
  // advancing the minute.
  let saved: GameType | undefined;
  // A full disk fails every year; saying so once is a warning, saying so every year is a bug
  let warnedAboutFailure = false;

  const write = (game: GameType) => {
    attemptedYear = game.date.year;
    if (writeSave(game)) {
      saved = game;
    } else if (!warnedAboutFailure) {
      warnedAboutFailure = true;
      store.dispatch(
        snackbarOpen("Couldn't save your game - browser storage is full."),
      );
    }
  };

  /**
   * Writes the part-year since the last save, on the way out of a game -- quitting to the menu,
   * hiding the tab, or closing it. Without this a player who quits partway through a year comes
   * back to the start of it, since quit fires none of the page lifecycle events.
   *
   * Only ever updates a save that's still there. The first moment of any game writes immediately,
   * so a missing save means the scenario ended and cleared it, and a bankrupt run shouldn't come
   * back from the dead.
   */
  const flush = () => {
    if (!live || live === saved) {
      return;
    }
    if (readSave()?.game.scenarioId !== live.scenarioId) {
      return;
    }
    write(live);
  };

  const unsubscribe = store.subscribe(() => {
    const game = store.getState().game;
    // A replay is somebody else's run being re-simulated; writing it over the watcher's own save
    // would cost them their game
    if (
      !game.inGame ||
      game.replayPlayback ||
      !isSaveableScenario(game.scenarioId)
    ) {
      flush();
      live = undefined;
      return;
    }
    if (!live) {
      // A game just started or resumed, and nothing of it is written yet. Saving immediately is
      // what lets the flush above treat a missing save as "the scenario ended".
      attemptedYear = -1;
      saved = undefined;
    }
    live = game;
    if (game.date.year !== attemptedYear) {
      write(game);
    }
  });

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange, false);
  // pagehide rather than beforeunload, which mobile browsers routinely never fire
  window.addEventListener("pagehide", flush, false);

  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibilityChange, false);
    window.removeEventListener("pagehide", flush, false);
  };
}
