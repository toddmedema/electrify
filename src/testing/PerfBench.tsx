/**
 * Entry point for `npm run perf:bench` (benchmarks B1 and headless B7 in docs/perf-plan.md).
 * Deliberately named so CRA's default testMatch ignores it; scripts/perf/bench.js points jest at
 * this file explicitly, the same way scripts/sim.js runs SimCli.tsx.
 *
 * It times the real reducer tick two ways, on the plain object the headless simulator mutates and
 * inside Immer's produce the way the browser's `tick` case reducer pays for it, then times the
 * month-keyed UI forecasts the screens rebuild in the rollover frame. Results go to the file named
 * by PERF_RESULT_FILE; bench.js owns the gating so ceilings stay out of the TS pipeline.
 */
import * as fs from "fs";
// The browser's reducers get Immer through Redux Toolkit, which carries its own (newer) copy.
// A bare "immer" import here would resolve the older one react-scripts hoists instead.
import { createNextState, freeze } from "@reduxjs/toolkit";
import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES, TICKS_PER_MONTH, TICKS_PER_YEAR } from "../Constants";
import { projectMonths } from "../components/views/Finances";
import { GENERATORS, STORAGE } from "../data/Facilities";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { reservoirOutlook } from "../helpers/HydroOutlook";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import gameReducer, {
  buildFacility,
  generateNewTimeline,
  tickState,
} from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import { GameType } from "../Types";
import { createGame } from "./Simulator";

jest.setTimeout(600000);

const WARMUP_MONTHS = 24;

/**
 * The plan's workload was scenario 103 with an 800 MWh battery at month 0, but batteries only
 * become buildable after 2008 and The Shale Boom starts in 2006, and an 800 MWh battery bankrupts
 * the company once they are. This is the nearest workload that plays all 240 months: the battery
 * arrives with the first year it exists, sized so the run survives, at a rate that keeps the
 * company solvent. A bench that stopped at a bankruptcy would silently time a shorter run.
 */
export const WORKLOAD = {
  scenarioId: 103,
  seed: 12345,
  difficulty: "Employee" as const,
  dollarsPerkWh: 0.035,
  months: 240,
  build: {
    month: 36,
    name: "Battery",
    peakWh: 200000000,
    financed: true,
  },
  forecastMonth: 60,
};

interface TickSampleType {
  ms: number;
  rollover: boolean;
  january: boolean;
}

interface RunType {
  plainMsPerTick: number;
  immerMsPerTick: number;
  ticks: number;
  monthsPlayed: number;
  endedEarly: string | null;
  medianOrdinaryMs: number;
  plainMedianOrdinaryMs: number;
  plainMedianRolloverMs: number;
  medianRolloverMs: number;
  worstRolloverMs: number;
  worstJanuaryMs: number;
  forecastState: GameType | null;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function write(s: string) {
  process.stdout.write(s + "\n");
}

/** The same free-choice bot the simulator uses; the game never answers a decision itself. */
function answerPendingChoice(state: GameType): GameType {
  const decision = pendingScenarioChoice(state);
  if (!decision) {
    return state;
  }
  const option = decision.options.find(
    (candidate) => candidate.cost(state.difficulty) === 0,
  );
  if (!option) {
    throw new Error(`Bench has no free response for ${decision.id}`);
  }
  return gameReducer(
    state,
    chooseScenarioResponse({ decisionId: decision.id, optionId: option.id }),
  );
}

function buildScheduled(state: GameType): GameType {
  const { build } = WORKLOAD;
  const facility = STORAGE(state, build.peakWh).find(
    (candidate) => candidate.available && candidate.name === build.name,
  );
  if (!facility) {
    throw new Error(`Cannot build ${build.name} in month ${build.month}`);
  }
  return gameReducer(
    state,
    buildFacility({ facility, financed: build.financed }),
  );
}

/**
 * Plays the workload once. `immer` wraps every tick in produce, as the browser's tick reducer
 * does; otherwise the plain object is mutated in place, as the headless simulator does. Reducer
 * actions between ticks (a choice, the build) are untimed on both paths.
 */
function play(
  months: number,
  immer: boolean,
): {
  totalMs: number;
  samples: TickSampleType[];
  monthsPlayed: number;
  endedEarly: string | null;
  forecastState: GameType | null;
} {
  const created = createGame({
    scenarioId: WORKLOAD.scenarioId,
    seed: WORKLOAD.seed,
    difficulty: WORKLOAD.difficulty,
    dollarsPerkWh: WORKLOAD.dollarsPerkWh,
  });
  // The store's state is frozen; the plain path needs a mutable copy after every reducer call
  let state: GameType = immer ? freeze(created, true) : created;
  const adopt = (next: GameType) => (immer ? next : cloneDeep(next));
  const samples: TickSampleType[] = [];
  let totalMs = 0;
  let endedEarly: string | null = null;
  let forecastState: GameType | null = null;
  const tick = (draft: GameType) => {
    tickState(draft);
  };

  while (state.date.monthsElapsed < months) {
    if (pendingScenarioChoice(state)) {
      state = adopt(answerPendingChoice(state));
    }
    const before = state.monthlyHistory.length;
    const started = performance.now();
    if (immer) {
      state = createNextState(state, tick);
    } else {
      tickState(state);
    }
    const ms = performance.now() - started;
    totalMs += ms;
    const rollover = state.monthlyHistory.length > before;
    samples.push({
      ms,
      rollover,
      january: rollover && state.date.monthNumber === 1,
    });
    if (!rollover) {
      continue;
    }
    const now = getTimeFromTimeline(state.date.minute, state.timeline);
    if (!now || now.cash < 0) {
      endedEarly = `bankrupt at month ${state.date.monthsElapsed}`;
      break;
    }
    if (state.date.monthsElapsed === WORKLOAD.build.month) {
      state = adopt(buildScheduled(state));
    }
    if (immer && state.date.monthsElapsed === WORKLOAD.forecastMonth) {
      forecastState = state;
    }
  }
  return {
    totalMs,
    samples,
    monthsPlayed: state.date.monthsElapsed,
    endedEarly,
    forecastState,
  };
}

function runOnce(months: number): RunType {
  const plain = play(months, false);
  const immer = play(months, true);
  if (plain.samples.length !== immer.samples.length) {
    throw new Error(
      `Plain and Immer paths diverged: ${plain.samples.length} vs ${immer.samples.length} ticks`,
    );
  }
  const ordinary = immer.samples.filter((s) => !s.rollover).map((s) => s.ms);
  const rollovers = immer.samples.filter((s) => s.rollover).map((s) => s.ms);
  const januaries = immer.samples.filter((s) => s.january).map((s) => s.ms);
  const plainOrdinary = plain.samples.filter((s) => !s.rollover);
  const plainRollovers = plain.samples.filter((s) => s.rollover);
  return {
    plainMsPerTick: plain.totalMs / plain.samples.length,
    immerMsPerTick: immer.totalMs / immer.samples.length,
    ticks: immer.samples.length,
    monthsPlayed: immer.monthsPlayed,
    endedEarly: immer.endedEarly,
    medianOrdinaryMs: median(ordinary),
    plainMedianOrdinaryMs: median(plainOrdinary.map((s) => s.ms)),
    plainMedianRolloverMs: median(plainRollovers.map((s) => s.ms)),
    medianRolloverMs: median(rollovers),
    worstRolloverMs: Math.max(...rollovers),
    worstJanuaryMs: januaries.length ? Math.max(...januaries) : NaN,
    forecastState: immer.forecastState,
  };
}

/** Each forecast exactly as its screen calls it on the frame the month rolls over. */
function uiForecasts(game: GameType): { name: string; run: () => unknown }[] {
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const forecastsPane = (years: number) => () => {
    const projectionStepMinutes = years >= 10 ? 60 : TICK_MINUTES;
    const tickScale = projectionStepMinutes / TICK_MINUTES;
    return generateNewTimeline(
      game,
      now.cash,
      now.customers,
      (TICKS_PER_YEAR * years) / tickScale,
      projectionStepMinutes,
    );
  };
  const buildTimeline = () =>
    generateNewTimeline(game, now.cash, now.customers, TICKS_PER_YEAR * 3);
  // The build screen opens on the size of the newest non-storage facility
  const buildPeakW =
    [...game.facilities].filter((f) => !f.peakWh).sort((a, b) => b.id - a.id)[0]
      ?.peakW || 500000000;
  return [
    { name: "Forecasts, 1 year", run: forecastsPane(1) },
    { name: "Forecasts, 5 years", run: forecastsPane(5) },
    {
      name: "Hydro outlook (1 year)",
      run: () =>
        reservoirOutlook(
          now,
          generateNewTimeline(game, now.cash, now.customers, TICKS_PER_YEAR),
          game.startingYear,
        ),
    },
    {
      // The default "this year" range projects the rest of the calendar year
      name: `Finances, this year (${12 - game.date.monthNumber} mo)`,
      run: () =>
        projectMonths(
          game,
          now.cash,
          now.customers,
          12 - game.date.monthNumber,
        ),
    },
    {
      name: "Finances, next 1 year",
      run: () => projectMonths(game, now.cash, now.customers, 12),
    },
    { name: "BuildGenerators 3y timeline", run: buildTimeline },
    {
      name: "BuildGenerators 3y quote (+GENERATORS)",
      run: () => {
        const forecast = buildTimeline();
        return GENERATORS(
          game,
          buildPeakW,
          forecast.map((w) => w.windKph),
          forecast.map((w) => w.solarIrradianceWM2),
          forecast.flatMap((w) =>
            w.windOffshoreKph === undefined ? [] : [w.windOffshoreKph],
          ),
          forecast.map((w) => w.windAirborneKph),
        );
      },
    },
  ];
}

function timeForecasts(game: GameType, reps: number) {
  return uiForecasts(game).map(({ name, run }) => {
    run(); // warmup
    const samples: number[] = [];
    for (let i = 0; i < reps; i++) {
      const started = performance.now();
      run();
      samples.push(performance.now() - started);
    }
    return { name, ms: median(samples) };
  });
}

it("perf bench", () => {
  const benchStarted = performance.now();
  const runs = Math.max(1, Number(process.env.PERF_RUNS) || 3);
  const months = Number(process.env.PERF_MONTHS) || WORKLOAD.months;
  const quiet = process.env.PERF_QUIET === "1";

  // Discarded. Two simulated years are enough to warm the JIT, including rollovers, and a full
  // extra run would add half a minute on the Immer path alone
  runOnce(Math.min(months, WARMUP_MONTHS));
  const measured: RunType[] = [];
  for (let i = 0; i < runs; i++) {
    measured.push(runOnce(months));
  }
  const pick = (key: keyof RunType) =>
    median(measured.map((run) => run[key] as number));
  const immerRatios = measured.map((r) => r.immerMsPerTick / r.plainMsPerTick);
  // The same comparison without the month rollovers, which carry most of the GC noise
  const ordinaryImmerRatios = measured.map(
    (r) => r.medianOrdinaryMs / r.plainMedianOrdinaryMs,
  );
  const rolloverRatios = measured.map(
    (r) => r.worstRolloverMs / r.medianOrdinaryMs,
  );
  // Median rollover over median ordinary tick: the typical hiccup, without the GC-prone maximum
  const typicalRolloverRatios = measured.map(
    (r) => r.medianRolloverMs / r.medianOrdinaryMs,
  );
  const medianRolloverMs = pick("medianRolloverMs");
  const worstRolloverMs = pick("worstRolloverMs");

  const forecastState = measured[0].forecastState;
  const forecasts = forecastState
    ? timeForecasts(forecastState, Math.max(3, runs)).map((f) => ({
        ...f,
        xMedianRollover: f.ms / medianRolloverMs,
        xWorstRollover: f.ms / worstRolloverMs,
      }))
    : [];

  const result = {
    workload: { ...WORKLOAD, months },
    runs,
    ticks: measured[0].ticks,
    monthsPlayed: measured[0].monthsPlayed,
    endedEarly: measured[0].endedEarly,
    ms: {
      plainPerTick: pick("plainMsPerTick"),
      immerPerTick: pick("immerMsPerTick"),
      plainPerSimYear: pick("plainMsPerTick") * TICKS_PER_YEAR,
      immerPerSimYear: pick("immerMsPerTick") * TICKS_PER_YEAR,
      medianOrdinaryTick: pick("medianOrdinaryMs"),
      plainMedianOrdinaryTick: pick("plainMedianOrdinaryMs"),
      plainMedianRolloverTick: pick("plainMedianRolloverMs"),
      medianRolloverTick: medianRolloverMs,
      worstRolloverTick: worstRolloverMs,
      worstJanuaryTick: pick("worstJanuaryMs"),
    },
    ratios: {
      immerOverheadRatio: median(immerRatios),
      ordinaryTickImmerRatio: median(ordinaryImmerRatios),
      rolloverRatio: median(rolloverRatios),
      typicalRolloverRatio: median(typicalRolloverRatios),
    },
    perRun: {
      immerOverheadRatio: immerRatios,
      ordinaryTickImmerRatio: ordinaryImmerRatios,
      rolloverRatio: rolloverRatios,
      typicalRolloverRatio: typicalRolloverRatios,
    },
    forecastMonth: forecastState ? WORKLOAD.forecastMonth : null,
    forecasts,
    ticksPerMonth: TICKS_PER_MONTH,
    benchMs: performance.now() - benchStarted,
  };

  if (process.env.PERF_RESULT_FILE) {
    fs.writeFileSync(process.env.PERF_RESULT_FILE, JSON.stringify(result));
  }
  if (quiet) {
    return;
  }
  const f = (n: number, digits = 3) =>
    Number.isFinite(n) ? n.toFixed(digits) : "-";
  const row = (label: string, value: string) =>
    write(`  ${label.padEnd(44)} ${value}`);
  write("");
  write(
    `  Scenario ${WORKLOAD.scenarioId}, seed ${WORKLOAD.seed}, ${months} months ` +
      `(${result.ticks} ticks), ${runs} warmed runs + a 24-month warmup`,
  );
  if (result.endedEarly) {
    write(`  WARNING: workload ended early (${result.endedEarly})`);
  }
  write("");
  row("Plain ms/tick", f(result.ms.plainPerTick));
  row("Immer ms/tick", f(result.ms.immerPerTick));
  row("Plain ms per simulated year", f(result.ms.plainPerSimYear, 0));
  row("Immer ms per simulated year", f(result.ms.immerPerSimYear, 0));
  row("Plain median ordinary tick (ms)", f(result.ms.plainMedianOrdinaryTick));
  row(
    "Plain median month rollover (ms)",
    f(result.ms.plainMedianRolloverTick, 2),
  );
  row("Immer median ordinary tick (ms)", f(result.ms.medianOrdinaryTick));
  row("Immer median month rollover (ms)", f(medianRolloverMs, 2));
  row("Immer worst month rollover (ms)", f(worstRolloverMs, 2));
  row("Immer worst January rollover (ms)", f(result.ms.worstJanuaryTick, 2));
  row(
    "Immer overhead ratio (gated)",
    `${f(result.ratios.immerOverheadRatio, 2)}  runs: ${immerRatios.map((r) => f(r, 2)).join(" ")}`,
  );
  row(
    "Immer ordinary-tick ratio",
    `${f(result.ratios.ordinaryTickImmerRatio, 2)}  runs: ${ordinaryImmerRatios.map((r) => f(r, 2)).join(" ")}`,
  );
  row(
    "Worst rollover ratio (worst/median)",
    `${f(result.ratios.rolloverRatio, 1)}  runs: ${rolloverRatios.map((r) => f(r, 1)).join(" ")}`,
  );
  row(
    "Typical rollover ratio (gated)",
    `${f(result.ratios.typicalRolloverRatio, 1)}  runs: ${typicalRolloverRatios.map((r) => f(r, 1)).join(" ")}`,
  );
  if (forecasts.length) {
    write("");
    write(
      `  UI forecasts at the month ${WORKLOAD.forecastMonth} rollover        ms    × median rollover  × worst`,
    );
    forecasts.forEach((forecast) =>
      row(
        forecast.name,
        `${f(forecast.ms, 1).padStart(8)}  ${f(forecast.xMedianRollover, 1).padStart(10)}  ${f(forecast.xWorstRollover, 1).padStart(10)}`,
      ),
    );
  }
  write("");
  row("Bench time in jest (s)", f(result.benchMs / 1000, 1));
});
