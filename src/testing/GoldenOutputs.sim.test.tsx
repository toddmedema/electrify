/**
 * B2 golden output hashes (docs/perf-plan.md): pins the absolute output of every scenario, not
 * just run-to-run agreement. Each scenario runs the same way `npm run sim -- --all` runs it
 * (default difficulty, duration and strategy; the scenario's own seed, else the simulator's
 * default 12345), and its oldest-first monthly history plus a small final-state summary is
 * hashed. Every one of those runs must also hold the economy's invariants, which the CLI sweep only
 * prints.
 *
 * Every finite number is rounded to 10 significant digits before hashing, so last-bit libm or
 * V8 drift doesn't flake the gate while any real behavior change still moves the hash. The
 * hashes hold on every OS only because simulation code raises powers with helpers/Pow rather
 * than Math.pow, whose last bit comes from the platform's C library (see docs/perf-plan.md).
 *
 * An intended behavior change: rebaseline with `npm run perf:rebaseline` (which runs
 * `react-scripts test --watchAll=false GoldenOutputs -u`), after all other edits and alongside
 * `npm run compatibility:generate`, and explain the move in the PR. Never hand-edit the
 * snapshot. CI's `--ci` mode never writes snapshots, so a changed hash fails there.
 */
import { digest } from "./CanonicalHash";
import { SCENARIOS } from "../data/Scenarios";
import { ScenarioType } from "../Types";
import { expectNoViolations } from "./SimulationTestHelpers";
import { runSimulation } from "./Simulator";

jest.setTimeout(600000);

function goldenHash(scenario: ScenarioType): string {
  const result = runSimulation({ scenarioId: scenario.id, scenario });
  expectNoViolations(result);
  const summary = {
    outcome: result.outcome,
    finalMonth: result.months.length,
    finalCash: result.finalCash,
    facilityCount: result.finalFacilities.length,
    facilityNames: result.finalFacilities.map((facility) => facility.name),
  };
  return digest({ monthlyHistory: result.months, summary });
}

it("keeps every scenario's golden output", () => {
  const hashes: Record<string, string> = {};
  SCENARIOS.forEach((scenario: ScenarioType) => {
    hashes[`${scenario.id} ${scenario.name}`] = goldenHash(scenario);
  });
  expect(hashes).toMatchSnapshot();
});
