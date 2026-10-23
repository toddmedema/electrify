import cloneDeep from "lodash.clonedeep";
import type { SaveGameType } from "../Types";
import { parseSave, serializeSave } from "../SaveGame";
import { SAVE_SCHEMA_VERSION } from "../SaveUpgrade";
import { WILDFIRE_DECISION_KEY } from "../data/ScenarioChoiceRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import answered from "../testing/fixtures/saves/native-wildfire-answered.json";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";

const oldSave = () => cloneDeep(answered) as unknown as SaveGameType;

test("an actual old native wildfire payment remains booked history after prospective retirement", () => {
  const original = oldSave();
  const intact = JSON.stringify(original);
  const restored = parseSave(original);
  expect(restored).not.toBeNull();
  expect(restored!.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  expect(restored!.game.scenarioRuleHistoryStartMinute).toBe(
    35 * MINUTES_PER_MONTH,
  );
  for (const key of [
    "date",
    "facilities",
    "timeline",
    "monthlyHistory",
    "loadAdditions",
    "objectiveProgress",
    "replayLog",
  ] as const)
    expect(restored!.game[key]).toEqual(original.game[key]);
  expect(restored!.game.worldEvents.occurrences).toEqual(
    original.game.worldEvents.occurrences,
  );
  expect(restored!.game.worldEvents.occurrences).toContainEqual(
    expect.objectContaining({
      key: WILDFIRE_DECISION_KEY,
      attributes: {
        choice: "prepare",
        cost: 2e6,
        upfrontGrant: 0,
        scenarioChoice: true,
      },
    }),
  );
  expect(pendingScenarioChoice(restored!.game)).toBeUndefined();
  expect(parseSave(serializeSave(restored!.game))).not.toBeNull();
  expect(JSON.stringify(original)).toBe(intact);
});

test("retirement cannot hide edited, duplicated or newly paid historical receipts", () => {
  const intact = oldSave();
  for (const mutate of [
    (save: SaveGameType) => {
      save.game.worldEvents.occurrences.find(
        (event) => event.key === WILDFIRE_DECISION_KEY,
      )!.attributes.cost = 1;
    },
    (save: SaveGameType) => {
      save.game.worldEvents.occurrences.find(
        (event) => event.key === WILDFIRE_DECISION_KEY,
      )!.attributes.upfrontGrant = 1;
    },
    (save: SaveGameType) => {
      save.game.worldEvents.occurrences.find(
        (event) => event.key === WILDFIRE_DECISION_KEY,
      )!.startsMinute -= MINUTES_PER_MONTH;
    },
    (save: SaveGameType) => {
      save.game.worldEvents.occurrences.push(
        cloneDeep(
          save.game.worldEvents.occurrences.find(
            (event) => event.key === WILDFIRE_DECISION_KEY,
          )!,
        ),
      );
    },
    (save: SaveGameType) => {
      save.game.worldEvents.occurrences.find(
        (event) => event.key === WILDFIRE_DECISION_KEY,
      )!.effects.operatingExpensePerMonth = 1;
    },
  ]) {
    const corrupt = cloneDeep(intact);
    mutate(corrupt);
    expect(parseSave(corrupt)).toBeNull();
    expect(parseSave(cloneDeep(intact))).not.toBeNull();
  }
});

test("a current native journal remains required without a legacy coverage boundary", () => {
  const game = createGame({ scenarioId: 111, seed: 12345 });
  runMonths(game, 25);
  const original = cloneDeep(serializeSave(game));
  expect(original.game.scenarioRuleHistoryStartMinute).toBeUndefined();
  expect(parseSave(original)).not.toBeNull();
  const missing = cloneDeep(original);
  const key = "story:111:wildfire-intertie:readiness";
  expect(
    missing.game.worldEvents.occurrences.some((event) => event.key === key),
  ).toBe(true);
  missing.game.worldEvents.occurrences =
    missing.game.worldEvents.occurrences.filter((event) => event.key !== key);
  missing.game.worldEvents.active = missing.game.worldEvents.active.filter(
    (event) => event.key !== key,
  );
  expect(parseSave(missing)).toBeNull();
  expect(parseSave(original)).not.toBeNull();
});

test("history coverage is a bounded native migration fact", () => {
  const accepted = parseSave(oldSave())!;
  expect(accepted).not.toBeNull();
  for (const minute of [-1, 0.5, accepted.game.date.minute + 1, Infinity]) {
    const invalid = cloneDeep(accepted);
    invalid.game.scenarioRuleHistoryStartMinute = minute;
    expect(parseSave(invalid)).toBeNull();
  }
  const other = createGame({ scenarioId: 100 });
  other.scenarioRuleHistoryStartMinute = 0;
  expect(parseSave(serializeSave(other))).toBeNull();
  expect(parseSave(serializeSave(accepted.game))).not.toBeNull();
});
