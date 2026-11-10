import cloneDeep from "lodash.clonedeep";
import { CHERNOBYL_SCENARIO_ID } from "../data/ChernobylScenario";
import type { RuleObjective } from "../data/ScenarioRules";
import { getMissionStatus } from "../helpers/MissionStatus";
import { projectMission } from "../helpers/MissionProjection";
import { selectProjection } from "../helpers/Projection";
import { currentTick } from "../helpers/GameSelectors";
import {
  gameObjectiveResults,
  scenarioObjectiveDefinitions,
} from "../helpers/ObjectiveRules";
import { parseSave } from "../SaveGame";
import { roundTrip } from "../testing/SaveForgery";
import { runMonths } from "../testing/SimulationTestHelpers";
import { createGame } from "../testing/Simulator";
import { modRuntimeDigest, validScenarioMod } from "../helpers/ScenarioMod";
import { modScenario } from "./ModScenario";

const recovery = (objectives: RuleObjective[]) =>
  modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "recovery-goals",
    title: "Recovery goals",
    creator: "Author",
    version: "1",
    description: "Recover electricity service.",
    baseScenarioId: CHERNOBYL_SCENARIO_ID,
    seed: 42,
    scenario: { cash: 1e10 },
    objectives,
  });
const march: RuleObjective = {
  id: "march-bills",
  label: "March bills",
  metric: "monthlyBilledRate",
  fromMonth: 3,
  throughMonth: 3,
  maxDollarsPerKWh: 0.2,
  required: false,
};

it("measures a March calendar goal in the first playable month and preserves its evidence in saves", () => {
  const scenario = recovery([march]);
  const game = cloneDeep(createGame({ scenarioId: 999, scenario, seed: 42 }));
  expect(parseSave(roundTrip(game))).not.toBeNull();
  runMonths(game, 1);
  expect(gameObjectiveResults(game)[0].status).toBe("completed");
  expect(scenario.mod!.rules.objectives[0]).toMatchObject({
    fromMonth: 2,
    throughMonth: 2,
  });
  expect(scenarioObjectiveDefinitions(scenario)[0]).toMatchObject({
    fromMonth: 0,
    throughMonth: 0,
  });
  expect(game.monthlyHistory.map((row) => row.month)).toEqual([3]);
  expect(game.objectiveProgress!.entries[0].observations).toHaveLength(1);
  expect(game.objectiveProgress!.entries[0].observations[0][0]).toBe(0);
  expect(parseSave(roundTrip(game))?.game.objectiveProgress).toEqual(
    game.objectiveProgress,
  );
});

it("formats live and forecast goal dates with integer calendar offsets", () => {
  const scenario = recovery([march]);
  const game = createGame({ scenarioId: 999, scenario, seed: 42 });
  const goal = getMissionStatus(game).requirements.find(
    (row) => row.id === march.id,
  )!;
  expect(goal.target).toContain("Mar 1986");
  expect(goal.target).not.toMatch(/1986\.\d/);
  expect(goal.timing).toContain("3/1986–3/1986");
  const projected = projectMission(
    game,
    selectProjection(game, currentTick(game)!),
  );
  const detail = projected.requirements.find(
    (row) => row.id === march.id,
  )!.detail;
  expect(detail).toContain("Mar 1986");
  expect(detail).not.toMatch(/1986\.\d/);
});

it("measures calendar month 62 at the end of the 60-month recovery term", () => {
  const scenario = recovery([
    {
      id: "final-debt",
      label: "Final debt",
      metric: "monthEndDebt",
      fromMonth: 62,
      throughMonth: 62,
      maxDebtDollars: 1e9,
      required: false,
    },
  ]);
  const game = cloneDeep(createGame({ scenarioId: 999, scenario, seed: 42 }));
  runMonths(game, 60);
  expect(gameObjectiveResults(game)[0].status).toBe("completed");
  expect(game.monthlyHistory[0]).toMatchObject({ year: 1991, month: 2 });
  expect(game.objectiveProgress!.entries[0].observations[0][0]).toBe(59);
  expect(getMissionStatus(game).requirements[0].target).toContain("Feb 1991");
  expect(parseSave(roundTrip(game))).not.toBeNull();
});

it("rejects objective windows before the first playable month instead of inventing history", () => {
  expect(() => recovery([{ ...march, fromMonth: 1 }])).toThrow(
    /first playable month.*3/,
  );
});

it("rejects a frozen snapshot whose goal was moved before the opening month", () => {
  const scenario = recovery([march]);
  expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
  const edited = cloneDeep(scenario);
  const objective = edited.mod!.rules.objectives[0];
  if (!("fromMonth" in objective))
    throw new Error("Expected a measured window");
  edited.mod!.rules.objectives[0] = {
    ...objective,
    fromMonth: 0,
    throughMonth: 0,
  };
  edited.mod!.runtimeDigest = modRuntimeDigest(edited.mod!);
  expect(validScenarioMod(edited.mod, edited)).toBe(false);
  expect(() =>
    createGame({ scenarioId: 999, scenario: edited, seed: 42 }),
  ).toThrow(/runtime snapshot is invalid/);
});
