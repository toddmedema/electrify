import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { currentTick } from "../helpers/GameSelectors";
import { facilityExpansionQuote } from "../helpers/FacilityExpansion";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
  stepWorld,
} from "./World";
import type { Command, World } from "./Types";

function command(world: World, sender: string, action: Command) {
  return applyCommand(world, sender, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[sender] ?? 0) + 1,
    command: action,
  });
}

it("host prices and cancels only the sender's facilities and preserves a pending checkpoint", () => {
  createGame({ scenarioId: 104 }); // Load the same simulation datasets as the real host.
  const world = createWorld(
    { scenarioId: 104, difficulty: "Employee" },
    coopSeats(2),
    "capacity",
    "epoch",
  );
  currentTick(world.grids[0])!.cash = 1e12;
  currentTick(world.grids[1])!.cash = 1e12;
  world.grids[1].facilities[0].id = 999;
  const peer = cloneDeep(world.grids[1].facilities);
  const original = world.grids[0].facilities[0];
  const quote = facilityExpansionQuote(
    world.grids[0],
    original.id,
    original.peakW * 1.2,
  );
  if (quote.status !== "ready") throw new Error(quote.reason);
  const action: Command = {
    kind: "action",
    name: "expandFacility",
    payload: {
      facilityId: original.id,
      targetSize: quote.targetSize,
      quoteKey: quote.quoteKey,
    },
  };
  expect(
    command(world, "0", {
      ...action,
      payload: { ...(action.payload as object), facilityId: 999 },
    }),
  ).toBeDefined();
  expect(command(world, "0", action)).toBeUndefined();
  expect(world.grids[0].facilities[0].peakW).toBe(original.peakW);
  expect(world.grids[0].facilities[0].expansionInProgress!.quoteKey).toBe(
    quote.quoteKey,
  );
  expect(world.grids[1].facilities).toEqual(peer);
  expect(command(world, "0", action)).toBeDefined();
  const checkpoint = checkpointWorld(world);
  const restored = restoreWorld(checkpoint, "restored-epoch");
  expect(restored.grids[0].facilities).toEqual(world.grids[0].facilities);
  for (const match of [world, restored]) {
    for (const seat of match.seats) {
      expect(command(match, seat.id, { kind: "ready" })).toBeUndefined();
      expect(
        command(match, seat.id, { kind: "speed", speed: "FAST" }),
      ).toBeUndefined();
    }
  }
  const beforeMinute = world.grids[0].date.minute;
  stepWorld(world);
  stepWorld(restored);
  expect(world.grids[0].date.minute).toBeGreaterThan(beforeMinute);
  expect(restored.grids[0].facilities).toEqual(world.grids[0].facilities);
  expect(
    command(world, "0", {
      kind: "action",
      name: "cancelFacilityExpansion",
      payload: original.id,
    }),
  ).toBeUndefined();
  expect(world.grids[0].facilities[0].expansionInProgress).toBeUndefined();
  expect(
    command(world, "0", {
      kind: "action",
      name: "cancelFacilityExpansion",
      payload: original.id,
    }),
  ).toBeDefined();
});
