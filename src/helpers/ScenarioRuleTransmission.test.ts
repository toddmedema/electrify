import Ajv from "ajv";
import cloneDeep from "lodash.clonedeep";
import { DIFFICULTY_IDS } from "../Constants";
import { combineStoryEffects } from "../data/WorldEvents";
import type { RuleEvent, RuleNumber } from "../data/ScenarioRules";
import { createModEditorSchema } from "../mods/ModEditorSchema";
import { modScenario } from "../mods/ModScenario";
import { modDiagnostics, type ModPackage } from "../mods/ModSchema";
import { parseSave, serializeSave } from "../SaveGame";
import { tickState } from "../reducers/Game";
import { checkMonth, InvariantCollector } from "../testing/Invariants";
import { createGame } from "../testing/Simulator";
import { getTimeFromTimeline } from "./DateTime";
import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";
import {
  compileScenarioRules,
  ruleDefinitionsFromSnapshot,
  validCompiledScenarioRules,
} from "./ScenarioRules";

const params = {
  namespace: { kind: "mod" as const, id: "route-limits" },
  difficulty: "Employee" as const,
  seed: 42,
  startingYear: 2022,
  durationMonths: 4,
  startingPeakW: 50e6,
  startingAssetIds: [],
};
const event = (limit: RuleNumber = 4): RuleEvent => ({
  id: "north-limit",
  title: "Northern route restricted",
  message: "The northern route carries less power.",
  preview: "The northern route will be restricted in months 2–3.",
  startMonth: 2,
  durationMonths: 2,
  effects: {
    transmissionCapacityLimitsMWByCorridor: { "california-north": limit },
  },
});
const pack = (events = [event()]): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "route-limits",
  title: "Route limits",
  creator: "Fixture",
  version: "1",
  description: "Plan around a temporary transmission restriction.",
  seed: 42,
  baseScenarioId: 111,
  officialArcs: [],
  objectives: { mode: "none" },
  scenario: { durationMonths: 6, cash: 1e9 },
  events,
});

test("editor and import parser enforce bounded corridor maps with zero and difficulty neighbors", () => {
  const editor = new Ajv({ allErrors: true, unicode: false }).compile(
    createModEditorSchema(),
  );
  const verify = (value: unknown, accepted: boolean) => {
    expect(editor(value)).toBe(accepted);
    expect(modDiagnostics(value).length === 0).toBe(accepted);
  };
  for (const limit of [0, 4, 1e6]) verify(pack([event(limit)]), true);
  verify(
    pack([
      event({
        byDifficulty: { Intern: 10, Employee: 8, Manager: 6, VP: 4, CEO: 0 },
      }),
    ]),
    true,
  );
  for (const limits of [
    {},
    { "california-north": -1 },
    { "california-north": 1000001 },
    { "not a route": 4 },
    { "california-north": { byDifficulty: { Employee: 4 } } },
    Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`route-${i}`, 4])),
  ]) {
    const input = pack();
    Object.assign(input.events![0].effects!, {
      transmissionCapacityLimitsMWByCorridor: limits,
    });
    verify(input, false);
  }
  expect(() =>
    compileScenarioRules(
      {
        objectives: [],
        events: [
          {
            ...event(),
            effects: {
              transmissionCapacityLimitsMWByCorridor: { "missing-route": 4 },
            },
          },
        ],
      },
      params,
    ),
  ).toThrow(/not a registered transmission corridor/);
});

test("compilation freezes MW once and strict detached validation preserves the physical map", () => {
  const byDifficulty = { Intern: 10, Employee: 8, Manager: 6, VP: 4, CEO: 0 };
  for (const difficulty of DIFFICULTY_IDS) {
    const compiled = compileScenarioRules(
      { events: [event({ byDifficulty })], objectives: [] },
      { ...params, difficulty },
    );
    expect(compiled.events[0].effects).toEqual({
      transmissionCapacityLimitsWByCorridor: {
        "california-north": byDifficulty[difficulty] * 1e6,
      },
    });
    expect(ruleDefinitionsFromSnapshot(compiled).events![0].effects).toEqual({
      transmissionCapacityLimitsMWByCorridor: {
        "california-north": byDifficulty[difficulty],
      },
    });
    expect(validCompiledScenarioRules(compiled)).toBe(true);
    expect(scenarioEffectsSummary(compiled.events[0].effects, true)).toContain(
      `california-north capacity limited to ${byDifficulty[difficulty]} MW`,
    );
    const corrupt = cloneDeep(compiled);
    corrupt.events[0].effects.transmissionCapacityLimitsWByCorridor![
      "california-north"
    ] = -1;
    expect(validCompiledScenarioRules(corrupt)).toBe(false);
    const unknown = cloneDeep(compiled);
    unknown.events[0].effects.transmissionCapacityLimitsWByCorridor![
      "missing-route"
    ] = 4e6;
    expect(validCompiledScenarioRules(unknown)).toBe(false);
    expect(validCompiledScenarioRules(compiled)).toBe(true);
  }
});

test("overlapping physical caps commute, preserve independent routes and retain explicit zero", () => {
  const effects = (north: number, south?: number) => ({
    effects: {
      transmissionCapacityLimitsWByCorridor: {
        "california-north": north,
        ...(south === undefined ? {} : { "california-south": south }),
      },
    },
  });
  const restrictions = [effects(8e6, 2e6), effects(4e6), effects(0)];
  for (const events of [restrictions, [...restrictions].reverse()])
    expect(
      combineStoryEffects(events).transmissionCapacityLimitsWByCorridor,
    ).toEqual({
      "california-north": 0,
      "california-south": 2e6,
    });
});

test("a manually authored cap reaches actual imports, overlap, expiry and strict saves", () => {
  const zero = {
    ...event(0),
    id: "closed-route",
    startMonth: 3,
    durationMonths: 1,
  };
  const scenario = modScenario(pack([event(), zero]), undefined, "Employee");
  const game = createGame({
    scenarioId: 999,
    scenario,
    seed: 42,
    difficulty: "Employee",
  });
  expect(game.transmission!.lines[0].capacityW).toBe(40e6);
  expect(game.timeline.some((tick) => tick.importedW! > 0)).toBe(true);
  const collector = new InvariantCollector();
  let months = 0;
  const reached: number[] = [];
  while (game.date.monthsElapsed < 4) {
    tickState(game);
    if (game.date.monthsElapsed === months) continue;
    months = game.date.monthsElapsed;
    const current = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const limit =
      current.transmissionCapacityLimitsWByCorridor?.["california-north"];
    expect(limit).toBe(months === 1 ? 4e6 : months === 2 ? 0 : undefined);
    const capacity = limit ?? game.transmission!.lines[0].capacityW;
    expect(current.importedW).toBeLessThanOrEqual(capacity);
    expect(current.exportedW).toBeLessThanOrEqual(capacity);
    expect(current.transmissionCapacityW).toBeLessThanOrEqual(capacity);
    expect(parseSave(serializeSave(game))).not.toBeNull();
    checkMonth(collector, game.monthlyHistory[0], `month ${months}`);
    reached.push(months);
  }
  expect(reached).toEqual([1, 2, 3, 4]);
  expect(collector.getViolations()).toEqual([]);
  expect(
    game.worldEvents.occurrences.filter(
      (item) => item.attributes.ruleEvent === true,
    ),
  ).toHaveLength(2);
});
