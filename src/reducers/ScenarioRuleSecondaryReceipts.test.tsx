import cloneDeep from "lodash.clonedeep";
import { getScenario } from "../data/Scenarios";
import type { RuleEvent } from "../data/ScenarioRules";
import { compileScenarioRules } from "../helpers/ScenarioRules";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import type { GameType } from "../Types";
import { tickState } from "./Game";

const events: RuleEvent[] = [
  {
    id: "temporary",
    title: "Temporary change",
    message: "The temporary change begins.",
    preview: "A temporary change is expected.",
    startMonth: 1,
    durationMonths: 1,
    effects: { temperatureOffsetC: 1 },
    endMessage: "The temporary change ends.",
    endReport: {
      id: "recovery",
      kind: "reliability",
      fromMonth: 1,
      throughMonth: 1,
    },
  },
];
const capacity = {
  id: "closing-capacity",
  kind: "firmCoverage" as const,
  fromMonth: 1,
  throughMonth: 1,
};
const input: ModPackage = {
  schemaVersion: 1,
  gameApi: 1,
  id: "secondary-receipts",
  title: "Secondary receipt fixture",
  creator: "Fixture",
  version: "1",
  description: "Real event endings and report observations.",
  seed: 42,
  baseScenarioId: 999,
  objectives: { mode: "none" },
  officialArcs: [],
  scenario: {
    durationMonths: 6,
    cash: 1e9,
    startingCustomers: 10000,
    dollarsPerkWh: 0.2,
    feePerKgCO2e: 0,
  },
  events,
  debriefReports: [capacity],
};
function withGame(kind: "official" | "mod", inspect: (game: GameType) => void) {
  const source = getScenario(113)!;
  const previous = source.rules;
  try {
    if (kind === "official")
      source.rules = compileScenarioRules(
        { events, debriefReports: [capacity], objectives: [] },
        {
          namespace: {
            kind: "official",
            scenarioId: 113,
            arcId: "secondary-receipts",
          },
          difficulty: "Employee",
          seed: 42,
          startingYear: source.startingYear,
          durationMonths: source.durationMonths,
          startingPeakW: 0,
          startingAssetIds: [],
        },
      );
    const scenario = kind === "mod" ? modScenario(input) : source;
    const game = createGame({ scenarioId: scenario.id, scenario, seed: 42 });
    while (game.date.monthsElapsed < 1) tickState(game);
    inspect(game);
  } finally {
    if (previous) source.rules = previous;
    else delete source.rules;
  }
}
function accepted(game: GameType) {
  expect(validScenarioRuleState(game)).toBe(true);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
}
function rejected(game: GameType) {
  expect(validScenarioRuleState(game)).toBe(false);
  expect(parseSave(JSON.parse(JSON.stringify(serializeSave(game))))).toBeNull();
}

test.each(["official", "mod"] as const)(
  "%s endings and capacity observations survive a strict save without authorizing effects or payments",
  (kind) => {
    withGame(kind, (game) => {
      const ending = game.worldEvents.occurrences.find(
        (event) => event.attributes.ruleEventEnd === true,
      )!;
      const observation = game.worldEvents.occurrences.find(
        (event) => event.attributes.ruleObservation === true,
      )!;
      expect(ending.startsMinute).toBe(MINUTES_PER_MONTH);
      expect(ending.attributes.reliability).toBeGreaterThan(0);
      expect(observation.attributes.firmPeakW).toBeGreaterThan(0);
      expect(game.worldEvents.active).toContainEqual(ending);
      accepted(game);
      for (const key of [ending.key, observation.key]) {
        const forged = cloneDeep(game);
        const receipt = forged.worldEvents.occurrences.find(
          (event) => event.key === key,
        )!;
        receipt.effects = { demandMultiplier: 0 };
        receipt.attributes.upfrontGrant = 1e9;
        const active = forged.worldEvents.active.find(
          (event) => event.key === key,
        );
        if (active) {
          active.effects = { ...receipt.effects };
          active.attributes = { ...receipt.attributes };
        }
        rejected(forged);
      }
      accepted(game);
    });
  },
);

test.each(["official", "mod"] as const)(
  "%s secondary receipts require their real onset, expiry and closing report window",
  (kind) => {
    withGame(kind, (game) => {
      const ending = game.worldEvents.occurrences.find(
        (event) => event.attributes.ruleEventEnd === true,
      )!;
      const observation = game.worldEvents.occurrences.find(
        (event) => event.attributes.ruleObservation === true,
      )!;
      const modifications: ((copy: GameType) => void)[] = [
        (copy) => {
          copy.worldEvents.occurrences = copy.worldEvents.occurrences.filter(
            (event) => `${event.key}:end` !== ending.key,
          );
        },
        (copy) => {
          copy.worldEvents.occurrences.find(
            (event) => event.key === ending.key,
          )!.startsMinute = 0;
        },
        (copy) => {
          const receipt = copy.worldEvents.occurrences.find(
            (event) => event.key === observation.key,
          )!;
          receipt.key = receipt.key.replace(":observation:0", ":observation:1");
          receipt.attributes.month = 1;
        },
        (copy) => {
          copy.worldEvents.occurrences.find(
            (event) => event.key === observation.key,
          )!.attributes.firmPeakW = -1;
        },
        (copy) => {
          copy.worldEvents.occurrences.push(cloneDeep(ending));
        },
        (copy) => {
          copy.worldEvents.active.push(cloneDeep(observation));
        },
        (copy) => {
          const receipt = copy.worldEvents.occurrences.find(
            (event) => event.key === ending.key,
          )!;
          delete receipt.attributes.ruleEventEnd;
          receipt.effects = { demandMultiplier: 0 };
          const active = copy.worldEvents.active.find(
            (event) => event.key === ending.key,
          )!;
          active.attributes = { ...receipt.attributes };
          active.effects = { ...receipt.effects };
        },
      ];
      for (const modify of modifications) {
        const forged = cloneDeep(game);
        modify(forged);
        rejected(forged);
      }
      accepted(game);
      const restored = parseSave(
        JSON.parse(JSON.stringify(serializeSave(game))),
      )!.game;
      tickState(restored);
      expect(restored.worldEvents.occurrences).toEqual(
        game.worldEvents.occurrences,
      );
    });
  },
);
