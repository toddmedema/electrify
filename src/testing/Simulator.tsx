// The game reducer dispatches follow-up actions of its own (the construction complete snackbar,
// the end of game dialogs), so it needs a live store to reach even though the simulation drives
// the reducer directly. Importing Store creates and registers it.
import cloneDeep from "lodash.clonedeep";
import "../Store";
import gameReducer, {
  buildFacility,
  delta,
  initGame,
  start,
  startReplay,
  tickState,
} from "../reducers/Game";
import { DIFFICULTIES } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { SCENARIOS } from "../data/Scenarios";
import { getStartingCustomers } from "../data/LocationProfiles";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { getScenarioLocation } from "../helpers/Locations";
import {
  DifficultyType,
  FacilityOperatingType,
  GameType,
  GeneratorShoppingType,
  LocationType,
  MonthlyHistoryType,
  ReplayType,
  ScenarioType,
  TickPresentFutureType,
} from "../Types";
import {
  checkMonth,
  checkTick,
  InvariantCollector,
  ViolationType,
} from "./Invariants";
import { loadSimData } from "./SimData";

export type StrategyType = "none" | "keepUp";

/**
 * Where a scenario is played, or a hard failure. The browser can put an alert on screen and go
 * back to the menu; a headless run that quietly simulated the wrong city would just print a
 * plausible report about somewhere else.
 */
function scenarioLocation(scenario: ScenarioType): LocationType {
  const location = getScenarioLocation(scenario);
  if (!location) {
    throw new Error(
      `Scenario "${scenario.name}" has no location: "${scenario.locationId}" isn't in LOCATIONS ` +
        "and no full location was carried on the scenario itself.",
    );
  }
  return location;
}

export interface SimOptionsType {
  scenarioId: number;
  // A scenario that isn't in SCENARIOS - a custom game, or one being tried out. Its id wins over
  // scenarioId, the same way the real game treats the one on the slice
  scenario?: ScenarioType;
  difficulty?: DifficultyType;
  months?: number; // Defaults to the scenario's own duration
  seed?: number;
  dollarsPerkWh?: number;
  monthlyMarketingSpend?: number;
  strategy?: StrategyType;
}

export interface ResolvedSimOptionsType {
  scenarioId: number;
  difficulty: DifficultyType;
  months: number;
  seed: number;
  dollarsPerkWh: number | null; // null = left at the scenario's own rate
  monthlyMarketingSpend: number;
  strategy: StrategyType;
}

export interface BuildRecordType {
  month: number;
  name: string;
  buildCost: number;
}

export interface SimResultType {
  options: ResolvedSimOptionsType;
  scenario: ScenarioType;
  ticks: number;
  months: MonthlyHistoryType[]; // Oldest first, unlike game.monthlyHistory which is newest first
  finalFacilities: FacilityOperatingType[];
  finalCash: number;
  finalNetWorth: number;
  wentBankrupt: boolean;
  bankruptAtMonth: number | null;
  builds: BuildRecordType[];
  // Mean fill level of the storage fleet across the run, 0 - 1, or null with no storage built
  averageStateOfCharge: number | null;
  violations: ViolationType[];
  violationCountByRule: { [rule: string]: number };
  violationCount: number;
}

const DEFAULT_SEED = 12345;

function formatWhen(state: GameType): string {
  const d = state.date;
  const hour = String(Math.floor(d.minuteOfDay / 60)).padStart(2, "0");
  const minute = String(d.minuteOfDay % 60).padStart(2, "0");
  return `${d.year}-${String(d.monthNumber).padStart(2, "0")} ${hour}:${minute}`;
}

/**
 * Builds a game state the way a real playthrough does -- scenario, then difficulty, then initGame --
 * but through the reducer directly rather than the shared store, so runs can't leak into each other.
 *
 * Exported so that tests wanting a realistic mid-game state can start from one without running a
 * whole simulation. Loads the scenario's data as a side effect.
 */
export function createGame(options: SimOptionsType): GameType {
  const scenario =
    options.scenario ||
    SCENARIOS.find((s: ScenarioType) => s.id === options.scenarioId) ||
    SCENARIOS[0];
  loadSimData(scenarioLocation(scenario));
  return setUpGame(scenario, resolveOptions(scenario, options));
}

function setUpGame(
  scenario: ScenarioType,
  options: ResolvedSimOptionsType,
): GameType {
  const location = scenarioLocation(scenario);
  let state = gameReducer(undefined, start(scenario.id));
  // Chosen on the new game screen, before the game is built
  state = gameReducer(
    state,
    delta({
      difficulty: options.difficulty,
      monthlyMarketingSpend: options.monthlyMarketingSpend,
      // A scenario that isn't in SCENARIOS can only be found again through the slice, which is
      // exactly what the custom game screen does before it starts a game
      customScenario: SCENARIOS.some((s: ScenarioType) => s.id === scenario.id)
        ? undefined
        : scenario,
    }),
  );
  state = gameReducer(
    state,
    initGame({
      facilities: scenario.facilities,
      cash: scenario.cash,
      customers: scenario.startingCustomers || getStartingCustomers(location),
      location,
      seed: options.seed,
    }),
  );
  // Applied after initGame, which sets the scenario's own rate, the same way a player changing
  // the rate on the Finances screen would
  if (options.dollarsPerkWh !== null) {
    state = gameReducer(state, delta({ dollarsPerkWh: options.dollarsPerkWh }));
  }
  // Redux Toolkit freezes reducer output in development; the tick loop mutates state in place
  return cloneDeep(state);
}

/**
 * Sets a game up to play a replay back, the way the loading screen does in the browser: the
 * scenario and the seed the replay carries, and nothing else of the original run. Ticking the
 * result forward re-runs that run, applying each recorded action as the clock reaches it.
 *
 * Also a regression harness -- replay a recorded game against a new build and diff the monthly
 * history to see what a balance change actually did.
 */
export function createGameFromReplay(replay: ReplayType): GameType {
  const scenario =
    SCENARIOS.find((s: ScenarioType) => s.id === replay.scenarioId) ||
    SCENARIOS[0];
  // The replay's own location, not the scenario's: that is the whole point of recording it, and
  // it is also what the loading screen uses in the browser
  loadSimData(replay.location);
  let state = gameReducer(undefined, startReplay(replay));
  state = gameReducer(
    state,
    initGame({
      facilities: scenario.facilities,
      cash: scenario.cash,
      customers:
        scenario.startingCustomers || getStartingCustomers(replay.location),
      location: replay.location,
      seed: replay.seed,
    }),
  );
  // Redux Toolkit freezes reducer output in development; the tick loop mutates state in place
  return cloneDeep(state);
}

/**
 * Buys the cheapest generator it can comfortably afford whenever the previous month came up short
 * on supply. Deliberately naive -- the point is to exercise the build, financing and construction
 * paths over a long run, not to play well.
 */
function pickFacilityToBuild(
  state: GameType,
  lastMonth: MonthlyHistoryType,
): GeneratorShoppingType | null {
  const shortfall = lastMonth.demandWh - lastMonth.supplyWh;
  if (shortfall <= lastMonth.demandWh * 0.02) {
    return null; // Close enough to fully supplied
  }
  const now = getTimeFromTimeline(state.date.minute, state.timeline);
  if (!now) {
    return null;
  }
  // Size against the peak gap in watts rather than the month's total watt hours
  const peakW = Math.max(
    50000000,
    Math.min(2000000000, (shortfall / lastMonth.demandWh) * now.demandW * 1.5),
  );
  const affordable = GENERATORS(
    state,
    peakW,
    [now.windKph],
    [now.solarIrradianceWM2],
    now.windOffshoreKph === undefined ? [] : [now.windOffshoreKph],
  )
    .filter(
      (g: GeneratorShoppingType) =>
        g.available &&
        g.buildCost * DIFFICULTIES[state.difficulty].buildCost < now.cash * 0.5,
    )
    .sort(
      (a: GeneratorShoppingType, b: GeneratorShoppingType) =>
        a.buildCost - b.buildCost,
    );
  return affordable[0] || null;
}

function resolveOptions(
  scenario: ScenarioType,
  options: SimOptionsType,
): ResolvedSimOptionsType {
  return {
    scenarioId: scenario.id,
    difficulty: options.difficulty || "Employee",
    months: options.months || scenario.durationMonths || 12 * 20,
    // A scenario carrying its own seed is pinned to it, the same as in a real game; the sim's
    // fixed default only covers the authored scenarios, none of which set one
    seed:
      options.seed !== undefined
        ? options.seed
        : scenario.seed !== undefined
          ? scenario.seed
          : DEFAULT_SEED,
    dollarsPerkWh:
      options.dollarsPerkWh === undefined ? null : options.dollarsPerkWh,
    monthlyMarketingSpend: options.monthlyMarketingSpend || 0,
    strategy: options.strategy || "none",
  };
}

export function runSimulation(options: SimOptionsType): SimResultType {
  const scenario =
    options.scenario ||
    SCENARIOS.find((s: ScenarioType) => s.id === options.scenarioId) ||
    SCENARIOS[0];
  const resolved = resolveOptions(scenario, options);

  loadSimData(scenarioLocation(scenario));
  let state = setUpGame(scenario, resolved);

  const collector = new InvariantCollector();
  const builds: BuildRecordType[] = [];
  let stateOfChargeSum = 0;
  let stateOfChargeTicks = 0;
  let ticks = 0;
  let bankruptAtMonth: number | null = null;
  let previousMonthCount = state.monthlyHistory.length;
  let prevTick: TickPresentFutureType | null = null;
  let justBuilt = false;
  let lastTick: TickPresentFutureType | null = null;

  // tickState fires the game's end-of-run dialogs through setTimeout, which never run here, so the
  // loop watches state directly instead and stops on the same conditions the player would hit:
  // monthsEllapsed reaching the scenario duration, or negative cash at a month rollover.
  while (state.date.monthsEllapsed < resolved.months) {
    tickState(state);
    ticks++;

    const now = getTimeFromTimeline(state.date.minute, state.timeline);
    if (!now) {
      break;
    }
    lastTick = now;

    const rolledOver = state.monthlyHistory.length > previousMonthCount;
    checkTick(
      collector,
      state,
      rolledOver ? null : prevTick,
      now,
      formatWhen(state),
      justBuilt,
    );
    justBuilt = false;

    const storageCapacityWh = state.facilities.reduce(
      (acc: number, f: FacilityOperatingType) => acc + (f.peakWh || 0),
      0,
    );
    if (storageCapacityWh > 0 && Number.isFinite(now.storedWh)) {
      stateOfChargeSum += now.storedWh / storageCapacityWh;
      stateOfChargeTicks++;
    }

    if (!rolledOver) {
      prevTick = now;
      continue;
    }

    previousMonthCount = state.monthlyHistory.length;
    checkMonth(collector, state.monthlyHistory[0], formatWhen(state));

    if (now.cash < 0) {
      bankruptAtMonth = state.date.monthsEllapsed;
      break; // The real game forces a restart here, so anything past it isn't a reachable state
    }

    if (resolved.strategy === "keepUp") {
      const toBuild = pickFacilityToBuild(state, state.monthlyHistory[0]);
      if (toBuild) {
        builds.push({
          month: state.date.monthsEllapsed,
          name: toBuild.name,
          buildCost: toBuild.buildCost,
        });
        // The reducer returns new state rather than mutating, and freezes it in development
        state = cloneDeep(
          gameReducer(
            state,
            buildFacility({ facility: toBuild, financed: true }),
          ),
        );
        justBuilt = true;
      }
    }
    // The timeline was just regenerated and pre-rolled, so tick continuity restarts next tick
    prevTick = null;
  }

  return {
    options: resolved,
    scenario,
    ticks,
    months: [...state.monthlyHistory].reverse(), // Game stores newest first
    finalFacilities: state.facilities as FacilityOperatingType[],
    finalCash: lastTick ? lastTick.cash : 0,
    finalNetWorth: lastTick ? lastTick.netWorth : 0,
    wentBankrupt: bankruptAtMonth !== null,
    bankruptAtMonth,
    builds,
    averageStateOfCharge: stateOfChargeTicks
      ? stateOfChargeSum / stateOfChargeTicks
      : null,
    violations: collector.getViolations(),
    violationCountByRule: collector.getCountByRule(),
    violationCount: collector.getTotalCount(),
  };
}
