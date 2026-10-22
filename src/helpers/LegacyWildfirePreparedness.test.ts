import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import type {
  ActiveWorldEventType,
  AppStateType,
  ScenarioType,
} from "../Types";
import { createGame } from "../testing/Simulator";
import { modScenario } from "../mods/ModScenario";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { selectUpcomingStoryEvents } from "../components/views/StoryEventSelectors";
import {
  isLegacyWildfireProgramGame,
  legacyWildfirePreparedness,
  legacyWildfirePreparednessAnnualCost,
  legacyWildfirePreparednessChange,
  legacyWildfirePreparednessEffectiveness,
} from "./LegacyWildfirePreparedness";

const reference: {
  cases: { group: number; difficulty: string; scenario: ScenarioType }[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../testing/fixtures/FrozenLegacyArcSnapshots.json"),
    "utf8",
  ),
);
const receipt = (
  minute: number,
  choice: "prepare" | "stop",
  startEffectiveness: number,
  annualCost: number,
  index: number,
): ActiveWorldEventType => ({
  key: `wildfire:LA:preparedness:${index}`,
  definitionId: `wildfire:LA:preparedness:${index}`,
  startsMinute: minute,
  endsMinute: minute,
  attributes: {
    choice,
    startEffectiveness,
    annualCost,
    cost: 0,
    upfrontGrant: 0,
    scenarioChoice: true,
  },
  effects: {},
});

test("existing receipts retain their budget, same-minute order and12month build/fade boundaries", () => {
  const started = receipt(0, "prepare", 0, 321000, 0);
  const stopped = receipt(6 * MINUTES_PER_MONTH, "stop", 0.5, 0, 1);
  const history = [started, stopped];
  expect(
    legacyWildfirePreparednessAnnualCost(history, "LA", 5 * MINUTES_PER_MONTH),
  ).toBe(321000);
  expect(
    legacyWildfirePreparednessEffectiveness(
      history,
      "LA",
      6 * MINUTES_PER_MONTH,
    ),
  ).toBe(0.5);
  expect(
    legacyWildfirePreparednessAnnualCost(history, "LA", 6 * MINUTES_PER_MONTH),
  ).toBe(0);
  expect(
    legacyWildfirePreparednessEffectiveness(
      history,
      "LA",
      12 * MINUTES_PER_MONTH,
    ),
  ).toBe(0.25);
  expect(
    legacyWildfirePreparednessEffectiveness(
      history,
      "LA",
      18 * MINUTES_PER_MONTH,
    ),
  ).toBe(0);
  const restarted = receipt(6 * MINUTES_PER_MONTH, "prepare", 0.5, 456000, 2);
  expect(
    legacyWildfirePreparednessChange(
      [...history, restarted],
      "LA",
      restarted.startsMinute,
    ),
  ).toEqual(restarted);
  expect(
    legacyWildfirePreparednessEffectiveness(
      [...history, restarted],
      "LA",
      18 * MINUTES_PER_MONTH,
    ),
  ).toBe(1);
  expect(
    legacyWildfirePreparednessAnnualCost(
      [...history, restarted],
      "SF",
      18 * MINUTES_PER_MONTH,
    ),
  ).toBe(0);
  expect(history).toEqual([started, stopped]);
});

test("only old detached111 protection metadata exposes saved program terms and a stop choice", () => {
  const source = reference.cases.find(
    (entry) => entry.group === 1 && entry.difficulty === "Employee",
  )!.scenario;
  const old = createGame({
    scenarioId: 999,
    scenario: cloneDeep(source),
    difficulty: "Employee",
    seed: source.seed,
  });
  old.worldEvents.occurrences.push(receipt(0, "prepare", 0, 321000, 0));
  expect(isLegacyWildfireProgramGame(old)).toBe(true);
  expect(legacyWildfirePreparedness(old)).toMatchObject({
    active: false,
    choice: { id: `wildfire:${old.location.id}:preparedness:0` },
  });
  // The fixture's relocated Paris grid cannot inherit an LA program's protection or annual bill.
  expect(legacyWildfirePreparedness(old)!.effectiveness).toBe(0);
  const local = receipt(0, "prepare", 0, 321000, 0);
  local.key = `wildfire:${old.location.id}:preparedness:0`;
  local.definitionId = local.key;
  old.worldEvents.occurrences.push(local);
  const terms = legacyWildfirePreparedness(old)!;
  expect(terms.active).toBe(true);
  expect(terms.annualCost).toBe(321000);
  expect(terms.choice.options.map((option) => option.id)).toEqual(["stop"]);
  expect(terms.choice.id).toBe(`wildfire:${old.location.id}:preparedness:1`);
  for (const game of [
    createGame({ scenarioId: 111 }),
    createGame({ scenarioId: 999 }),
    { ...old, storyEffectsDisabled: true },
  ])
    expect(legacyWildfirePreparedness(game)).toBeUndefined();
  const current = modScenario(
    {
      schemaVersion: 1,
      gameApi: 1,
      id: "current-wildfire",
      title: "Current wildfire",
      creator: "Test",
      version: "1",
      description: "Prepare replacement supply.",
      seed: 7,
      baseScenarioId: 111,
      objectives: { mode: "none" },
    },
    undefined,
    "Employee",
    1e8,
  );
  expect(
    legacyWildfirePreparedness(
      createGame({
        scenarioId: 999,
        scenario: current,
        difficulty: "Employee",
        seed: 7,
      }),
    ),
  ).toBeUndefined();
});

test("saved programs with the same receipt ID but different start times invalidate upcoming effect copy", () => {
  const source = reference.cases.find(
    (entry) => entry.group === 1 && entry.difficulty === "Employee",
  )!.scenario;
  const earlier = createGame({
    scenarioId: 999,
    scenario: cloneDeep(source),
    difficulty: "Employee",
    seed: source.seed,
  });
  earlier.date = getDateFromMinute(
    35 * MINUTES_PER_MONTH,
    earlier.startingYear,
  );
  const change = receipt(24 * MINUTES_PER_MONTH, "prepare", 0, 321000, 0);
  change.key = `wildfire:${earlier.location.id}:preparedness:0`;
  change.definitionId = change.key;
  earlier.worldEvents.occurrences.push(change);
  const later = cloneDeep(earlier);
  later.worldEvents.occurrences.at(-1)!.startsMinute = 35 * MINUTES_PER_MONTH;
  later.worldEvents.occurrences.at(-1)!.endsMinute = 35 * MINUTES_PER_MONTH;
  const warning = (game: typeof earlier) =>
    selectUpcomingStoryEvents({ game } as AppStateType).find((event) =>
      event.key.endsWith(":firestorm"),
    )!.message;
  const first = warning(earlier);
  expect(warning(later)).not.toBe(first);
  expect(warning(earlier)).toBe(first);
});
