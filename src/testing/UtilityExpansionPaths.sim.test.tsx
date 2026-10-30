import { TICK_MINUTES } from "../Constants";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { loanBalanceAfterTicks } from "../helpers/Financials";
import { deserialize, serialize } from "v8";
import { forecastWorkerSnapshot } from "../components/base/ForecastWorkerSnapshot";
import {
  packProjection,
  projectionDecoder,
} from "../components/base/ProjectionTransport";
import { UTILITY_AREAS, UTILITY_TARGETS } from "../data/UtilityExpansion";
import { acquisitionQuote } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { selectProjection } from "../helpers/Projection";
import { parseSave, serializeSave } from "../SaveGame";
import type { GameType } from "../Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  stepWorld,
} from "../multiplayer/World";
import type { Command, World } from "../multiplayer/Types";
import { canonical, digest } from "./CanonicalHash";
import { coopSeats } from "./MultiplayerFixtures";
import {
  copyOfficialGame,
  officialQuote,
  playOfficialExecution,
} from "./OfficialScenarioExecutionFixtures";
import { loadSimData } from "./SimData";
import { runSimulation, ScheduledSimActionType } from "./Simulator";
import {
  EXPANSION_BALANCE_CASES,
  expansionBalanceActions,
} from "./UtilityExpansionBalanceFixtures";

jest.setTimeout(180000);
const saveMonths = new Set([96, 143, 144, 191, 227, 239, 240]);
const workerMonths = new Set([96, 144, 239]);

function serialGame(game: GameType) {
  return JSON.parse(JSON.stringify(serializeSave(game))).game;
}
function verifyWorker(game: GameType, label: string) {
  const before = JSON.stringify(game.utilityExpansion);
  const direct = selectProjection(game, currentTick(game)!);
  const transferred: GameType = deserialize(
    serialize(forecastWorkerSnapshot(game)),
  );
  const projected = selectProjection(transferred, currentTick(transferred)!);
  const { transport } = packProjection(projected);
  const decoded = projectionDecoder(
    transport,
    game,
    currentTick(game)!,
  )(Infinity)!;
  expect({ label, projection: digest(decoded) }).toEqual({
    label,
    projection: digest(direct),
  });
  expect(JSON.stringify(game.utilityExpansion)).toBe(before);
}

it.each(UTILITY_TARGETS)(
  "$name stays identical through reached saves, worker forecasts and a repeated seeded campaign",
  (target) => {
    const fixture = EXPANSION_BALANCE_CASES.find(
      ({ id }) => id === `${target.id}-firm-loan`,
    )!;
    const scheduledActions = expansionBalanceActions(fixture, 12345);
    const settings = {
      difficulty: "Employee" as const,
      seed: 12345,
      plan: { scheduledActions },
    };
    const uninterrupted = playOfficialExecution(116, {}, settings);
    expect(uninterrupted.violations).toEqual([]);
    const reached = new Set<string>();
    const resumed = playOfficialExecution(
      116,
      {
        beforeTick(game) {
          if (game.date.monthsElapsed !== 96 || game.date.minuteOfDay !== 0)
            return;
          expect(
            game.utilityExpansion!.acquisitions.map(({ targetId }) => targetId),
          ).toContain(target.id);
          const restored = parseSave(
            JSON.parse(JSON.stringify(serializeSave(game))),
          );
          expect(restored).not.toBeNull();
          verifyWorker(game, "immediately after purchase");
          Object.assign(game, copyOfficialGame(restored!.game));
          reached.add("post-purchase");
        },
        monthClose(game) {
          if (!saveMonths.has(game.date.monthsElapsed)) return;
          const envelope = JSON.parse(JSON.stringify(serializeSave(game)));
          const restored = parseSave(envelope);
          expect({
            month: game.date.monthsElapsed,
            accepted: !!restored,
          }).toEqual({ month: game.date.monthsElapsed, accepted: true });
          expect(serialGame(restored!.game)).toEqual(serialGame(game));
          if (workerMonths.has(game.date.monthsElapsed))
            verifyWorker(game, `month ${game.date.monthsElapsed}`);
          Object.assign(game, copyOfficialGame(restored!.game));
          reached.add(`month:${game.date.monthsElapsed}`);
        },
      },
      settings,
    );
    expect(resumed.violations).toEqual([]);
    expect([...reached].sort()).toEqual(
      [
        "post-purchase",
        ...Array.from(saveMonths, (month) => `month:${month}`),
      ].sort(),
    );
    expect(serialGame(resumed.game)).toEqual(serialGame(uninterrupted.game));
    expect(
      gameObjectiveResults(resumed.game).every(
        (goal) => !goal.required || goal.status === "completed",
      ),
    ).toBe(true);
    const simulated = runSimulation({
      scenarioId: 116,
      difficulty: "Employee",
      seed: 12345,
      scheduledActions,
    });
    expect(canonical(simulated.months)).toEqual(
      canonical([...uninterrupted.game.monthlyHistory].reverse()),
    );
    expect(canonical(simulated.finalUtilityExpansion)).toEqual(
      canonical(uninterrupted.game.utilityExpansion),
    );
    expect(simulated.finalCash).toBe(currentTick(uninterrupted.game)!.cash);
  },
);

function command(world: World, seatId: string, action: Command) {
  const error = applyCommand(world, seatId, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seatId] ?? 0) + 1,
    command: action,
  });
  if (error)
    throw new Error(
      `${seatId} at ${world.grids.find((grid) => grid.multiplayer?.seat === seatId)?.date.monthsElapsed}: ${error}`,
    );
}
function applyScheduled(
  world: World,
  index: number,
  action: ScheduledSimActionType,
) {
  const game = world.grids[index],
    seat = world.seats[index].id;
  switch (action.type) {
    case "rate":
      command(world, seat, { kind: "rate", value: action.dollarsPerkWh });
      break;
    case "intertie":
      command(world, seat, {
        kind: "action",
        name: "buildTransmissionLine",
        payload: {
          corridorId: action.corridorId,
          financed: action.financed,
          tier: action.tier,
        },
      });
      break;
    case "acquire": {
      const quote = acquisitionQuote(game, action.targetId);
      if (!quote)
        throw new Error(
          "Host acquisition was not eligible after completed construction",
        );
      command(world, seat, {
        kind: "action",
        name: "acquireUtility",
        payload: {
          targetId: action.targetId,
          financed: action.financed,
          quoteKey: quote.quoteKey,
        },
      });
      break;
    }
    case "retire": {
      const asset = game.facilities.find(
        (facility) => facility.startingAssetId === action.assetId,
      );
      if (asset)
        command(world, seat, {
          kind: "action",
          name: "sellFacility",
          payload: asset.id,
        });
      break;
    }
    case "build":
      command(world, seat, {
        kind: "action",
        name: "buildFacility",
        payload: {
          facility: officialQuote(game, action.build),
          financed: action.build.financed,
          operatingAreaId: action.build.operatingAreaId,
        },
      });
      break;
    default:
      throw new Error(`Unmapped expansion fixture action: ${action.type}`);
  }
}

it("host-authoritative co-op reaches 2024 with independent targets and restores purchase, 2017 and retirement checkpoints", () => {
  loadSimData(UTILITY_AREAS.champlain.location);
  let world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "expansion-full-term",
    "initial",
  );
  const actions = UTILITY_TARGETS.map((target) =>
    expansionBalanceActions(
      EXPANSION_BALANCE_CASES.find(
        ({ id }) => id === `${target.id}-firm-loan`,
      )!,
      world.grids[0].seed,
    ),
  );
  const reached: number[] = [];
  for (const seat of world.seats) command(world, seat.id, { kind: "ready" });
  for (let month = 0; month < 240; month++) {
    for (let index = 0; index < actions.length; index++)
      for (const action of actions[index])
        if (action.month === month) applyScheduled(world, index, action);
    const until = (month + 1) * MINUTES_PER_MONTH;
    while (world.grids[0].date.minute < until) {
      const previous = world.grids[0].date.minute;
      stepWorld(world);
      if (world.grids[0].date.minute === previous)
        throw new Error(`Host stopped at month ${month}: ${world.reason}`);
    }
    if (![97, 144, 228].includes(month + 1)) continue;
    const before = world.grids.map((grid) => digest(serialGame(grid)));
    world = restoreWorld(
      JSON.parse(JSON.stringify(checkpointWorld(world))),
      `restored-${month + 1}`,
    );
    expect(world.grids.map((grid) => digest(serialGame(grid)))).toEqual(before);
    reached.push(month + 1);
    for (const seat of world.seats) command(world, seat.id, { kind: "ready" });
  }
  expect(reached).toEqual([97, 144, 228]);
  expect(world.grids.map((game) => game.date.monthsElapsed)).toEqual([
    240, 240,
  ]);
  expect(
    world.grids.map((game) =>
      game.utilityExpansion!.acquisitions.map(({ targetId }) => targetId),
    ),
  ).toEqual([["valley-electric"], ["ridge-electric"]]);
  expect(
    world.grids.every((game) =>
      gameObjectiveResults(game).every(
        (goal) => !goal.required || goal.status === "completed",
      ),
    ),
  ).toBe(true);
  expect(
    Object.values(world.outcomes).map((outcome) => outcome.outcome),
  ).toEqual(["completed", "completed"]);
});

it("corporate loans pay only elapsed ticks across the first acquired month close", () => {
  const fixture = EXPANSION_BALANCE_CASES.find(
    ({ id }) => id === "valley-electric-firm-loan",
  )!;
  const { game } = playOfficialExecution(
    116,
    { throughMonth: 97 },
    {
      difficulty: "Employee",
      seed: 12345,
      plan: { scheduledActions: expansionBalanceActions(fixture, 12345) },
    },
  );
  for (const loan of game.utilityExpansion!.loans) {
    const expected = loanBalanceAfterTicks(
      loan.principal,
      loan.loanMonthlyPayment,
      loan.interestRate,
      (game.date.minute - loan.minuteCreated) / TICK_MINUTES,
    );
    expect({
      loan: loan.id,
      balance: Number(loan.loanAmountLeft.toFixed(2)),
    }).toEqual({ loan: loan.id, balance: Number(expected.toFixed(2)) });
  }
});
