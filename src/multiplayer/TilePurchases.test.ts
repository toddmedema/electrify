import cloneDeep from "lodash.clonedeep";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import { tilePrice, tilePurchaseQuote } from "../helpers/Territories";
import { ownsTerritoryTile } from "../helpers/TerritoryTiles";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  roomView,
} from "./World";
import type { World } from "./Types";
import type { TerritoryTileId } from "../Types";
function ready() {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "physical-claims",
    "epoch",
  );
  world.grids.forEach((game) => {
    currentTick(game)!.cash = 3e9;
  });
  return world;
}
function buy(world: World, seat: string, tileId: unknown, quoteKey: unknown) {
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: {
      kind: "action",
      name: "acquireTile",
      payload: { tileId, quoteKey },
    },
  });
}
it("claims individual cells exclusively while different cells in one old parcel remain independent", () => {
  const world = ready();
  const first = tilePurchaseQuote(world.grids[0], "green-uplands:site-0")!;
  const competing = tilePurchaseQuote(world.grids[1], first.tileId)!;
  expect(buy(world, "0", first.tileId, first.quoteKey)).toBeUndefined();
  const losing = JSON.stringify(world.grids[1]);
  expect(buy(world, "1", competing.tileId, competing.quoteKey)).toBeDefined();
  expect(JSON.stringify(world.grids[1])).toBe(losing);
  const next = tilePurchaseQuote(
    roomView(world, "1").game!,
    "green-uplands:site-1",
  )!;
  expect(buy(world, "1", next.tileId, next.quoteKey)).toBeUndefined();
  expect(ownsTerritoryTile(world.grids[0], first.tileId)).toBe(true);
  expect(ownsTerritoryTile(world.grids[0], next.tileId)).toBe(false);
  expect(roomView(world, "0").game!.multiplayer!.tileOwners).toMatchObject({
    [first.tileId]: { seat: "0" },
    [next.tileId]: { seat: "1" },
  });
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "restored",
  );
  const cash = currentTick(restored.grids[1])!.cash;
  expect(buy(restored, "1", first.tileId, first.quoteKey)).toBeDefined();
  expect(currentTick(restored.grids[1])!.cash).toBe(cash);
  const forged = JSON.parse(JSON.stringify(checkpointWorld(world)));
  forged.grids[1].territoryNetwork.tilePurchases.push({
    ...forged.grids[0].territoryNetwork.tilePurchases[0],
  });
  expect(() => restoreWorld(forged, "forged")).toThrow();
});
it.each([
  null,
  "frontier:-0:1",
  "frontier:1000000:0",
  "frontier:9007199254740992:0",
])("rejects invalid or unseen %s before charging", (tileId) => {
  const world = ready();
  const before = JSON.stringify(world.grids);
  expect(
    buy(
      world,
      "0",
      tileId,
      JSON.stringify([
        tileId,
        0,
        tilePrice(world.grids[0], 0, tileId as TerritoryTileId),
      ]),
    ),
  ).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(before);
});
it("rejects stale, unaffordable and duplicate city claims without duplicate customer credit", () => {
  const world = ready();
  const game = world.grids[0];
  const quote = tilePurchaseQuote(game, "parcel-1:city")!;
  const before = JSON.stringify(world.grids);
  expect(buy(world, "0", quote.tileId, "stale")).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(before);
  currentTick(game)!.cash = quote.price - 1;
  const low = JSON.stringify(world.grids);
  expect(buy(world, "0", quote.tileId, quote.quoteKey)).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(low);
  currentTick(game)!.cash = quote.price;
  const customers = currentTick(game)!.customers;
  expect(buy(world, "0", quote.tileId, quote.quoteKey)).toBeUndefined();
  expect(currentTick(world.grids[0])!.cash).toBe(0);
  expect(currentTick(world.grids[0])!.customers).toBe(
    customers + quote.customers,
  );
  const after = JSON.stringify(world.grids);
  expect(buy(world, "0", quote.tileId, quote.quoteKey)).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(after);
});
it("restores only the published schema16 identity, preserving old whole-parcel rights and finances", () => {
  const world = ready();
  world.grids[0].territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: 18e6,
  });
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  raw.gameSchema = 16;
  raw.rules =
    "coop-2-06e4afd05778c47de20788acd02787291d3f09456465a0a89ace5fbeadd2d018";
  raw.grids.forEach(
    (grid: { territoryNetwork: { tilePurchases?: unknown } }) =>
      delete grid.territoryNetwork.tilePurchases,
  );
  const unchanged = JSON.stringify(raw);
  const restored = restoreWorld(raw, "schema17");
  expect(JSON.stringify(raw)).toBe(unchanged);
  expect(ownsTerritoryTile(restored.grids[0], "green-uplands:site-6")).toBe(
    true,
  );
  expect(currentTick(restored.grids[0])!.cash).toBe(
    currentTick(world.grids[0])!.cash,
  );
  const wrong = cloneDeep(raw);
  wrong.rules = "unrecognized";
  expect(() => restoreWorld(wrong, "rejected")).toThrow();
});
