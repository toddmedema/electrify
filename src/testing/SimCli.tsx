/**
 * Entry point for `npm run sim`. Deliberately named so that CRA's default testMatch ignores it --
 * scripts/sim.js points jest at this file explicitly, so it never runs as part of `npm test`.
 *
 * Output goes straight to stdout rather than through console.log, which jest decorates with a
 * stack trace after every call.
 */
import { SCENARIOS } from "../data/Scenarios";
import { DifficultyType, ScenarioType } from "../Types";
import { formatReport } from "./Report";
import { runSimulation, SimOptionsType, StrategyType } from "./Simulator";

jest.setTimeout(600000);

function write(s: string) {
  process.stdout.write(s + "\n");
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : Number(raw);
}

function baseOptions(): Omit<SimOptionsType, "scenarioId"> {
  return {
    difficulty: (process.env.SIM_DIFFICULTY as DifficultyType) || undefined,
    months: envNumber("SIM_MONTHS"),
    seed: envNumber("SIM_SEED"),
    dollarsPerkWh: envNumber("SIM_RATE"),
    monthlyMarketingSpend: envNumber("SIM_MARKETING"),
    strategy: (process.env.SIM_STRATEGY as StrategyType) || undefined,
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
    const result = runSimulation({ ...options, scenarioId: scenario.id });
    totalViolations += result.violationCount;
    const demandWh = result.months.reduce((a, m) => a + m.demandWh, 0);
    const supplyWh = result.months.reduce((a, m) => a + m.supplyWh, 0);
    const cash = result.finalCash;
    const outcome = result.wentBankrupt
      ? `bankrupt @ month ${result.bankruptAtMonth}`
      : "survived";
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
  const scenarioId = envNumber("SIM_SCENARIO");
  const started = Date.now();
  const result = runSimulation({
    ...baseOptions(),
    scenarioId: scenarioId === undefined ? 101 : scenarioId,
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
