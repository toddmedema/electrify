import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { validCompiledScenarioRules } from "../helpers/ScenarioRules";
import { validScenarioMod } from "../helpers/ScenarioMod";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { createGame, runSimulation } from "../testing/Simulator";
import type { GameType } from "../Types";
import { tickState } from "./Game";
import { roundTrip } from "../testing/SaveForgery";

const input: ModPackage = {
  schemaVersion: 1,
  gameApi: 1,
  id: "current-wildfire",
  title: "Current wildfire",
  creator: "Fixture",
  version: "1",
  description: "Replace imports before the northern intertie outage.",
  seed: 12345,
  baseScenarioId: 111,
  officialArcs: [{ scenarioId: 111, includeChoices: true }],

  scenario: { cash: 1e9 },
};

test("current111 community rules have no choice and preserve the cap, goals and save", () => {
  const scenario = modScenario(input, undefined, "Employee");
  const rules = scenario.mod!.rules;
  expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
  expect(validCompiledScenarioRules(rules)).toBe(true);
  expect(rules.arcChoices ?? []).toEqual([]);
  expect(rules.arcEvents!.map((event) => event.source!.arcId)).toEqual([
    "wildfire-intertie",
    "wildfire-intertie",
    "wildfire-intertie",
  ]);
  const outage = rules.arcEvents!.find(
    (event) => event.source!.phaseId === "outage",
  )!;
  expect(outage.targets).toEqual([]);
  expect(outage.protection).toBeUndefined();
  expect(outage.effects).toEqual({
    transmissionCapacityLimitsWByCorridor: { "california-north": 4e6 },
  });
  const options = {
    scenarioId: 999,
    scenario,
    seed: input.seed,
    difficulty: "Employee" as const,
    dollarsPerkWh: 0.17,
    initialBuild: { name: "Natural Gas Peaker", peakW: 100e6, financed: true },
  };
  const original = createGame(options);
  expect(original.transmission!.lines[0].capacityW).toBe(40e6);
  const advance = (game: GameType, month: number) => {
    while (game.date.monthsElapsed < month) {
      expect(pendingScenarioChoice(game)).toBeUndefined();
      tickState(game);
    }
  };
  advance(original, 35);
  const saved = parseSave(roundTrip(original));
  expect(saved).not.toBeNull();
  expect(saved!.game.customScenario).toEqual(scenario);
  const resumed = cloneDeep(saved!.game);
  for (const month of [36, 37, 38]) {
    advance(original, month);
    advance(resumed, month);
    const now = getTimeFromTimeline(original.date.minute, original.timeline)!;
    expect(
      now.transmissionCapacityLimitsWByCorridor?.["california-north"],
    ).toBe(month < 38 ? 4e6 : undefined);
    expect(now.importedW).toBeLessThanOrEqual(month < 38 ? 4e6 : 40e6);
    expect(now.exportedW).toBeLessThanOrEqual(month < 38 ? 4e6 : 40e6);
    expect(resumed.monthlyHistory).toEqual(original.monthlyHistory);
    expect(resumed.worldEvents).toEqual(original.worldEvents);
    expect(parseSave(serializeSave(original))).not.toBeNull();
  }
  for (const game of [original, resumed]) {
    advance(game, 60);
    expect(gameObjectiveResults(game).map((result) => result.status)).toEqual([
      "completed",
    ]);
    expect(game.runIdentity).toBeUndefined();
    expect(game.customScenario!.mod!.source.id).toBe(input.id);
  }
  const simulation = runSimulation({ ...options, months: 60 });
  expect(simulation.violations).toEqual([]);
  expect(simulation.outcome).toBe("completed");
  expect(simulation.months).toEqual([...original.monthlyHistory].reverse());
  expect(resumed.monthlyHistory).toEqual(original.monthlyHistory);
});

test("all fourteen current arc snapshots validate through ordinary compilation", () => {
  const groups = [
    [100, 101, 103, 105, 106],
    [102, 104, 110, 111],
    [107, 108],
    [113, 114],
    [115],
  ];
  for (const ids of groups) {
    const scenario = modScenario({
      ...input,
      baseScenarioId: 110,
      officialArcs: ids.map((scenarioId) => ({
        scenarioId,
        includeChoices: true,
      })),
      objectives: [],
      scenario: { startingYear: 2050, durationMonths: 240 },
    });
    expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
    expect(validCompiledScenarioRules(scenario.mod!.rules)).toBe(true);
    expect(
      scenario.mod!.rules.officialArcs.map((arc) => arc.scenarioId),
    ).toEqual(ids);
  }
});
