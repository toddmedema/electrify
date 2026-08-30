/**
 * Entry point for `npm run sim`. Deliberately named so that CRA's default testMatch ignores it --
 * scripts/sim.js points jest at this file explicitly, so it never runs as part of `npm test`.
 *
 * Output goes straight to stdout rather than through console.log, which jest decorates with a
 * stack trace after every call.
 */
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { DifficultyType, ScenarioType } from "../Types";
import { formatReport } from "./Report";
import { getSimLocation, simLocationIds } from "./SimData";
import { TICKS_PER_YEAR } from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { generateNewTimeline } from "../reducers/Game";
import {
  createGame,
  runSimulation,
  SimOptionsType,
  StrategyType,
} from "./Simulator";
import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";

export const STANDARD_BALANCE_SEEDS = Array.from(
  { length: 20 },
  (_, index) => index + 1,
);
const MATRIX_DIFFICULTIES: DifficultyType[] = [
  "Intern",
  "Employee",
  "Manager",
  "VP",
  "CEO",
];

jest.setTimeout(600000);

function write(s: string) {
  process.stdout.write(s + "\n");
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : Number(raw);
}

/**
 * An authored scenario played somewhere or somewhen else, for --year and --location.
 *
 * Comes back under CUSTOM_SCENARIO_ID because that is what it now is. initGame resolves the
 * scenario it builds from through getScenario(), which reads an authored id straight back out of
 * SCENARIOS -- so an edited copy handed over under its original id has its edits silently thrown
 * away, and the run reports the year it was actually played rather than the one that was asked
 * for. The name is kept so the report still says which scenario it started from.
 */
function withOverrides(scenario: ScenarioType): ScenarioType | undefined {
  const year = envNumber("SIM_YEAR");
  const locationId = process.env.SIM_LOCATION;
  if (year === undefined && !locationId) {
    return undefined;
  }
  if (locationId && !getSimLocation(locationId)) {
    throw new Error(
      `Unknown location "${locationId}". Downloaded: ${simLocationIds().join(", ")}`,
    );
  }
  return {
    ...scenario,
    id: CUSTOM_SCENARIO_ID,
    startingYear: year === undefined ? scenario.startingYear : year,
    ...(locationId
      ? { locationId, location: getSimLocation(locationId) }
      : undefined),
  };
}

function baseOptions(): Omit<SimOptionsType, "scenarioId"> {
  const initialBuildName = process.env.SIM_BUILD;
  return {
    difficulty: (process.env.SIM_DIFFICULTY as DifficultyType) || undefined,
    months: envNumber("SIM_MONTHS"),
    seed: envNumber("SIM_SEED"),
    dollarsPerkWh: envNumber("SIM_RATE"),
    strategy: (process.env.SIM_STRATEGY as StrategyType) || undefined,
    initialBuild: initialBuildName
      ? {
          name: initialBuildName,
          peakW: (envNumber("SIM_BUILD_MW") || 300) * 1000000,
          financed: process.env.SIM_FINANCE === "1",
        }
      : undefined,
    sellFacilityId: envNumber("SIM_SELL_ID"),
    sellAtMonth: envNumber("SIM_SELL_MONTH"),
    storyEffectsEnabled: process.env.SIM_WITHOUT_STORIES !== "1",
  };
}

/** One line per scenario, so a full sweep fits on a screen and regressions stand out. */
function runSweep() {
  const options = baseOptions();
  let totalViolations = 0;
  write("");
  write(
    "  SCENARIO                  MONTHS   OUTCOME              CASH      UNSERVED  INVARIANTS",
  );
  write(
    "  ------------------------- -------- -------------------- --------- --------- ----------",
  );
  SCENARIOS.forEach((scenario: ScenarioType) => {
    const result = runSimulation({
      ...options,
      scenarioId: scenario.id,
      scenario: withOverrides(scenario),
    });
    totalViolations += result.violationCount;
    const demandWh = result.months.reduce((a, m) => a + m.demandWh, 0);
    const supplyWh = result.months.reduce((a, m) => a + m.supplyWh, 0);
    const cash = result.finalCash;
    const outcome =
      result.outcome === "bankrupt"
        ? `bankrupt @ month ${result.bankruptAtMonth}`
        : result.outcome === "fired"
          ? `fired @ month ${result.firedAtMonth}`
          : "completed";
    write(
      "  " +
        scenario.name.slice(0, 25).padEnd(26) +
        String(result.options.months).padEnd(9) +
        outcome.padEnd(21) +
        `$${Math.round(cash / 1000000).toLocaleString("en-US")}M`.padEnd(10) +
        (demandWh
          ? `${((100 * (demandWh - supplyWh)) / demandWh).toFixed(1)}%`
          : "-"
        ).padEnd(10) +
        (result.violationCount === 0
          ? "ok"
          : `${result.violationCount} FAILED`),
    );
    result.violations.forEach((v) => {
      write(`      ! ${v.rule} @ ${v.when}: ${v.detail}`);
    });
  });
  write("");
  write(
    totalViolations === 0
      ? "  All scenarios hold every invariant."
      : `  ${totalViolations} invariant violations across the sweep.`,
  );
  write("");
}

function matrixRecord(result: ReturnType<typeof runSimulation>) {
  const demandWh = result.months.reduce(
    (total, month) => total + month.demandWh,
    0,
  );
  const supplyWh = result.months.reduce(
    (total, month) => total + month.supplyWh,
    0,
  );
  const generationMix = result.months.reduce<Record<string, number>>(
    (totals, month) => {
      Object.entries(month.deliveredWhByFuel).forEach(([fuel, wh]) => {
        totals[fuel] = (totals[fuel] || 0) + (wh || 0);
      });
      return totals;
    },
    {},
  );
  return {
    seed: result.options.seed,
    outcome: result.outcome,
    outcomeMonth:
      result.bankruptAtMonth ?? result.firedAtMonth ?? result.months.length,
    unservedShare:
      demandWh > 0 ? Math.max(0, (demandWh - supplyWh) / demandWh) : 0,
    endingCash: result.finalCash,
    generationMix,
    phaseKeys: result.storyOccurrences.map((event) => event.key),
    selectedIds: result.storyOccurrences.flatMap((event) =>
      Array.isArray(event.attributes.selectedFacilityIds)
        ? (event.attributes.selectedFacilityIds as number[])
        : [],
    ),
    resolvedEffects: result.storyOccurrences.map((event) => event.effects),
  };
}

function runMatrix() {
  const scenarios = SCENARIOS.filter((scenario: ScenarioType) =>
    [100, 101, 102, 103, 104, 105].includes(scenario.id),
  );
  let failedGates = 0;
  write("");
  write(
    "  SCENARIO                  DIFFICULTY BASELINE  STORY FAILURES  GATE",
  );
  write(
    "  ------------------------- ---------- --------- --------------- --------------------",
  );
  scenarios.forEach((scenario) => {
    MATRIX_DIFFICULTIES.forEach((difficulty) => {
      const records = STANDARD_BALANCE_SEEDS.map((seed) => {
        const common = {
          ...STANDARD_BALANCE_PLAYS[scenario.id],
          scenarioId: scenario.id,
          difficulty,
          seed,
        };
        return {
          baseline: matrixRecord(
            runSimulation({ ...common, storyEffectsEnabled: false }),
          ),
          story: matrixRecord(
            runSimulation({ ...common, storyEffectsEnabled: true }),
          ),
        };
      });
      const otherwiseSuccessful = records.filter(
        ({ baseline }) => baseline.outcome === "completed",
      );
      const storyFailures = otherwiseSuccessful.filter(
        ({ story }) => story.outcome !== "completed",
      ).length;
      const enoughCoverage = otherwiseSuccessful.length >= 12;
      const failureRate = enoughCoverage
        ? storyFailures / otherwiseSuccessful.length
        : null;
      const passed = failureRate !== null && failureRate <= 0.25;
      if (!passed) {
        failedGates++;
      }
      write(
        "  " +
          scenario.name.slice(0, 25).padEnd(26) +
          difficulty.padEnd(11) +
          String(otherwiseSuccessful.length).padEnd(10) +
          String(storyFailures).padEnd(16) +
          (!enoughCoverage
            ? "INSUFFICIENT COVERAGE"
            : `${(100 * (failureRate || 0)).toFixed(1)}% ${passed ? "ok" : "FAILED"}`),
      );
      if (process.env.SIM_FULL === "1") {
        write(JSON.stringify({ scenarioId: scenario.id, difficulty, records }));
      }
    });
  });
  write("");
  write(
    failedGates === 0
      ? "  Story balance matrix passed every coverage and failure-rate gate."
      : `  ${failedGates} story balance matrix gates need attention.`,
  );
  write("");
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function benchmarkForecast(storyEffectsDisabled: boolean): number {
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    const state = createGame({
      scenarioId: 103,
      difficulty: "Manager",
      seed: 7,
    });
    state.storyEffectsDisabled = storyEffectsDisabled;
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const started = performance.now();
    generateNewTimeline(state, now.cash, now.customers, TICKS_PER_YEAR * 20);
    const elapsed = performance.now() - started;
    if (sample > 0) {
      samples.push(elapsed);
    }
  }
  return median(samples);
}

function runStoryBenchmark() {
  const baselineMs = benchmarkForecast(true);
  const storyMs = benchmarkForecast(false);
  const regression = storyMs / baselineMs - 1;
  write("");
  write(`  20-year forecast without stories  ${baselineMs.toFixed(1)} ms`);
  write(`  20-year forecast with stories     ${storyMs.toFixed(1)} ms`);
  write(
    `  Story resolution regression       ${(regression * 100).toFixed(1)}%`,
  );
  write("");
  expect(regression).toBeLessThanOrEqual(0.15);
}

function runSingle() {
  const scenarioId = envNumber("SIM_SCENARIO") ?? 101;
  const base = SCENARIOS.find((s: ScenarioType) => s.id === scenarioId);
  const started = Date.now();
  const result = runSimulation({
    ...baseOptions(),
    scenarioId,
    scenario: base && withOverrides(base),
  });
  write(
    formatReport(result, {
      maxRows: process.env.SIM_FULL === "1" ? result.months.length : undefined,
      elapsedMs: Date.now() - started,
    }),
  );
}

it("simulation", () => {
  if (process.env.SIM_STORY_BENCHMARK === "1") {
    runStoryBenchmark();
  } else if (process.env.SIM_MATRIX === "1") {
    runMatrix();
  } else if (process.env.SIM_ALL === "1") {
    runSweep();
  } else {
    runSingle();
  }
});
