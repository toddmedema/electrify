import "../Store";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import { achievementHooks } from "../achievements/Achievements";
import { currentTick } from "../helpers/GameSelectors";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { projectAuthoredRunReference } from "../helpers/RunIdentity";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { modPackage } from "../testing/ModFixtures";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import type { Command, World } from "./Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";

const packageData = (): ModPackage =>
  modPackage({
    id: "durable-companies",
    title: "Durable companies",
    creator: "Fixture author",
    description:
      "A company decides whether to accept local connection funding.",
    seed: 2468,
    officialArcs: [],
    scenario: {
      durationMonths: 6,
      startingYear: 2020,
      startingCustomers: 10000,
      cash: 1e9,
      dollarsPerkWh: 0.2,
    },
    objectives: [
      {
        id: "reliable",
        label: "Serve demand",
        metric: "monthlyReliability",
        fromMonth: 1,
        throughMonth: 6,
        minDemandServedShare: 1,
      },
      {
        id: "free-bills",
        label: "Offer free electricity",
        metric: "monthlyBilledRate",
        fromMonth: 1,
        throughMonth: 6,
        maxDollarsPerKWh: 0,
        required: false,
      },
    ],
    events: [
      {
        id: "opening-funds",
        title: "Opening funds",
        message: "Your grid receives opening funds.",
        preview: "Your grid will receive opening funds.",
        startMonth: 1,
        durationMonths: 1,
        effects: {
          transactions: [{ kind: "grant", amountDollars: 5000 }],
        },
      },
      {
        id: "connection-funds",
        title: "Connection funds",
        message: "Your grid receives the connection contribution.",
        preview: "Your grid will receive the connection contribution.",
        startMonth: 3,
        durationMonths: 1,
        requiresChoice: { choiceId: "funding", optionIds: ["accept"] },
        effects: {
          transactions: [{ kind: "grant", amountDollars: 20000 }],
        },
      },
    ],
    choices: [
      {
        id: "funding",
        title: "Connection funding",
        prompt: "Choose whether your grid accepts the contribution.",
        dueMonth: 2,
        options: [
          {
            id: "accept",
            label: "Accept funding",
            description: "Receive funding now and a contribution next month.",
            message: "Funding accepted.",
            grantDollars: 10000,
          },
          {
            id: "decline",
            label: "Decline funding",
            description: "Continue without contributions.",
            message: "Funding declined.",
            costDollars: 0,
          },
        ],
      },
    ],
  });

function command(world: World, seat: string, action: Command) {
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: action,
  });
}

function consent(world: World) {
  world.seats.forEach((seat) => {
    expect(command(world, seat.id, { kind: "ready" })).toBeUndefined();
  });
}

function advance(world: World, months: number) {
  for (
    let tick = 0;
    world.grids[0].date.monthsElapsed < months &&
    tick < (months + 1) * TICKS_PER_MONTH;
    tick++
  )
    stepWorld(world);
  expect(world.grids.map((game) => game.date.monthsElapsed)).toEqual([
    months,
    months,
  ]);
}

const save = (world: World): World =>
  JSON.parse(JSON.stringify(checkpointWorld(world)));

function respond(world: World) {
  world.seats.forEach((seat, index) => {
    const choice = pendingScenarioChoice(world.grids[index]);
    expect(choice?.id).toBe("mod:durable-companies:funding");
    expect(
      command(world, seat.id, {
        kind: "action",
        name: "chooseScenarioResponse",
        payload: {
          decisionId: choice!.id,
          optionId: index === 0 ? "accept" : "decline",
        },
      }),
    ).toBeUndefined();
  });
}

beforeAll(() => loadSimData("SF"));
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("ordinary custom co-op games remain playable without mod provenance", () => {
  const world = createWorld(COOP_TEST_SPEC, coopSeats(2), "custom", "original");
  expect(restoreWorld(save(world), "resumed").spec).toEqual(COOP_TEST_SPEC);
  expect(
    world.grids.every((game) => game.customScenario?.mod === undefined),
  ).toBe(true);
});

test("pending and answered co-op saves retain their frozen rules after the package is updated and removed", () => {
  const input = packageData();
  const selected = modScenario(input, undefined, "Employee");
  const original = createWorld(
    { scenarioId: 999, difficulty: "Employee", customScenario: selected },
    coopSeats(2),
    "durability",
    "original",
  );
  const digest = selected.mod!.runtimeDigest;
  consent(original);
  advance(original, 1);
  const pending = save(original);

  // The same package identity can now mean different content in the host's library.
  // Neither the saved match nor its resume receives that new package or a library entry.
  input.version = "2";
  input.events![0].effects!.transactions![0].amountDollars = 999999;
  const updated = modScenario(input, undefined, "Employee");
  expect(updated.mod!.runtimeDigest).not.toBe(digest);
  const resumed = restoreWorld(pending, "after-removal");
  expect(resumed.spec.customScenario!.mod!.source.version).toBe("1");
  expect(resumed.spec.customScenario!.mod!.runtimeDigest).toBe(digest);
  expect(resumed.spec.customScenario).not.toBe(pending.spec.customScenario);
  expect(resumed.grids.every((game) => pendingScenarioChoice(game))).toBe(true);

  respond(original);
  respond(resumed);
  consent(resumed);
  advance(original, 2);
  advance(resumed, 2);

  const answered = restoreWorld(save(resumed), "answered-reload");
  answered.grids.forEach((game) => {
    expect(pendingScenarioChoice(game)).toBeUndefined();
  });
  const beforeDuplicate = currentTick(answered.grids[0])!.cash;
  expect(
    command(answered, "0", {
      kind: "action",
      name: "chooseScenarioResponse",
      payload: {
        decisionId: "mod:durable-companies:funding",
        optionId: "accept",
      },
    }),
  ).toBeUndefined();
  expect(currentTick(answered.grids[0])!.cash).toBe(beforeDuplicate);
  consent(answered);
  advance(original, 3);
  advance(resumed, 3);
  advance(answered, 3);

  for (const world of [resumed, answered]) {
    world.grids.forEach((game, index) => {
      const expected = original.grids[index];
      expect(game.monthlyHistory).toEqual(expected.monthlyHistory);
      expect(game.worldEvents).toEqual(expected.worldEvents);
      expect(game.objectiveProgress).toEqual(expected.objectiveProgress);
      expect(currentTick(game)!.cash).toBe(currentTick(expected)!.cash);
      expect(game.customScenario!.mod!.runtimeDigest).toBe(digest);
      expect(gameObjectiveResults(game)).toEqual(
        gameObjectiveResults(expected),
      );
      expect(gameObjectiveResults(game)).toContainEqual(
        expect.objectContaining({
          id: "free-bills",
          required: false,
          status: "failed",
        }),
      );
    });
  }
  expect(original.grids[0].monthlyHistory[0].revenueGrants).toBe(20000);
  expect(original.grids[0].monthlyHistory[1].revenueGrants).toBe(10000);
  expect(original.grids[1].monthlyHistory[0].revenueGrants).toBe(0);
  for (const world of [original, resumed, answered]) {
    advance(world, 6);
    expect(
      Object.values(world.outcomes).map((outcome) => outcome.outcome),
    ).toEqual(["completed", "completed"]);
    world.grids.forEach((game, index) => {
      expect(game.monthlyHistory).toEqual(original.grids[index].monthlyHistory);
      expect(game.objectiveProgress).toEqual(
        original.grids[index].objectiveProgress,
      );
      expect(gameObjectiveResults(game)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "reliable",
            required: true,
            status: "completed",
          }),
          expect.objectContaining({
            id: "free-bills",
            required: false,
            status: "failed",
          }),
        ]),
      );
      expect(gameObjectiveResults(game)).toHaveLength(2);
      expect(
        game.monthlyHistory.reduce(
          (sum, month) => sum + (month.revenueGrants ?? 0),
          0,
        ),
      ).toBe(index === 0 ? 35000 : 5000);
      achievementHooks.finish(game, "completed");
      expect(game.desktopAchievements).toBeUndefined();
      expect(game.runIdentity).toBeUndefined();
    });
  }
  expect(input.version).toBe("2");
});

test("every modded company remains unranked and cannot accrue desktop achievements before or after resume", () => {
  const selected = modScenario(packageData(), undefined, "Employee");
  const world = createWorld(
    { scenarioId: 999, difficulty: "Employee", customScenario: selected },
    coopSeats(2),
    "unranked",
    "original",
  );
  const restored = restoreWorld(save(world), "restored");
  for (const candidate of [world, restored]) {
    candidate.seats.forEach((seat) => {
      const game = cloneDeep(roomView(candidate, seat.id).game!);
      expect(game.scenarioId).toBe(999);
      expect(game.customScenario!.mod!.runtimeDigest).toBe(
        selected.mod!.runtimeDigest,
      );
      expect(game.runIdentity).toBeUndefined();
      expect(projectAuthoredRunReference(game.runIdentity)).toBeUndefined();
      achievementHooks.initialize?.(game);
      achievementHooks.tick?.(game, currentTick(game)!);
      expect(game.desktopAchievements).toBeUndefined();
    });
  }
});
