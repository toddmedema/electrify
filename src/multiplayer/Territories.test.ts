import { GREEN_UPLANDS_CORRIDOR_ID } from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import { territoryBuildAvailability } from "../helpers/Territories";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { applyCommand, createWorld } from "./World";
import type { Command, World } from "./Types";

function command(world: World, action: Command) {
  return applyCommand(world, "0", {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences["0"] ?? 0) + 1,
    command: action,
  });
}

function ready() {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "territories",
    "epoch",
  );
  currentTick(world.grids[0])!.cash = 1e9;
  return world;
}

const wind = (territoryId: unknown, peakW = 50e6): Command => ({
  kind: "action",
  name: "buildFacility",
  payload: {
    territoryId,
    financed: true,
    // The host must supply the price and technology, ignoring the sender's free quote.
    facility: { name: "Wind", peakW, buildCost: 0 },
  },
});

it("host rejects unknown, unowned and oversized build destinations without buying a plant", () => {
  const world = ready();
  const before = JSON.stringify(world.grids[0]);
  expect(command(world, wind("imaginary-territory"))).toMatch(/territory/i);
  expect(command(world, wind("valley-electric"))).toBeDefined();
  expect(command(world, wind("champlain", 1e9))).toBeDefined();
  expect(JSON.stringify(world.grids[0])).toBe(before);
});

it("host unlocks empty land only after construction, reprices local builds and reserves their sites", () => {
  const world = ready();
  const peerBefore = JSON.stringify(world.grids[1]);
  const customerCount = currentTick(world.grids[0])!.customers;
  expect(
    command(world, {
      kind: "action",
      name: "buildTransmissionLine",
      payload: { corridorId: GREEN_UPLANDS_CORRIDOR_ID, financed: true },
    }),
  ).toBeUndefined();
  const line = world.grids[0].transmission!.lines.find(
    (entry) => entry.corridorId === GREEN_UPLANDS_CORRIDOR_ID,
  )!;
  expect(line.yearsToBuildLeft).toBeGreaterThan(0);
  expect(command(world, wind("green-uplands"))).toBeDefined();
  line.yearsToBuildLeft = 0;
  expect(command(world, wind("green-uplands"))).toBeUndefined();
  const built = world.grids[0].facilities.find(
    (facility) => facility.territoryId === "green-uplands",
  )!;
  expect(built.buildCost).toBeGreaterThan(0);
  expect(built.yearsToBuildLeft).toBeGreaterThan(0);
  expect(currentTick(world.grids[0])!.customers).toBe(customerCount);
  const remaining = territoryBuildAvailability(
    world.grids[0],
    built,
    "green-uplands",
  ).remaining;
  for (let site = 0; site < remaining; site++)
    expect(command(world, wind("green-uplands"))).toBeUndefined();
  const count = world.grids[0].facilities.length;
  expect(command(world, wind("green-uplands"))).toBeDefined();
  expect(world.grids[0].facilities).toHaveLength(count);
  expect(JSON.stringify(world.grids[1])).toBe(peerBefore);
});
