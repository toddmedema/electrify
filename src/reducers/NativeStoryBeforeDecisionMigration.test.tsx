import cloneDeep from "lodash.clonedeep";
import type { SaveGameType } from "../Types";
import { parseSave, serializeSave } from "../SaveGame";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import { loadSimData } from "../testing/SimData";
import reference from "../testing/fixtures/NativeWildfireBeforeDecisionReference.json";
import { tickState } from "./Game";

beforeAll(() => loadSimData("LA"));

test("an actual native111 save before the retired decision carries physical history forward without inventing receipts", () => {
  expect(reference.baselineCommit).toBe(
    "2fc5d50ebedd5d3695b9db7d75ca5b54c0912779",
  );
  const source = cloneDeep(
    reference.nativeBeforeDecisionSave,
  ) as unknown as SaveGameType;
  expect(source.schemaVersion).toBe(3);
  expect(source.game.date.monthsElapsed).toBe(30);
  expect(
    source.game.worldEvents.occurrences.filter((event) =>
      event.key.startsWith("story:111:"),
    ),
  ).toEqual([]);
  const restored = parseSave(source);
  expect(restored).not.toBeNull();
  const game = restored!.game;
  expect(game.scenarioRuleHistoryStartMinute).toBe(30 * MINUTES_PER_MONTH);
  for (const key of [
    "date",
    "facilities",
    "timeline",
    "monthlyHistory",
    "loadAdditions",
    "objectiveProgress",
    "replayLog",
    "worldEvents",
  ] as const)
    expect(game[key]).toEqual(source.game[key]);
  expect(validScenarioRuleState(game)).toBe(true);
  expect(pendingScenarioChoice(game)).toBeUndefined();
  expect(parseSave(serializeSave(game))).not.toBeNull();
  // The new readiness event at25 is covered prospectively; it is never paid or
  // written retroactively. The first future outage transaction remains required.
  while (game.date.monthsElapsed < 36) tickState(game);
  expect(validScenarioRuleState(game)).toBe(true);
  expect(
    game.worldEvents.occurrences.some(
      (event) => event.key === "story:111:wildfire-intertie:readiness",
    ),
  ).toBe(false);
  expect(
    game.worldEvents.occurrences.some(
      (event) => event.key === "story:111:wildfire-intertie:outage",
    ),
  ).toBe(true);
  const valid = serializeSave(game);
  expect(parseSave(valid)).not.toBeNull();
  const missing = cloneDeep(valid);
  missing.game.worldEvents.occurrences =
    missing.game.worldEvents.occurrences.filter(
      (event) => event.key !== "story:111:wildfire-intertie:outage",
    );
  missing.game.worldEvents.active = missing.game.worldEvents.active.filter(
    (event) => event.key !== "story:111:wildfire-intertie:outage",
  );
  expect(parseSave(missing)).toBeNull();
  expect(parseSave(valid)).not.toBeNull();
});

test("an actual native111 pending legacy decision retires prospectively without charging or inventing a response", () => {
  const source = cloneDeep(
    reference.nativePendingSave,
  ) as unknown as SaveGameType;
  expect(source.schemaVersion).toBe(3);
  expect(source.game.date.monthsElapsed).toBe(35);
  expect(source.game.scenarioChoicePause).toBeDefined();
  const restored = parseSave(source);
  expect(restored).not.toBeNull();
  const game = restored!.game;
  expect(game.scenarioRuleHistoryStartMinute).toBe(35 * MINUTES_PER_MONTH);
  expect(game.scenarioChoicePause).toBeUndefined();
  expect(pendingScenarioChoice(game)).toBeUndefined();
  for (const key of [
    "date",
    "facilities",
    "timeline",
    "monthlyHistory",
    "loadAdditions",
    "objectiveProgress",
    "replayLog",
  ] as const)
    expect(game[key]).toEqual(source.game[key]);
  expect(source.game.worldEvents.active).toEqual([
    expect.objectContaining({
      key: "story:111:california-wildfire-2025:red-flag-warning",
      effects: {},
      startsMinute: 35 * MINUTES_PER_MONTH,
      endsMinute: 35 * MINUTES_PER_MONTH,
    }),
  ]);
  expect(game.worldEvents).toEqual({ ...source.game.worldEvents, active: [] });
  expect(validScenarioRuleState(game)).toBe(true);
  expect(parseSave(serializeSave(game))).not.toBeNull();
});
