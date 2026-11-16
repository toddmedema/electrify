import { createWorld, applyCommand, roomView, checkpointWorld } from "./World";
import { getTerritoryTiles } from "../helpers/TerritoryTiles";
import { landPurchaseQuote } from "../helpers/Territories";
import { currentTick } from "../helpers/GameSelectors";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import type { Command, World } from "./Types";
const command = (world: World, seat: string, command: Command) =>
  applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command,
  });
it("projects actual foregrounds on other companies' claimed land without changing saved state", () => {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "map-view",
    "epoch",
  );
  currentTick(world.grids[0])!.cash = 1e9;
  const quote = landPurchaseQuote(world.grids[0], "parcel-0")!;
  expect(
    command(world, "0", {
      kind: "action",
      name: "acquireLand",
      payload: { territoryId: quote.territoryId, quoteKey: quote.quoteKey },
    }),
  ).toBeUndefined();
  const tile = getTerritoryTiles().find(
    (tile) => tile.territoryId === "parcel-0" && !tile.city,
  )!;
  expect(
    command(world, "0", {
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: { name: "Wind", peakW: 50e6 },
        financed: false,
        territoryId: tile.territoryId,
        tileId: tile.id,
      },
    }),
  ).toBeUndefined();
  const before = JSON.stringify(checkpointWorld(world));
  const view = roomView(world, "1").game!;
  expect(view.multiplayer!.tileFacilities![tile.id]).toMatchObject({
    seat: "0",
    name: "Wind",
    peakW: 50e6,
    yearsToBuildLeft: expect.any(Number),
  });
  expect(Object.keys(view.multiplayer!.tileFacilities!)).toEqual([tile.id]);
  expect(view.facilities.some((f) => f.tileId === tile.id)).toBe(false);
  expect(JSON.stringify(checkpointWorld(world))).toBe(before);
});
