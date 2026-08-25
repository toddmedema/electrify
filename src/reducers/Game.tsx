import type { AppDispatch } from "../Store";
import cloneDeep from "lodash.clonedeep";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import numbro from "numbro";
import { submitHighscore } from "./User";
import {
  getDateFromMinute,
  getMonthYearFromMinute,
  getTimeFromTimeline,
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
import { getSolarOutputFactor, getWindOutputFactor } from "../helpers/Energy";
import { getFuelPricesPerMBTU } from "../data/FuelPrices";
import { getWeather, getRawSolarIrradianceWM2 } from "../data/Weather";
import { dialogOpen, dialogClose, snackbarOpen } from "./UI";
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
  state = buildFacilityHelper(state, payload.facility, payload.financed);
  // Assigned rather than spread into a new object: this is an immer draft, so a fresh object
  // assigned to the parameter is discarded and the forecast would never reach state
  state.timeline = reforecastSupply(state);
}

function applySellFacility(state: GameType, id: number) {
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
          {completed} of {TUTORIALS.length} tutorials complete
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
    actionLabel: nextTutorial ? "Next tutorial" : "Back to tutorials",
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
    if (inBlackout !== previouslyInBlackout) {
      previouslyInBlackout = inBlackout;
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
      state.timeline = generateNewTimeline(state, cash, customers);

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
                and emitted ${numbro(summary.kgco2e / 1000).format({ thousandSeparated: true, mantissa: 0 })} tons of pollution.`,
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
                and emitted ${numbro(summary.kgco2e / 1000).format({ thousandSeparated: true, mantissa: 0 })} tons of pollution.`,
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
        const blackoutsTWh =
          Math.max(0, summary.demandWh - summary.supplyWh) / 1000000000000;
        // Scoring algorithm should also be updated in Game.tsx
        const score: ScoreBreakdownType =
          scenario.ownership === "Investor"
            ? {
                supply: Math.round(summary.supplyWh / 1000000000000),
                netWorth: Math.round((40 * summary.netWorth) / 1000000000),
                customers: Math.round((2 * summary.customers) / 100000),
                emissions: Math.round((-2 * summary.kgco2e) / 1000000000),
                blackouts: Math.round(-8 * blackoutsTWh),
              }
            : {
                rate: Math.round(
                  80 *
                    100 *
                    (scenario.dollarsPerkWh -
                      summary.revenue / (summary.supplyWh / 1000)),
                ),
                supply: Math.round((10 * summary.supplyWh) / 1000000000000),
                emissions: Math.round((-5 * summary.kgco2e) / 1000000000),
                blackouts: Math.round(-10 * blackoutsTWh),
              };

        const finalScore = Object.values(score).reduce((a, b) => a + b);
        const difficulty = state.difficulty; // pulling out of state for functions running inside of setTimeout
        // For a custom game getScenario() returns state.customScenario, which belongs to the same
        // draft, so the fields the timeouts below read come out here too
        const {
          id: scoredScenarioId,
          endTitle,
          endMessage,
          ownership,
        } = scenario;
        const isTutorial = Boolean(scenario.tutorialSteps);
        // Read out here with everything else the timeouts need, rather than from inside them
        const nextTutorial = getNextTutorial(scoredScenarioId);

        // The leaderboard is keyed on scenario id alone, so custom runs - whatever cash, duration
        // and rules the player gave themselves - would be scored against each other as if they
        // were the same scenario
        if (!scenario.tutorialSteps && ranked) {
          // Pulled out of the draft here rather than inside the timeout, which runs after the
          // reducer has returned and revoked it
          const replay = serializeReplay(state);
          setTimeout(
            () =>
              getStore().dispatch(
                submitHighscore({
                  score: finalScore,
                  scoreBreakdown: score, // For analytics purposes only
                  scenarioId: scoredScenarioId,
                  difficulty,
                  replay,
                }),
              ),
            1,
          );
        }

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
                title: endTitle || "Tutorial complete!",
                message: endMessage,
                nextTutorial,
              }),
            );
          }
          getStore().dispatch(
            dialogOpen({
              title: endTitle || `You've retired!`,
              message: endMessage || (
                <div>
                  Your final score is {finalScore}:<br />
                  <br />
                  {score.supply} pts from electricity supplied
                  <br />
                  {ownership === "Investor" && (
                    <span>
                      {score.netWorth} pts from final net worth
                      <br />
                    </span>
                  )}
                  {ownership === "Investor" && (
                    <span>
                      {score.customers} pts from final customers
                      <br />
                    </span>
                  )}
                  {ownership === "Public" && (
                    <span>
                      {score.rate} pts from electric rates
                      <br />
                    </span>
                  )}
                  {score.emissions} pts from emissions
                  <br />
                  {score.blackouts} pts from blackouts
                  <br />
                </div>
              ),
              open: true,
              closeText: "Keep playing",
              actionLabel: "Return to scenarios",
              action: () => getStore().dispatch(quit({ toScenarioList: true })),
            }),
          );
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
  const { sunrise, sunset } = getSunriseSunset(date, game.location);

  // https://www.eia.gov/todayinenergy/detail.php?id=830
  // https://www.e-education.psu.edu/ebf200/node/151
  // Demand estimation: http://www.iitk.ac.in/npsc/Papers/NPSC2016/1570293957.pdf
  // Pricing estimation: http://www.stat.cmu.edu/tr/tr817/tr817.pdf
  const temperatureNormalized =
    0.0035 * Math.pow(now.temperatureC, 2) - 0.035 * now.temperatureC;
  const minutesFromDarkNormalized =
    Math.min(date.minuteOfDay - sunrise, sunset - date.minuteOfDay) / 420;
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
  return demandMultiple * now.customers;
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
      const fuelPrices = getFuelPricesPerMBTU(date, state.seed);
      return {
        ...t,
        ...fuelPrices,
        solarIrradianceWM2: getRawSolarIrradianceWM2(
          date,
          state.location,
          weather.CLOUD_PCT,
        ),
        windKph: OUTSKIRTS_WIND_MULTIPLIER * weather.WIND_KPH,
        temperatureC: weather.TEMP_C,
        storedWh: 0,
        supplyByFuel: {} as FuelProductionType,
      } as TickPresentFutureType;
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
        setTimeout(() => {
          getStore().dispatch(snackbarOpen(message));
        }, 0);
      }
    }
  });

  const windOutputFactor = getWindOutputFactor(now.windKph);
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
  facilities.forEach((g: FacilityShoppingType) => {
    if (g.yearsToBuildLeft === 0) {
      if (g.paused) {
        // paused facilities only pay half of their operating costs
        expensesOM += g.annualOperatingCost / TICKS_PER_YEAR / 2;
      } else {
        expensesOM += g.annualOperatingCost / TICKS_PER_YEAR;
      }
      if (g.fuel && FUELS[g.fuel]) {
        const fuelBtu =
          ((g.currentW * (g.btuPerWh || 0)) / TICKS_PER_HOUR) *
          GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
        expensesFuel +=
          (fuelBtu * getFuelPricesPerMBTU(date, state.seed)[g.fuel]) / 1000000;
        kgco2e += fuelBtu * FUELS[g.fuel].kgCO2ePerBtu;
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
      }
    } else {
      expensesInterest +=
        getPaymentInterest(g.loanAmountLeft, g.interestRate) / TICKS_PER_MONTH;
    }
  });
  const expensesCarbonFee = state.feePerKgCO2e * kgco2e;
  const expensesMarketing = state.monthlyMarketingSpend / TICKS_PER_MONTH;

  // Customers
  const percentDemandUnfulfilled = (demandWh - supplyWh) / demandWh;
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
