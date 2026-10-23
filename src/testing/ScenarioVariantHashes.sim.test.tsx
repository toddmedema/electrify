/**
 * Pins the output of runs GoldenOutputs does not play: the native official scenarios at CEO on
 * another seed, the two redesigned arcs at every difficulty, and an ordinary custom game that
 * selects every official arc. Rebaseline like GoldenOutputs, with `npm run perf:rebaseline`.
 */
import { DIFFICULTY_IDS } from "../Constants";
import type { ScenarioType } from "../Types";
import { digest } from "./CanonicalHash";
import customScenario from "./fixtures/scenarios/all-official-arcs.json";
import { expectNoViolations } from "./SimulationTestHelpers";
import { runSimulation, type SimOptionsType } from "./Simulator";

jest.setTimeout(600000);

const OFFICIAL_IDS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
];

function runHash(options: SimOptionsType): string {
  const result = runSimulation(options);
  expectNoViolations(result);
  return digest({
    months: result.months,
    finalFacilities: result.finalFacilities,
    outcome: result.outcome,
    finalCash: result.finalCash,
    finalDebt: result.finalDebt,
    objectiveResults: result.objectiveResults,
    storyOccurrences: result.storyOccurrences,
  });
}

it("pins every official scenario at CEO on another seed", () => {
  const hashes: Record<string, string> = {};
  for (const scenarioId of OFFICIAL_IDS)
    hashes[scenarioId] = runHash({ scenarioId, difficulty: "CEO", seed: 1 });
  expect(hashes).toMatchSnapshot();
});

it("pins the redesigned wildfire and load shedding arcs at every difficulty", () => {
  const hashes: Record<string, string> = {};
  for (const scenarioId of [111, 113])
    for (const difficulty of DIFFICULTY_IDS)
      hashes[`${scenarioId} ${difficulty}`] = runHash({
        scenarioId,
        difficulty,
        seed: 12345,
      });
  expect(hashes).toMatchSnapshot();
});

it("pins an ordinary custom game that selects every official arc", () => {
  const scenario = customScenario as unknown as ScenarioType;
  expect(scenario.mod).toBeUndefined();
  expect(
    runHash({ scenarioId: 999, scenario, difficulty: "Employee" }),
  ).toMatchSnapshot();
});
