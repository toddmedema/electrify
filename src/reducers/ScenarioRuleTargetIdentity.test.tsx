import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { modScenario } from "../mods/ModScenario";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { buildStorySnapshot } from "../helpers/Story";
import { resolveStoryAtDate } from "../data/WorldEvents";
import { GENERATORS } from "../data/Facilities";
import type { GameType } from "../Types";
import reducer, { sellFacility, buildFacility } from "./Game";
import { chooseScenarioResponse } from "./GameActions";

function effects(game: GameType) {
  return resolveStoryAtDate({
    rules: game.customScenario!.mod!.rules,
    seed: game.seed,
    scenarioId: 999,
    difficulty: game.difficulty,
    date: game.date,
    location: game.location,
    occurrences: game.worldEvents.occurrences,
    snapshot: buildStorySnapshot(
      game.monthlyHistory,
      game.facilities,
      game.date.minute,
    ),
  }).effects;
}
function createReachedGame() {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "review-target-time",
    title: "Target time",
    creator: "Reviewer",
    version: "1",
    description: "A target identity review.",
    seed: 42,
    baseScenarioId: 999,
    objectives: { mode: "none" },
    officialArcs: [],
    scenario: { durationMonths: 6, startingYear: 2020, cash: 1e9 },
    events: [
      {
        id: "outage",
        title: "Outage",
        message: "One generator loses output.",
        preview: "One generator will lose output.",
        startMonth: 2,
        durationMonths: 3,
        effects: {
          outputMultipliersBySelector: [
            { target: { selector: "largestOperating" }, outputMultiplier: 0.5 },
          ],
        },
      },
    ],
  });
  const game = createGame({ scenarioId: 999, scenario, seed: 42 });
  runMonths(game, 1);
  return game;
}
for (const edit of [
  "future-birth",
  "earlier-birth",
  "negative-birth",
  "changed-stable-tag",
] as const)
  test(`a forged ${edit} cannot erase an already recorded outage`, () => {
    const game = createReachedGame();
    const intact = parseSave(serializeSave(game));
    expect(intact).not.toBeNull();
    const baselineEffects = effects(intact!.game);
    expect(
      Object.values(baselineEffects.facilityOutputMultipliersById!),
    ).toEqual([0.5]);
    const altered = cloneDeep(serializeSave(game));
    for (const receipt of [
      ...altered.game.worldEvents.occurrences,
      ...altered.game.worldEvents.active,
    ]) {
      if (receipt.key !== "mod:review-target-time:outage") continue;
      const groups = JSON.parse(String(receipt.attributes.ruleTargets));
      if (edit === "future-birth")
        groups[0][0].minuteCreated = receipt.startsMinute + 15;
      if (edit === "earlier-birth")
        groups[0][0].minuteCreated = receipt.startsMinute - 15;
      if (edit === "negative-birth") groups[0][0].minuteCreated = -15;
      if (edit === "changed-stable-tag")
        groups[0][0].startingAssetId = "forged-initial-tag";
      receipt.attributes.ruleTargets = JSON.stringify(groups);
    }
    const corrupted = parseSave(altered);
    expect({
      accepted: corrupted !== null,
      effects: corrupted
        ? effects(corrupted.game).facilityOutputMultipliersById
        : undefined,
    }).toEqual({ accepted: false, effects: undefined });
    expect(parseSave(serializeSave(game))).not.toBeNull();
  });

test("a lawful same-opening sold and ID-reused replacement remains loadable and detached", () => {
  let game = createReachedGame();
  const original = game.facilities[0];
  expect(original.minuteCreated).toBeLessThan(game.date.minute);
  game = cloneDeep(reducer(game, sellFacility(original.id)));
  const quote = GENERATORS(game, 1e6, [20], [500]).find(
    (facility) => facility.name === "Natural Gas Peaker" && facility.available,
  )!;
  expect(quote).toBeDefined();
  game = cloneDeep(
    reducer(game, buildFacility({ facility: quote, financed: false })),
  );
  const replacement = game.facilities.find(
    (facility) => facility.id === original.id,
  )!;
  expect(replacement).toBeDefined();
  expect(replacement.minuteCreated).toBe(game.date.minute);
  expect(replacement.startingAssetId).toBeUndefined();
  expect(effects(game).facilityOutputMultipliersById).toBeUndefined();
  expect(parseSave(serializeSave(game))).not.toBeNull();
});

test("lawful construction before a same-opening conditional onset stays untargeted and loadable", () => {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "review-before-target",
    title: "Target before activation",
    creator: "Reviewer",
    version: "1",
    description: "A target action ordering review.",
    seed: 42,
    baseScenarioId: 999,
    objectives: { mode: "none" },
    officialArcs: [],
    scenario: { durationMonths: 6, startingYear: 2020, cash: 1e9 },
    choices: [
      {
        id: "decision",
        dueMonth: 2,
        title: "Activate outage",
        prompt: "Choose when to accept the outage.",
        options: [
          {
            id: "accept",
            label: "Accept",
            description: "Accept the outage.",
            message: "Outage accepted.",
            costDollars: 0,
          },
          {
            id: "avoid",
            label: "Avoid",
            description: "Avoid the outage.",
            message: "Outage avoided.",
            costDollars: 0,
          },
        ],
      },
    ],
    events: [
      {
        id: "outage",
        title: "Outage",
        message: "One generator loses output.",
        preview: "One generator will lose output.",
        startMonth: 2,
        durationMonths: 3,
        requiresChoice: { choiceId: "decision", optionIds: ["accept"] },
        effects: {
          outputMultipliersBySelector: [
            { target: { selector: "largestOperating" }, outputMultiplier: 0.5 },
          ],
        },
      },
    ],
  });
  let game = createGame({ scenarioId: 999, scenario, seed: 42 });
  runMonths(game, 1);
  expect(
    game.worldEvents.occurrences.some(
      (event) => event.key === "mod:review-before-target:outage",
    ),
  ).toBe(false);
  for (const facility of [...game.facilities])
    game = cloneDeep(reducer(game, sellFacility(facility.id)));
  const quote = GENERATORS(game, 1e6, [20], [500]).find(
    (facility) => facility.name === "Natural Gas Peaker" && facility.available,
  )!;
  expect(quote).toBeDefined();
  game = cloneDeep(
    reducer(game, buildFacility({ facility: quote, financed: false })),
  );
  const replacement = game.facilities[0];
  expect(replacement.minuteCreated).toBe(game.date.minute);
  expect(replacement.yearsToBuildLeft).toBeGreaterThan(0);
  game = cloneDeep(
    reducer(
      game,
      chooseScenarioResponse({
        decisionId: "mod:review-before-target:decision",
        optionId: "accept",
      }),
    ),
  );
  const receipt = game.worldEvents.occurrences.find(
    (event) => event.key === "mod:review-before-target:outage",
  );
  expect(receipt).toBeDefined();
  const groups = JSON.parse(String(receipt!.attributes.ruleTargets));
  expect(groups).toEqual([[]]);
  expect(receipt!.attributes.noMatch).toBe(true);
  expect(effects(game).facilityOutputMultipliersById).toBeUndefined();
  expect(parseSave(serializeSave(game))).not.toBeNull();
});
