/**
 * B2 golden output hashes (docs/perf-plan.md): pins the absolute output of every scenario, not
 * just run-to-run agreement. Each scenario runs the same way `npm run sim -- --all` runs it
 * (default difficulty, duration and strategy; the scenario's own seed, else the simulator's
 * default 12345), and its oldest-first monthly history plus a small final-state summary is
 * hashed.
 *
 * Every finite number is rounded to 10 significant digits before hashing, so last-bit libm or
 * V8 drift doesn't flake the gate while any real behavior change still moves the hash.
 *
 * An intended behavior change: rebaseline with `npm run perf:rebaseline` (which runs
 * `react-scripts test --watchAll=false GoldenOutputs -u`), after all other edits and alongside
 * `npm run compatibility:generate`, and explain the move in the PR. Never hand-edit the
 * snapshot. CI's `--ci` mode never writes snapshots, so a changed hash fails there.
 */
import { createHash } from "crypto";
import { SCENARIOS } from "../data/Scenarios";
import { ScenarioType } from "../Types";
import { runSimulation } from "./Simulator";

jest.setTimeout(600000);

const SIGNIFICANT_DIGITS = 10;

/** Rounds finite numbers and sorts object keys so the JSON is stable across engines. */
function canonicalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return String(value);
    }
    // Normalizes -0 as well, which JSON.stringify would already print as 0
    return value === 0 ? 0 : Number(value.toPrecision(SIGNIFICANT_DIGITS));
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined) {
          sorted[key] = canonicalize(entry);
        }
      });
    return sorted;
  }
  return value;
}

function goldenHash(scenario: ScenarioType): string {
  const result = runSimulation({ scenarioId: scenario.id, scenario });
  const summary = {
    outcome: result.outcome,
    finalMonth: result.months.length,
    finalCash: result.finalCash,
    facilityCount: result.finalFacilities.length,
    facilityNames: result.finalFacilities.map((facility) => facility.name),
  };
  const json = JSON.stringify(
    canonicalize({ monthlyHistory: result.months, summary }),
  );
  return createHash("sha256").update(json).digest("hex");
}

it("keeps every scenario's golden output", () => {
  const hashes: Record<string, string> = {};
  SCENARIOS.forEach((scenario: ScenarioType) => {
    hashes[`${scenario.id} ${scenario.name}`] = goldenHash(scenario);
  });
  expect(hashes).toMatchSnapshot();
});
