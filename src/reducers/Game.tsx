import type { AppDispatch } from "../Store";
import cloneDeep from "lodash.clonedeep";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
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
  customersFromMarketingSpend,
  facilityCashBack,
  getCreditInputs,
  getCreditPremium,
  getMonthlyPayment,
  getPaymentInterest,
} from "../helpers/Financials";
import { getInflationRate, getPrimeRate } from "../data/Economy";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
} from "../helpers/Format";
import { arrayMove, newSeed } from "../helpers/Math";
import { computeScoreBreakdown, totalScore } from "../helpers/Scoring";
import { formatLargeMass } from "../helpers/Units";
import {
  getOffshoreWindOutputFactor,
  getSolarOutputFactor,
  getWindOutputFactor,
} from "../helpers/Energy";
import { getFuelPricesPerMBTU } from "../data/FuelPrices";
import {
  activeWorldEventEffects,
  resolveWorldEvent,
  WORLD_EVENT_DEFINITIONS,
} from "../data/WorldEvents";
import { getWeather, getRawSolarIrradianceWM2 } from "../data/Weather";
import {
  dialogOpen,
  dialogClose,
  snackbarOpen,
  victoryOpen,
  victoryClose,
} from "./UI";
import { navigate, navigateBack } from "./Card";
import {
  DIFFICULTIES,
  DOWNPAYMENT_PERCENT,
  FUELS,
  GAME_TO_REAL_YEARS,
  GENERATOR_SELL_MULTIPLIER,
  INTEREST_RATE_YEARLY,
  LOAN_MONTHS,
  ORGANIC_GROWTH_MAX_ANNUAL,
  RESERVE_MARGIN,
  TICK_MINUTES,
  TICK_MS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
  YEARS_PER_TICK,
  OUTSKIRTS_WIND_MULTIPLIER,
  LOCATIONS,
} from "../Constants";
import { GENERATORS, STORAGE } from "../data/Facilities";
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
  ScenarioType,
  ScoreBreakdownType,
  SpeedType,
  StorageOperatingType,
  TickPresentFutureType,
  FuelProductionType,
  ReplayActionType,
  CardNameType,
} from "../Types";

interface BuildFacilityAction {
  facility: FacilityShoppingType;
  financed: boolean;
}

interface ReprioritizeFacilityAction {
  spotInList: number;
  delta: number;
}

interface NewGameAction {
  facilities: Array<Partial<FacilityShoppingType>>;
  cash: number;
  customers: number;
  location: LocationType;
  seed?: number; // Omitted in normal play; pin it to get a reproducible run (headless sim, bug repros)
}

let previousTickMs = 0;
// Only for restoring speed after a blocking dialog (bankrupt/fired/win) closes -- NOT used to
// decide whether the tick loop needs restarting, since state.speed can change without going
// through setSpeed (e.g. dialogClose below), which would desync a "previous speed" comparison.
let speedBeforeDialog = "PAUSED" as SpeedType;
// Same idea for the manual, which is a full-screen card over a game that would otherwise keep
// ticking -- looking up "Blackouts" mid-crisis used to cause blackouts. Undefined whenever the
// manual isn't what paused us, so leaving any other card doesn't resume a deliberate pause.
let speedBeforeManual: SpeedType | undefined;
// Tracks whether the self-rescheduling tick() loop is currently alive, so that any transition
// out of PAUSED (manual speed click, tutorial script, dialog closing) reliably restarts it.
let tickLoopRunning = false;
let previousMonth = "";
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
    actionTarget?: CardNameType;
    reportedKey?: string;
    pause?: boolean;
  } = {},
): boolean {
  if (
    options.reportedKey &&
    (state.reportedEventKeys || []).includes(options.reportedKey)
  ) {
    return false;
  }
  if (!state.eventLog) {
    state.eventLog = [];
  }
  const log = state.eventLog;
  log.unshift({
    id: (log.length > 0 ? log[0].id : 0) + 1,
    kind,
    label: `${state.date.month} ${state.date.year}`,
    message,
    importance: options.importance,
    actionTarget: options.actionTarget,
  });
  if (options.reportedKey) {
    state.reportedEventKeys = state.reportedEventKeys || [];
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
function logFuelPriceMoves(state: GameType) {
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
    const change = (prices[fuel] - previous[fuel]) / previous[fuel];
    if (Math.abs(change) < FUEL_PRICE_SPIKE) {
      return;
    }
    logGameEvent(
      state,
      "FUEL_PRICE",
      `${fuel} ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% to ${formatMoneyConcise(prices[fuel])}/MBTU`,
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
  return generator.annualOperatingCost / annualMWh + fuelCost + carbonCost;
}

function currentFuelCosts(
  state: GameType,
): Partial<Record<FuelNameType, number>> {
  const costs: Partial<Record<FuelNameType, number>> = {};
  const prices = getEffectiveFuelPrices(state.date, state);
  state.facilities.forEach((facility: FacilityOperatingType) => {
    const generator = facility as Partial<GeneratorOperatingType>;
    if (!generator.fuel) {
      return;
    }
    const cost = generatorCostPerMWh(
      facility as GeneratorOperatingType,
      prices,
      state.feePerKgCO2e,
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
          actionTarget: "FACILITIES",
          reportedKey: `fuel-crossover:${fuel}`,
          pause: true,
        },
      );
    },
  );
}

const MAX_WORLD_EVENT_CHECKS = 2400;

/** Starts/ends authored events before this month's forecast is built. */
function updateWorldEvents(state: GameType) {
  state.worldEvents = state.worldEvents || { active: [], checkedKeys: [] };
  state.worldEvents.active = state.worldEvents.active.filter(
    (event) => event.endsMinute > state.date.minute,
  );
  WORLD_EVENT_DEFINITIONS.forEach((definition) => {
    const resolved = resolveWorldEvent(definition, {
      seed: state.seed,
      date: state.date,
      location: state.location,
    });
    if (state.worldEvents!.checkedKeys.includes(resolved.checkedKey)) {
      return;
    }
    state.worldEvents!.checkedKeys.push(resolved.checkedKey);
    if (resolved.occurrence) {
      state.worldEvents!.active.push(resolved.occurrence);
      logGameEvent(
        state,
        resolved.occurrence.kind,
        resolved.occurrence.message,
        {
          importance: resolved.occurrence.importance,
          actionTarget: resolved.occurrence.actionTarget,
          reportedKey: `world-event:${resolved.occurrence.key}`,
          pause: resolved.occurrence.importance === "CRITICAL",
        },
      );
    }
  });
  if (state.worldEvents.checkedKeys.length > MAX_WORLD_EVENT_CHECKS) {
    state.worldEvents.checkedKeys.splice(
      0,
      state.worldEvents.checkedKeys.length - MAX_WORLD_EVENT_CHECKS,
    );
  }
}

function getEffectiveFuelPrices(
  date: DateType,
  state: GameType,
): FuelPricesType {
  const prices = getFuelPricesPerMBTU(date, state.seed, state.location);
  const multipliers = activeWorldEventEffects(
    state.worldEvents?.active,
    date.minute,
  ).fuelPriceMultipliers;
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
  monthlyMarketingSpend: 0,
  // Placeholders until initGame prices the company against the year it actually starts in. The
  // new game screens read these before any economic data has been loaded.
  interestRate: INTEREST_RATE_YEARLY,
  creditPremium: 1,
  tutorialStep: -1, // Not set to 0 until after card transition, so that the target element exists
  facilities: [] as FacilityOperatingType[],
  startingYear: 2020,
  date: getDateFromMinute(0, 2020),
  timeline: [] as TickPresentFutureType[],
  monthlyHistory: [] as MonthlyHistoryType[],
  eventLog: [] as GameEventType[],
};

// Restarts the self-rescheduling tick() loop when leaving PAUSED, unless it's already running.
// Using a "is it running" flag rather than comparing against a remembered previous speed means
// this works no matter how state.speed changed (setSpeed, dialogClose, or a future caller).
function ensureTicking(state: GameType) {
  if (state.speed !== "PAUSED" && !tickLoopRunning) {
    tickLoopRunning = true;
    previousTickMs = performance.now();
    setTimeout(
      () => getStore().dispatch(gameSlice.actions.tick()),
      TICK_MS[state.speed],
    );
  }
}

// Puts the clock back the way the player left it before the manual paused it
function restoreSpeedAfterManual(state: GameType) {
  if (speedBeforeManual === undefined) {
    return;
  }
  state.speed = speedBeforeManual;
  speedBeforeManual = undefined;
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

      // update simulation if accumulated delta exceeds frame time
      // calculate multiple simulation frames per render if on a slow device
      let delta = performance.now() - previousTickMs;
      while (delta > TICK_MS[state.speed]) {
        tickState(state);
        delta -= TICK_MS[state.speed];
        previousTickMs = performance.now();
      }

      setTimeout(
        () => getStore().dispatch(gameSlice.actions.tick()),
        Math.max(1, TICK_MS[state.speed] - delta),
      );
    },
    delta: (state, action: PayloadAction<Partial<GameType>>) => {
      // Assigned onto the draft rather than spread into a new object, which is equivalent for a
      // partial merge and is what lets the recorder below append to the draft's own log. Immer
      // rejects a reducer that both mutates its draft and returns a replacement for it
      Object.assign(state, action.payload);
      const recorded = recordedDelta(action.payload);
      if (recorded) {
        recordReplayAction(state, "delta", recorded);
      }
    },
    initGame: (state, action: PayloadAction<NewGameAction>) => {
      const a = action.payload;
      // Without this a second game in the same session inherits the first one's month and skips
      // its first rollover, which also makes an otherwise identical seed produce a different run
      previousMonth = "";
      previouslyInBlackout = false;
      blackoutUnservedWh = 0;
      previousFuelPrices = undefined;
      state.eventLog = [] as GameEventType[];
      state.reportedEventKeys = [];
      state.eventLogReadThroughId = 0;
      state.worldEvents = { active: [], checkedKeys: [] };
      state.fuelCostSnapshot = undefined;
      state.timeline = [] as TickPresentFutureType[];
      // A game being watched is not a game being recorded; anything else starts an empty log,
      // which is also what tells serializeReplay the run was recorded from its very first minute
      state.replayLog = state.replayPlayback ? undefined : [];
      state.seed = a.seed !== undefined ? a.seed : newSeed();
      const scenario =
        getScenario(state.scenarioId, state.customScenario) || SCENARIOS[0];
      state.date = getDateFromMinute(0, scenario.startingYear);
      state.startingYear = scenario.startingYear;
      // A company on day one has no track record, no debt and nothing but cash, so it borrows at
      // whatever prime was in the year the scenario opens -- 4.75% in 2019, 21.5% in 1980. It is
      // repriced against its own results at the first month rollover, and every one after.
      state.creditPremium = getCreditPremium(
        getCreditInputs([], a.cash, a.cash, []),
      );
      state.interestRate =
        getPrimeRate(state.date, state.seed) * state.creditPremium;
      state.feePerKgCO2e = scenario.feePerKgCO2e;
      // The rate the scenario advertises on the new game screen, and the rate Public scenarios are
      // scored against, so the game has to actually start there rather than at the slice default
      state.dollarsPerkWh = scenario.dollarsPerkWh;
      state.location = a.location;
      state.timeline = generateNewTimeline(state, a.cash, a.customers);

      a.facilities.forEach((search: Partial<FacilityShoppingType>) => {
        const generator = GENERATORS(
          state,
          search.peakW || 1000000,
          [],
          [],
        ).find((g: FacilityShoppingType) => {
          for (const property in search) {
            if (g[property] !== search[property]) {
              return false;
            }
          }
          return true;
        });
        if (generator) {
          state = buildFacilityHelper(state, generator, false, true);
        } else {
          const storage = STORAGE(state, search.peakWh || 1000000).find(
            (g: FacilityShoppingType) => {
              for (const property in search) {
                if (g[property] !== search[property]) {
                  return false;
                }
              }
              return true;
            },
          );
          if (storage) {
            state = buildFacilityHelper(state, storage, false, true);
          } else {
            // A spec that matches nothing used to vanish without a trace, which is a rough way to
            // find out that the technology you picked wasn't invented yet in the year you started
            console.warn(
              `No facility matches ${JSON.stringify(search)} in ${scenario.startingYear}, skipping it`,
            );
          }
        }
      });

      // Pre-roll a few frames once we have weather and demand info so generators and batteries start in a more accurate state
      for (let i = 0; i < 4; i++) {
        updateSupplyFacilitiesFinances(
          state,
          state.timeline[0],
          state.timeline[0],
          true,
        );
      }
      state.timeline = reforecastSupply(state);
      // Establish the comparison before time moves. A fleet that was already dearer on day one
      // has not crossed anything; the first monthly ordering change is the event.
      state.fuelCostSnapshot = currentFuelCosts(state);
      // Anything the player did before the clock first moved -- setting a rate or a marketing
      // budget on the way in. tickState picks up everything after this
      applyPendingReplayActions(state);
    },
    buildFacility: (state, action: PayloadAction<BuildFacilityAction>) => {
      applyBuildFacility(state, action.payload);
      recordReplayAction(state, "buildFacility", action.payload);
    },
    sellFacility: (state, action: PayloadAction<number>) => {
      applySellFacility(state, action.payload);
      recordReplayAction(state, "sellFacility", action.payload);
    },
    togglePauseFacility: (state, action: PayloadAction<number>) => {
      applyTogglePauseFacility(state, action.payload);
      recordReplayAction(state, "togglePauseFacility", action.payload);
    },
    reprioritizeFacility: (
      state,
      action: PayloadAction<ReprioritizeFacilityAction>,
    ) => {
      applyReprioritizeFacility(state, action.payload);
      recordReplayAction(state, "reprioritizeFacility", action.payload);
    },
    setSpeed: (state, action: PayloadAction<SpeedType>) => {
      state.speed = action.payload;
      ensureTicking(state);
    },
    markEventsRead: (state) => {
      state.eventLogReadThroughId = state.eventLog?.[0]?.id || 0;
    },
  },
  // start, loaded and quit are declared in GameActions so that Card and UI can react to them
  // without importing this module -- see the note there
  extraReducers: (builder) => {
    builder.addCase(start, (state, action) => {
      state.scenarioId = action.payload;
      // An empty timeline is how the loading screen tells a new game from a resumed one, so make
      // that true by construction rather than by whichever paths happen to lead here
      state.timeline = [] as TickPresentFutureType[];
    });
    builder.addCase(resume, (_state, action) => {
      const restored = cloneDeep(action.payload);
      // The tick loop's module-level locals have to line up with the state being restored.
      // Unlike initGame, this one keeps the month: clearing it would make the first tick record a
      // second history entry for a month that's already in the log.
      previousMonth = restored.date.month;
      const now = getTimeFromTimeline(restored.date.minute, restored.timeline);
      previouslyInBlackout = now ? now.supplyW < now.demandW : false;
      blackoutStartMinute = restored.date.minute;
      blackoutUnservedWh = 0;
      previousFuelPrices = undefined;
      speedBeforeDialog = "PAUSED";
      // Never resume mid-tick; loaded() flips inGame once the CSVs are back
      restored.speed = "PAUSED";
      restored.inGame = false;
      // Saves written before replays existed have no log, and a run recorded from halfway
      // through would play back as a different game. Undefined is how the recorder is told to
      // stay off for the rest of this run, so the score it eventually sets carries no replay
      if (!Array.isArray(restored.replayLog)) {
        restored.replayLog = undefined;
      }
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
      speedBeforeManual = undefined;
      speedBeforeDialog = "PAUSED";
      return {
        ...cloneDeep(initialGame),
        scenarioId: replay.scenarioId,
        difficulty: replay.difficulty,
        seed: replay.seed,
        // The loading screen reads this back rather than looking the scenario's location up,
        // which is what makes the replay run against the weather the original player saw
        location: cloneDeep(replay.location),
        replayPlayback: { actions: cloneDeep(replay.actions), index: 0 },
      };
    });
    builder.addCase(loaded, (state) => {
      // Start ticking in game
      setTimeout(() => {
        return getStore().dispatch(gameSlice.actions.tick());
      }, TICK_MS.PAUSED);
      state.inGame = true;
    });
    builder.addCase(quit, () => {
      speedBeforeManual = undefined;
      return cloneDeep(initialGame);
    });
    // Opening the manual pauses the game, and closing it puts the speed back. Without this the
    // sim runs on while the player reads, which punishes them for looking something up
    builder.addCase(navigate, (state, action) => {
      const payload = action.payload;
      const name = typeof payload === "string" ? payload : payload?.name;
      if (name !== "MANUAL") {
        // Navigating anywhere else (rather than backing out) still counts as leaving it
        restoreSpeedAfterManual(state);
      } else if (state.inGame && speedBeforeManual === undefined) {
        speedBeforeManual = state.speed;
        state.speed = "PAUSED";
      }
    });
    builder.addCase(navigateBack, restoreSpeedAfterManual);
    builder.addCase(dialogOpen, (state) => {
      speedBeforeDialog = state.speed;
      state.speed = "PAUSED";
    });
    builder.addCase(dialogClose, (state) => {
      state.speed = speedBeforeDialog;
      ensureTicking(state);
    });
    // The score screen stops the clock the same way any other dialog does - "Keep playing"
    // resumes at whatever speed the run was going when it ended
    builder.addCase(victoryOpen, (state) => {
      speedBeforeDialog = state.speed;
      state.speed = "PAUSED";
    });
    builder.addCase(victoryClose, (state) => {
      state.speed = speedBeforeDialog;
      ensureTicking(state);
    });
  },
});

export const {
  tick,
  delta,
  initGame,
  buildFacility,
  sellFacility,
  togglePauseFacility,
  reprioritizeFacility,
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
function applyBuildFacility(state: GameType, payload: BuildFacilityAction) {
  const built = payload.facility;
  logGameEvent(
    state,
    "BUILD",
    `Building ${built.name}, ${built.peakWh ? formatWattHours(built.peakWh) : formatWatts(built.peakW)}${payload.financed ? " (financed)" : ""}`,
  );
  state = buildFacilityHelper(state, built, payload.financed);
  // Assigned rather than spread into a new object: this is an immer draft, so a fresh object
  // assigned to the parameter is discarded and the forecast would never reach state
  state.timeline = reforecastSupply(state);
}

function applySellFacility(state: GameType, id: number) {
  const sold = state.facilities.find((g: FacilityOperatingType) => g.id === id);
  if (sold) {
    logGameEvent(
      state,
      sold.yearsToBuildLeft > 0 ? "BUILD" : "SELL",
      sold.yearsToBuildLeft > 0
        ? `Cancelled construction of ${sold.name}`
        : `Sold ${sold.name}, ${sold.peakWh ? formatWattHours(sold.peakWh) : formatWatts(sold.peakW)} for ${formatMoneyConcise(facilityCashBack(sold))}`,
    );
  }
  // in one loop, refund cash from selling + remove from list
  state.facilities = state.facilities.filter(
    (g: GeneratorOperatingType | StorageOperatingType) => {
      if (g.id === id) {
        const now = getTimeFromTimeline(state.date.minute, state.timeline);
        if (now) {
          now.cash += facilityCashBack(g);
        }
        return false;
      }
      return true;
    },
  );
  state.timeline = reforecastSupply(state);
}

function applyTogglePauseFacility(state: GameType, id: number) {
  state.facilities.forEach(
    (g: GeneratorOperatingType | StorageOperatingType) => {
      if (g.id === id) {
        g.paused = !g.paused;
      }
    },
  );
  state.timeline = reforecastSupply(state);
}

function applyReprioritizeFacility(
  state: GameType,
  payload: ReprioritizeFacilityAction,
) {
  arrayMove(
    state.facilities,
    payload.spotInList,
    payload.spotInList + payload.delta,
  );
  state.timeline = reforecastSupply(state);
}

/**
 * Replays one recorded action. The payload came off the network, so anything shaped wrong is
 * skipped rather than allowed to crash the sim mid-tick -- a replay that plays back slightly
 * wrong is a disappointment, one that throws takes the whole game down with it.
 */
function applyReplayAction(state: GameType, entry: ReplayActionType) {
  const payload = entry.payload;
  switch (entry.type) {
    case "buildFacility": {
      const build = payload as Partial<BuildFacilityAction>;
      if (typeof build?.facility === "object" && build.facility !== null) {
        applyBuildFacility(state, {
          facility: build.facility,
          financed: !!build.financed,
        });
      }
      break;
    }
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
      if (recorded) {
        Object.assign(state, recorded);
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
function tutorialCompleteDialog({
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
    secondaryLabel: "Main menu",
    secondaryAction: () => getStore().dispatch(quit()),
    actionLabel: nextTutorial ? "Next mission" : "Back to missions",
    action: () =>
      nextTutorial
        ? startTutorial(getStore().dispatch, nextTutorial.id)
        : getStore().dispatch(quit({ toScenarioList: true })),
  });
}

// Ticks the state forward in place
// Exported so the headless simulator (src/testing/Simulator.tsx) can drive the sim
// without the wall-clock timers that the `tick` action uses.
export function tickState(state: GameType) {
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
          `Blackout over after ${blackoutLength(state.date.minute - blackoutStartMinute)} - ${formatWattHours(blackoutUnservedWh)} unserved`,
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

    if (previousMonth !== state.date.month) {
      previousMonth = state.date.month;
      const history = state.monthlyHistory;
      const { cash, customers } = now;

      // Record final history for the month, then generate the new timeline
      history.unshift(summarizeTimeline(state.timeline, state.startingYear));
      // Reprice the company's credit off the year that just closed, before the forecast is built
      // against it. Once a month, not once a tick: a lender looks at a year of results, and a
      // rate that moved every tick would be unplannable.
      state.creditPremium = getCreditPremium(
        getCreditInputs(history, cash, now.netWorth, state.facilities),
      );
      state.interestRate =
        getPrimeRate(state.date, state.seed) * state.creditPremium;
      updateWorldEvents(state);
      state.timeline = generateNewTimeline(state, cash, customers);
      logFuelPriceMoves(state);
      logFuelCrossovers(state);

      // Pre-roll a few frames to compensate for temperature / demand jumps across months
      for (let i = 0; i < 4; i++) {
        updateSupplyFacilitiesFinances(
          state,
          state.timeline[0],
          state.timeline[0],
          true,
        );
      }

      // ===== TRIGGERS ======
      // state is an Immer draft, and it's revoked the moment this reducer returns - so anything
      // the timeouts below need has to be read out here rather than from inside their callbacks
      const scenarioId = state.scenarioId;
      // A replay reaches every one of these the same way the original run did, and must set off
      // none of their side effects: it is not a played game, it has no score of its own to
      // submit, and the save it would clear belongs to whoever is watching. The dialogs still
      // show, since a replay ending with "Bankrupt!" is the point of watching it
      const isReplay = !!state.replayPlayback;

      // Failure: Bankrupt
      if (now.cash < 0) {
        if (!isReplay) {
          logEvent("scenario_end", {
            id: scenarioId,
            type: "bankrupt",
            difficulty: state.difficulty,
          });
        }
        const summary = summarizeHistory(history);
        setTimeout(() => {
          // In the timeout rather than here in the reducer: the autosave subscriber runs as soon
          // as this returns and would write the run straight back
          if (!isReplay) {
            clearSaveFor(scenarioId);
          }
          const finished = getStore().getState().game;
          getStore().dispatch(
            dialogOpen({
              title: "Bankrupt!",
              message: `You've run out of money.
                You survived for ${finished.date.year - finished.startingYear} years,
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${formatLargeMass(summary.kgco2e, getStore().getState().settings.units)} of pollution.`,
              open: true,
              notCancellable: true,
              actionLabel: "Try again",
              action: () => getStore().dispatch(quit({ toScenarioList: true })),
            }),
          );
        }, 1);
      }

      // Failure: Too many blackouts
      if (
        history[1] &&
        history[2] &&
        history[3] &&
        history[1].supplyWh < history[1].demandWh * 0.9 &&
        history[2].supplyWh < history[2].demandWh * 0.9 &&
        history[3].supplyWh < history[3].demandWh * 0.9
      ) {
        if (!isReplay) {
          logEvent("scenario_end", {
            id: scenarioId,
            type: "blackouts",
            difficulty: state.difficulty,
          });
        }
        const summary = summarizeHistory(history);
        setTimeout(() => {
          if (!isReplay) {
            clearSaveFor(scenarioId);
          }
          const finished = getStore().getState().game;
          getStore().dispatch(
            dialogOpen({
              title: "Fired!",
              message: `You've allowed chronic blackouts for 3 months, causing shareholders to remove you from office.
                You survived for ${finished.date.year - finished.startingYear} years,
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${formatLargeMass(summary.kgco2e, getStore().getState().settings.units)} of pollution.`,
              open: true,
              notCancellable: true,
              actionLabel: "Try again",
              action: () => getStore().dispatch(quit({ toScenarioList: true })),
            }),
          );
        }, 1);
      }

      const scenario =
        getScenario(state.scenarioId, state.customScenario) || SCENARIOS[0];

      // Success: Survived duration
      if (state.date.monthsEllapsed === (scenario.durationMonths || 12 * 20)) {
        // Every custom game shares one id, so recording it would light up a completion marker for
        // a scenario nobody authored, and its score belongs to nothing comparable
        const ranked = scenario.id !== CUSTOM_SCENARIO_ID && !isReplay;
        if (ranked) {
          // Tutorials are already marked played once their walkthrough ends, so this is a
          // no-op for the ones the player sat all the way through
          recordScenarioPlayed(scenarioId);
        }

        // Calculate score - This is also described in the manual; if I update the algorithm, update the manual too!
        const summary = summarizeHistory(history);
        const score: ScoreBreakdownType = computeScoreBreakdown(
          scenario,
          summary,
        );
        const finalScore = totalScore(score);
        const difficulty = state.difficulty; // pulling out of state for functions running inside of setTimeout
        // For a custom game getScenario() returns state.customScenario, which belongs to the same
        // draft, so the fields the timeouts below read come out here too
        const {
          id: scoredScenarioId,
          name: scenarioName,
          endTitle,
          endMessage,
        } = scenario;
        const isTutorial = Boolean(scenario.tutorialSteps);
        // Read out here with everything else the timeouts need, rather than from inside them
        const nextTutorial = getNextTutorial(scoredScenarioId);

        // The leaderboard is keyed on scenario id alone, so custom runs - whatever cash, duration
        // and rules the player gave themselves - would be scored against each other as if they
        // were the same scenario
        const submitsScore = !scenario.tutorialSteps && ranked;
        // Pulled out of the draft here rather than inside the timeout, which runs after the
        // reducer has returned and revoked it
        const replay = submitsScore ? serializeReplay(state) : undefined;

        if (!isReplay) {
          logEvent("scenario_end", {
            id: scoredScenarioId,
            type: "win",
            difficulty,
            score: finalScore,
          });
        }
        setTimeout(() => {
          // The scenario is over even if the player takes "Keep playing"; autosave simply writes a
          // fresh save at the next month rollover if they do
          if (!isReplay) {
            clearSaveFor(scenarioId);
          }
          if (isTutorial) {
            return getStore().dispatch(
              tutorialCompleteDialog({
                title: endTitle || "Mission complete!",
                message: endMessage,
                nextTutorial,
              }),
            );
          }
          // Read here rather than up in the reducer: store.getState() throws while a reducer is
          // running, and this sat in tickState, so the throw came out of the tick loop's own
          // setTimeout - nothing rescheduled the loop and nothing opened a dialog, and the game
          // stopped dead on the last month of every run. Still read before the submit below, so
          // that "was 640" reports the run before this one rather than the one that just finished
          const previousBest =
            getStore().getState().user.bests?.[String(scoredScenarioId)]?.score;
          // Only the numbers: the breakdown, the personal best and the rank are base/VictoryDialog's
          // to render, so that the parts which arrive over the network can fill themselves in
          getStore().dispatch(
            victoryOpen({
              scenarioId: scoredScenarioId,
              scenarioName,
              difficulty,
              score: finalScore,
              breakdown: score,
              endTitle,
              endMessage,
              ranked,
              previousBest,
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
      }
    }
  }

  // After the tick, the way a player's click lands after the tick that brought the clock to it
  applyPendingReplayActions(state);
}

// Simplified customer forecast, assumes no blackouts since supply calculation depends on demand (circular depedency)
function getDemandW(
  date: DateType,
  game: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
) {
  const marketingGrowth =
    customersFromMarketingSpend(game.monthlyMarketingSpend) / TICKS_PER_MONTH;
  now.customers = Math.round(
    prev.customers * (1 + ORGANIC_GROWTH_MAX_ANNUAL / TICKS_PER_YEAR) +
      marketingGrowth,
  );
  const sun = getSunriseSunset(date, game.location);

  // https://www.eia.gov/todayinenergy/detail.php?id=830
  // https://www.e-education.psu.edu/ebf200/node/151
  // Demand estimation: http://www.iitk.ac.in/npsc/Papers/NPSC2016/1570293957.pdf
  // Pricing estimation: http://www.stat.cmu.edu/tr/tr817/tr817.pdf
  const temperatureNormalized =
    0.0035 * Math.pow(now.temperatureC, 2) - 0.035 * now.temperatureC;
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
    70 * temperatureNormalized -
    40 * minutesFrom9amLogistics +
    30 * minutesFromDarkLogistics -
    65 * minutesFrom5pmLogistics;
  const effects = activeWorldEventEffects(
    game.worldEvents?.active,
    date.minute,
  );
  return demandMultiple * now.customers * (effects.demandMultiplier || 1);
}

const KG_PER_MEGATON = 1000000000;

/**
 * Everything the player has emitted so far, in megatons of CO2e, which is what the weather warms
 * and destabilises in proportion to.
 *
 * Summed from the monthly history rather than carried as its own field so that it needs no
 * migration, no place in a save, and no chance of disagreeing with the emissions the player is
 * actually scored on. The history is one entry per month -- a few hundred at the very most -- and
 * this runs once per reforecast, not once per tick.
 */
function getCumulativeMegatons(monthlyHistory: MonthlyHistoryType[]): number {
  let kgco2e = 0;
  for (let i = 0; i < monthlyHistory.length; i++) {
    kgco2e += monthlyHistory[i].kgco2e;
  }
  return kgco2e / KG_PER_MEGATON;
}

function reforecastWeatherAndPrices(
  state: GameType,
  cumulativeMegatons: number,
): TickPresentFutureType[] {
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      const weather = getWeather(date, state.seed, cumulativeMegatons);
      const fuelPrices = getEffectiveFuelPrices(date, state);
      const effects = activeWorldEventEffects(
        state.worldEvents?.active,
        date.minute,
      );
      const forecast = {
        ...t,
        ...fuelPrices,
        solarIrradianceWM2: getRawSolarIrradianceWM2(
          date,
          state.location,
          weather.CLOUD_PCT,
        ),
        windKph: OUTSKIRTS_WIND_MULTIPLIER * weather.WIND_KPH,
        temperatureC: weather.TEMP_C + (effects.temperatureOffsetC || 0),
        storedWh: 0,
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

function reforecastDemand(state: GameType): TickPresentFutureType[] {
  let prev = state.timeline[0];
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      t.demandW = getDemandW(date, state, prev, t);
      prev = t;
      return t;
    }
    return t;
  });
}

// Updates game state and now in place
function updateSupplyFacilitiesFinances(
  state: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
  simulated?: boolean,
) {
  const { facilities, date } = state;
  const difficulty = DIFFICULTIES[state.difficulty];

  // Update facility construction status
  facilities.forEach((f: FacilityOperatingType) => {
    if (f.yearsToBuildLeft > 0) {
      f.yearsToBuildLeft = Math.max(0, f.yearsToBuildLeft - YEARS_PER_TICK);
      if (f.yearsToBuildLeft === 0 && !simulated) {
        const message = `Construction complete: ${f.name}, ${f.peakWh ? formatWattHours(f.peakWh) : formatWatts(f.peakW)}`; // defining for functions running inside of setTimeout
        logGameEvent(state, "CONSTRUCTION", message);
        setTimeout(() => {
          getStore().dispatch(snackbarOpen(message));
        }, 0);
      }
    }
  });

  const windOutputFactor = getWindOutputFactor(now.windKph);
  const offshoreWindOutputFactor = getOffshoreWindOutputFactor(
    now.windOffshoreKph || 0,
  );
  const solarOutputFactor = getSolarOutputFactor(
    now.solarIrradianceWM2,
    now.temperatureC,
  );

  // Pre-check how much extra supply we'll need to charge batteries
  let indexOfLastUnchargedBattery = -1;
  let totalChargeNeeded = 0;
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.peakWh && g.currentWh < g.peakWh && g.yearsToBuildLeft === 0) {
      indexOfLastUnchargedBattery = i;
      totalChargeNeeded += Math.min(
        g.peakW,
        (g.peakWh - g.currentWh) * TICKS_PER_HOUR,
      );
    }
  });

  // Update supply and facility outputs
  let supply = 0;
  const supplyByFuel = {} as FuelProductionType;
  let charge = 0;
  let storedWh = 0;
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.paused) {
      g.currentW = Math.max(
        0,
        g.currentW - (g.peakW * TICK_MINUTES) / g.spinMinutes,
      ); // ramp down
      return;
    }
    if (g.yearsToBuildLeft === 0) {
      if (g.fuel) {
        // Capable of generating electricity
        const targetW = Math.max(
          0,
          now.demandW * (1 + RESERVE_MARGIN) - supply,
        );
        switch (g.fuel) {
          case "Sun":
            g.currentW = g.peakW * solarOutputFactor;
            break;
          case "Wind":
            g.currentW = g.peakW * windOutputFactor;
            break;
          case "Offshore Wind":
            g.currentW = g.peakW * offshoreWindOutputFactor;
            break;
          default: // on-demand produces up to demand + reserve margin
            if (targetW > g.currentW || i < indexOfLastUnchargedBattery) {
              // spinning up
              // If there's a battery to charge after me, output as much as possible to charge it beyond demand
              if (
                indexOfLastUnchargedBattery >= 0 &&
                i < indexOfLastUnchargedBattery
              ) {
                g.currentW = Math.min(
                  now.demandW + totalChargeNeeded - charge,
                  g.peakW,
                  g.currentW + (g.peakW * TICK_MINUTES) / g.spinMinutes,
                );
              } else {
                // Otherwise just try to fulfill demand + reserve margin
                g.currentW = Math.min(
                  g.peakW,
                  targetW,
                  g.currentW + (g.peakW * TICK_MINUTES) / g.spinMinutes,
                );
              }
            } else {
              g.currentW = Math.max(
                0,
                targetW,
                g.currentW - (g.peakW * TICK_MINUTES) / g.spinMinutes,
              );
            }
            break;
        }
        supply += g.currentW;
        supplyByFuel[g.fuel] = (supplyByFuel[g.fuel] || 0) + g.currentW;
      }
      if (g.peakWh) {
        // Capable of storing electricity
        const targetW = Math.max(0, now.demandW - supply);
        if (g.currentWh > 0 && targetW > 0) {
          // If there's a need and we have charge, discharge
          g.currentW = Math.min(g.peakW, targetW, g.currentWh * TICKS_PER_HOUR);
          g.currentWh = Math.max(0, g.currentWh - g.currentW / TICKS_PER_HOUR);
          supply += g.currentW;
        } else if (g.currentWh < g.peakWh && supply - charge > now.demandW) {
          // If there's spare capacity, charge
          g.currentW = -Math.min(
            g.peakW,
            supply - now.demandW - charge,
            (g.peakWh - g.currentWh) * TICKS_PER_HOUR,
          );
          g.currentWh = Math.min(
            g.peakWh,
            g.currentWh - g.currentW / TICKS_PER_HOUR,
          );
          charge -= g.currentW / g.roundTripEfficiency;
        } else {
          // Otherwise, don't charge or discharge: reset to 0
          g.currentW = 0;
        }
        storedWh += g.currentWh;
      }
    }
  });
  now.supplyW = supply;
  now.supplyByFuel = supplyByFuel;
  now.storedWh = storedWh;

  // Update finances
  // TODO have starting dollarsPerkWh rate by location, based on historic prices (not as fulfilling) - or at least use to double check
  const supplyWh =
    (Math.min(now.supplyW, now.demandW) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const demandWh = (now.demandW / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const revenue = (supplyWh / 1000) * state.dollarsPerkWh;

  // Facilities expenses
  let kgco2e = 0;
  let expensesOM = 0;
  let expensesFuel = 0;
  let expensesInterest = 0;
  let principalRepayment = 0;
  // Hoisted out of the loop below, the way the demand pass at the top of this file already does
  // it: prices move by the month, and this is per facility per tick
  const fuelPrices = getEffectiveFuelPrices(date, state);
  // What one facility earns is its share of what the company actually sold, so the row can say
  // whether it has paid for itself. Curtailed output earns nothing, which pro-rating against the
  // served total is exactly what expresses
  const revenuePerSuppliedW = supply > 0 ? revenue / supply : 0;
  facilities.forEach((g: FacilityShoppingType) => {
    // Everything this facility costs the company this tick, so it can be booked against the
    // facility as well as into the company's own totals below
    let facilityExpenses = 0;
    if (g.yearsToBuildLeft === 0) {
      if (g.paused) {
        // paused facilities only pay half of their operating costs
        facilityExpenses += g.annualOperatingCost / TICKS_PER_YEAR / 2;
      } else {
        facilityExpenses += g.annualOperatingCost / TICKS_PER_YEAR;
      }
      expensesOM += facilityExpenses;
      if (g.fuel && FUELS[g.fuel]) {
        const fuelBtu =
          ((g.currentW * (g.btuPerWh || 0)) / TICKS_PER_HOUR) *
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
        facilityExpenses += facilityFuel + state.feePerKgCO2e * facilityKgco2e;
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
          (g.loanMonthlyPayment - paymentInterest) / TICKS_PER_MONTH,
          g.loanAmountLeft,
        );
        expensesInterest += paymentInterest / TICKS_PER_MONTH;
        principalRepayment += paymentPrincipal;
        g.loanAmountLeft -= paymentPrincipal;
        // The last payment of a loan is the only interesting one, and nothing else on screen
        // marks it: the interest line simply stops going down
        if (!simulated && g.loanAmountLeft <= 0) {
          logGameEvent(state, "LOAN", `Loan paid off: ${g.name}`);
        }
        facilityExpenses += paymentInterest / TICKS_PER_MONTH;
      }
      // Only a real tick is a tick of this facility's life. The pre-roll frames after a month
      // rollover and every tick of every forecast come through here too, and neither happened
      if (!simulated) {
        // What the supply pass above actually counted: a paused facility is still winding
        // down, and those watts are deliberately left out of the company's supply, so
        // crediting them here would book revenue nobody was paid for. Its potential keeps
        // accruing though -- being switched off is exactly what a capacity factor is for
        const deliveredW = g.paused ? 0 : Math.max(0, g.currentW);
        g.lifetimeWh =
          (g.lifetimeWh || 0) +
          (deliveredW / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
        g.lifetimePotentialWh =
          (g.lifetimePotentialWh || 0) +
          (g.peakW / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
        g.lifetimeRevenue =
          (g.lifetimeRevenue || 0) + deliveredW * revenuePerSuppliedW;
        g.lifetimeExpenses = (g.lifetimeExpenses || 0) + facilityExpenses;
      }
    } else {
      facilityExpenses =
        getPaymentInterest(g.loanAmountLeft, g.interestRate) / TICKS_PER_MONTH;
      expensesInterest += facilityExpenses;
      // A half-built plant is already costing interest, and a row that only started counting on
      // the day it switched on would hide the cheapest place to notice that
      if (!simulated) {
        g.lifetimeExpenses = (g.lifetimeExpenses || 0) + facilityExpenses;
      }
    }
  });
  const expensesCarbonFee = state.feePerKgCO2e * kgco2e;
  const expensesMarketing = state.monthlyMarketingSpend / TICKS_PER_MONTH;

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
  const marketingGrowth =
    customersFromMarketingSpend(state.monthlyMarketingSpend) / TICKS_PER_MONTH;

  // Save new financial info
  now.customers = Math.round(
    prev.customers * (1 + organicGrowthRate / TICKS_PER_YEAR) + marketingGrowth,
  );
  now.cash = Math.round(
    prev.cash +
      revenue -
      expensesOM -
      expensesFuel -
      expensesCarbonFee -
      expensesInterest -
      expensesMarketing -
      principalRepayment,
  );
  now.netWorth = getNetWorth(facilities, now.cash);
  now.revenue = revenue;
  now.expensesOM = expensesOM;
  now.expensesFuel = expensesFuel;
  now.expensesCarbonFee = expensesCarbonFee;
  now.expensesInterest = expensesInterest;
  now.expensesMarketing = expensesMarketing;
  now.kgco2e = kgco2e;
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

function reforecastSupply(
  state: GameType,
  simulated?: boolean,
): TickPresentFutureType[] {
  // updateSupplyFacilitiesFinances ramps generators, charges batteries and pays down loans by
  // mutating the facilities in place, so forecasting has to run against a copy of them. A shallow
  // spread shares the same facility objects, which let a forecast leave the real fleet sitting at
  // its end-of-horizon state -- resuming a paused nuclear plant snapped straight to full output
  // instead of ramping, and every reforecast silently aged construction and loans by a whole day.
  const newState = { ...state, facilities: cloneDeep(state.facilities) };
  let prev = newState.timeline[0];
  return newState.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      t = updateSupplyFacilitiesFinances(newState, prev, { ...t }, simulated);
    }
    prev = t;
    return t;
  });
}

export function generateNewTimeline(
  readOnlyState: GameType,
  cash: number,
  customers: number,
  ticks = TICKS_PER_DAY,
): TickPresentFutureType[] {
  // Everything below runs against a private copy, because reforecastSupply ramps generators and
  // pays down loans by mutating the facilities it is handed. Only the facilities need the deep
  // clone though: the timeline is overwritten on the very next line, and by the end of a long
  // scenario the monthly history is hundreds of entries that nothing in the forecast reads.
  // Deep cloning either of them was work thrown away, on a function that can run a year of
  // simulation several times a second.
  const state = {
    ...readOnlyState,
    facilities: cloneDeep(readOnlyState.facilities),
    monthlyHistory: [] as MonthlyHistoryType[],
    timeline: new Array(ticks) as TickPresentFutureType[],
  };
  const cumulativeMegatons = getCumulativeMegatons(
    readOnlyState.monthlyHistory,
  );
  // Loop invariant: the fleet is fixed across the horizon and the cash is a parameter, so this
  // was the same number recomputed for every one of up to a year's worth of ticks
  const netWorth = getNetWorth(state.facilities, cash);
  for (let i = 0; i < ticks; i++) {
    state.timeline[i] = {
      minute: state.date.minute + i * TICK_MINUTES,
      supplyW: 0,
      demandW: 0,
      solarIrradianceWM2: 0,
      windKph: 0,
      temperatureC: 0,
      cash,
      customers,
      netWorth,
      revenue: 0,
      expensesFuel: 0,
      expensesOM: 0,
      expensesCarbonFee: 0,
      expensesInterest: 0,
      expensesMarketing: 0,
      kgco2e: 0,
      // Both overwritten by updateSupplyFacilitiesFinances, from each tick's own date
      interestRate: 0,
      inflationRate: 0,
      // reforecastWeatherAndPrices sets both of these on the next line, for every tick from
      // the current minute onwards -- which is all of them, since the timeline starts there.
      // Initialised anyway so a tick is a complete TickPresentFutureType the moment it exists,
      // rather than one that happens to be patched up before anything reads it.
      storedWh: 0,
      supplyByFuel: {} as FuelProductionType,
      // Asserted because FuelPricesType carries a `[index: string]: number` index signature,
      // which a fresh object literal with a non-number field cannot satisfy. Same reason
      // reforecastWeatherAndPrices asserts its own tick literal.
    } as TickPresentFutureType;
  }
  // Read off the caller's history, not the blanked copy above, and frozen for the whole horizon:
  // what the player emits over the coming month is exactly what the forecast cannot know. It
  // advances at the month rollover, which is when this runs, so the forecast never shifts under a
  // player mid-month.
  state.timeline = reforecastWeatherAndPrices(state, cumulativeMegatons);
  state.timeline = reforecastDemand(state);
  state.timeline = reforecastSupply(state, true);
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
    const facility = {
      ...g,
      ...financing,
      id:
        state.facilities.reduce(
          (max: number, f: FacilityOperatingType) => (max > f.id ? max : f.id),
          0,
        ) + 1,
      currentW: newGame && g.peakWh === undefined ? g.peakW : 0,
      yearsToBuildLeft: newGame ? 0 : g.yearsToBuild,
      minuteCreated: state.date.minute,
    } as FacilityOperatingType;
    if (g.peakWh) {
      facility.currentWh = 0;
      state.facilities.push(facility); // add storage to bottom so that it's on by default
    } else {
      state.facilities.unshift(facility); // add generators to top so that they produce by default
    }
  }

  return state;
}

// TODO account for generator current value better - get rid of SELL_MULTIPLIER everywhere and depreciate buildCost over time
function getNetWorth(
  facilities: FacilityOperatingType[],
  cash: number,
): number {
  let netWorth = cash;
  facilities.forEach((g: FacilityOperatingType) => {
    if (g.yearsToBuildLeft === 0) {
      netWorth += g.buildCost * GENERATOR_SELL_MULTIPLIER - g.loanAmountLeft;
    } else {
      netWorth += g.buildCost * DOWNPAYMENT_PERCENT;
    }
  });
  return netWorth;
}
