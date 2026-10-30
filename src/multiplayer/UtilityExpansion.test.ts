import "../Store";
import { loadSimData } from "../testing/SimData";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { acquisitionQuote } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { corridorsForGame } from "../data/IntertieAccess";
import { coopSeats } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";
import type { Command, World } from "./Types";

function command(world: World, action: Command) {
  return applyCommand(world, "0", {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences["0"] || 0) + 1,
    command: action,
  });
}
function ready() {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "expansion",
    "epoch",
  );
  currentTick(world.grids[0])!.cash = 1e9;
  expect(corridorsForGame(world.grids[0]).map((c) => c.id)).toEqual(
    expect.arrayContaining(["vt-champlain-valley", "vt-champlain-ridge"]),
  );
  expect(
    command(world, {
      kind: "action",
      name: "buildTransmissionLine",
      payload: { corridorId: "vt-champlain-ridge", financed: true },
    }),
  ).toBeUndefined();
  world.grids[0].transmission!.lines.find(
    (l) => l.corridorId === "vt-champlain-ridge",
  )!.yearsToBuildLeft = 0;
  return world;
}

it("host acquires a fictional utility while keeping other human companies independent", () => {
  const world = ready();
  const peerBefore = JSON.stringify(world.grids[1]);
  const quote = acquisitionQuote(world.grids[0], "ridge-electric")!;
  expect(quote).toBeDefined();
  const action: Command = {
    kind: "action",
    name: "acquireUtility",
    payload: {
      targetId: "ridge-electric",
      financed: true,
      quoteKey: quote.quoteKey,
    },
  };
  expect(command(world, action)).toBeUndefined();
  expect(world.grids[0].utilityExpansion!.areas.map((a) => a.id)).toContain(
    "ridge-electric",
  );
  expect(JSON.stringify(world.grids[1])).toBe(peerBefore);
  expect(roomView(world, "0").game!.utilityExpansion).toEqual(
    world.grids[0].utilityExpansion,
  );
  expect(command(world, action)).toMatch(/changed|quote|acquisition/i);
  const checkpoint = checkpointWorld(world);
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpoint)),
    "new-epoch",
  );
  expect(restored).toBeDefined();
  expect(restored!.grids[0].utilityExpansion).toEqual(
    world.grids[0].utilityExpansion,
  );
  for (const seat of world.seats)
    applyCommand(world, seat.id, {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: (world.sequences[seat.id] || 0) + 1,
      command: { kind: "ready" },
    });
  stepWorld(world);
  expect(world.grids[0].date.minute).toBe(world.grids[1].date.minute);
});

it("host rejects forged human-target ownership and wrong-target connections", () => {
  const world = ready();
  const before = JSON.stringify(world.grids[0]);
  expect(
    command(world, {
      kind: "action",
      name: "acquireUtility",
      payload: { targetId: "1", financed: true, quoteKey: "forged" },
    }),
  ).toMatch(/valid acquisition/i);
  expect(
    command(world, {
      kind: "action",
      name: "acquireUtility",
      payload: {
        targetId: "valley-electric",
        financed: true,
        quoteKey: "forged",
      },
    }),
  ).toMatch(/changed|quote/i);
  expect(JSON.stringify(world.grids[0])).toBe(before);
});
