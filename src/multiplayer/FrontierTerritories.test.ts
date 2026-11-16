import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import { LAND_TERRITORIES } from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import {
  landPurchaseQuote,
  ownedTerritories,
  landPrice,
} from "../helpers/Territories";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
  roomView,
} from "./World";
import type { World } from "./Types";
import type { LandTerritoryId } from "../Types";
function ready() {
  loadSimData(UTILITY_AREAS.champlain.location);
  return createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "frontier",
    "epoch",
  );
}
function buy(world: World, seat: string, id: LandTerritoryId) {
  const game = world.grids[world.seats.findIndex((s) => s.id === seat)];
  const quote = landPurchaseQuote(game, id)!;
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: {
      kind: "action",
      name: "acquireLand",
      payload: { territoryId: id, quoteKey: quote.quoteKey },
    },
  });
}
it("serializes each parcel's claim while independent claims coexist through save/resume", () => {
  const world = ready();
  const losingCash = currentTick(world.grids[1])!.cash;
  expect(buy(world, "0", "parcel-0")).toBeUndefined();
  expect(buy(world, "1", "parcel-0")).toMatch(/owned/i);
  expect(currentTick(world.grids[1])!.cash).toBe(losingCash);
  expect(buy(world, "1", "parcel-2")).toBeUndefined();
  expect(buy(world, "0", "parcel-1")).toBeUndefined();
  expect(roomView(world, "1").game!.multiplayer!.tileOwners).toMatchObject({
    "parcel-0:site-0": { seat: "0" },
    "parcel-1:city": { seat: "0" },
    "parcel-2:site-0": { seat: "1" },
  });
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "restored",
  );
  expect(ownedTerritories(restored.grids[0])).toEqual(
    expect.arrayContaining(["parcel-0", "parcel-1"]),
  );
  expect(ownedTerritories(restored.grids[1])).toContain("parcel-2");
  expect(buy(restored, "1", "parcel-1")).toMatch(/owned/i);
});
it("migrates only recognized published schema14 co-op rules and keeps paid claims and cash", () => {
  const world = ready();
  world.grids[0].territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: landPrice(world.grids[0], 0),
  });
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  raw.gameSchema = 14;
  raw.rules =
    "coop-2-b4c8f4641c919057a7b569242464c24e26bcec444ef68954be2796b7734bbbb8";
  for (const grid of raw.grids) {
    grid.territoryNetwork.version = 2;
    delete grid.territoryNetwork.tilePurchases;
    delete grid.territoryNetwork.legacyTiles;
  }
  const restored = restoreWorld(raw, "migrated");
  expect(restored.gameSchema).toBe(SAVE_SCHEMA_VERSION);
  expect(currentTick(restored.grids[0])!.cash).toBe(
    currentTick(world.grids[0])!.cash,
  );
  expect(ownedTerritories(restored.grids[0])).toContain("green-uplands");
  expect(restored.grids[0].runIdentity).toEqual(raw.grids[0].runIdentity);
  const wrong = JSON.parse(JSON.stringify(raw));
  wrong.rules = "unrecognized";
  expect(() => restoreWorld(wrong, "rejected")).toThrow();
  expect(LAND_TERRITORIES).toHaveLength(19);
});
