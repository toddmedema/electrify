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
import { runSimulation, SimOptionsType, StrategyType } from "./Simulator";

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
  if (process.env.SIM_ALL === "1") {
    runSweep();
  } else {
    runSingle();
  }
});
