import cloneDeep from "lodash.clonedeep";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import {
  tilePrice,
  tilePurchaseQuote,
  tilePurchaseQuotes,
} from "../helpers/Territories";
import {
  getTerritoryTile,
  ownsTerritoryTile,
  territoryHexDistance,
  territoryVisibilityDistance,
} from "../helpers/TerritoryTiles";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { TICK_MINUTES } from "../Constants";
import { acquisitionQuote } from "../helpers/Expansion";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  roomView,
  stepWorld,
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
function startClock(world: World) {
  world.seats.forEach((seat) => {
    expect(
      applyCommand(world, seat.id, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: (world.sequences[seat.id] ?? 0) + 1,
        command: { kind: "speed", speed: "NORMAL" },
      }),
    ).toBeUndefined();
  });
}
it("accepts unchanged land quotes after a host clock tick and rejects real CPI repricing", () => {
  const world = ready();
  const offer = tilePurchaseQuote(
    roomView(world, "0").game!,
    "green-uplands:site-0",
  )!;
  const city = tilePurchaseQuote(roomView(world, "0").game!, "parcel-1:city")!;
  startClock(world);
  stepWorld(world);
  expect(world.grids[0].date.minute).toBe(TICK_MINUTES);
  expect(
    tilePurchaseQuote(roomView(world, "0").game!, offer.tileId)!.price,
  ).toBe(offer.price);
  expect(buy(world, "0", offer.tileId, offer.quoteKey)).toBeUndefined();
  const grownCity = tilePurchaseQuote(roomView(world, "0").game!, city.tileId)!;
  expect(grownCity.customers).toBeGreaterThan(city.customers);
  const customers = currentTick(world.grids[0])!.customers;
  expect(buy(world, "0", city.tileId, city.quoteKey)).toBeUndefined();
  expect(currentTick(world.grids[0])!.customers).toBe(
    customers + grownCity.customers,
  );
  const next = tilePurchaseQuote(
    roomView(world, "0").game!,
    "green-uplands:site-1",
  )!;
  world.grids.forEach((grid) => {
    grid.date = getDateFromMinute(MINUTES_PER_MONTH, grid.startingYear);
  });
  expect(
    tilePurchaseQuote(roomView(world, "0").game!, next.tileId)!.price,
  ).not.toBe(next.price);
  const before = JSON.stringify(world.grids);
  expect(buy(world, "0", next.tileId, next.quoteKey)).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(before);
});
function buyToward(world: World, seat: string, target: TerritoryTileId) {
  const destination = getTerritoryTile(target)!;
  for (let count = 0; count < 20; count++) {
    const game = roomView(world, seat).game!;
    const offer =
      tilePurchaseQuote(game, target) ??
      [...tilePurchaseQuotes(game).values()].sort(
        (a, b) =>
          territoryHexDistance(getTerritoryTile(a.tileId)!, destination) -
          territoryHexDistance(getTerritoryTile(b.tileId)!, destination),
      )[0];
    expect(offer).toBeDefined();
    expect(buy(world, seat, offer.tileId, offer.quoteKey)).toBeUndefined();
    if (offer.tileId === target) return;
  }
  throw new Error("No path to remote peer land");
}
it("reveals connected peer land, buys beyond it, and resumes the chronological shared claims", () => {
  const world = ready();
  const peerTile = "frontier:-16:-3";
  const target = getTerritoryTile("frontier:-19:-3")!;
  expect(
    territoryVisibilityDistance(roomView(world, "1").game!, target),
  ).toBeUndefined();
  buyToward(world, "0", peerTile);
  startClock(world);
  stepWorld(world);
  const view = roomView(world, "1").game!;
  expect(territoryVisibilityDistance(view, getTerritoryTile(peerTile)!)).toBe(
    0,
  );
  expect(territoryVisibilityDistance(view, target)).toBe(3);
  const quote = tilePurchaseQuote(view, target.id)!;
  expect(buy(world, "1", target.id, quote.quoteKey)).toBeUndefined();
  // Seat 0's next receipt depends on seat 1's receipt at the same clock instant.
  const extension = tilePurchaseQuote(
    roomView(world, "0").game!,
    "frontier:-22:-3",
  )!;
  expect(buy(world, "0", extension.tileId, extension.quoteKey)).toBeUndefined();
  stepWorld(world);
  stepWorld(world);
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  const restored = restoreWorld(raw, "resumed");
  expect(ownsTerritoryTile(restored.grids[1], target)).toBe(true);
  expect(
    territoryVisibilityDistance(roomView(restored, "1").game!, target),
  ).toBe(0);
  expect(restored.grids.map((grid) => grid.territoryNetwork)).toEqual(
    world.grids.map((grid) => grid.territoryNetwork),
  );
  const unknown = cloneDeep(raw);
  unknown.grids[0].territoryNetwork.tilePurchases = [];
  unknown.grids[1].multiplayer.tileOwners = {
    [peerTile]: { seat: "0", name: "Player 0" },
  };
  expect(() => restoreWorld(unknown, "forged-anchor")).toThrow();
  const future = cloneDeep(raw);
  future.grids[0].territoryNetwork.tilePurchases.forEach(
    (receipt: { minute: number }) => {
      receipt.minute = 2 * TICK_MINUTES;
    },
  );
  expect(() => restoreWorld(future, "future-anchor")).toThrow();
  future.grids[1].territoryNetwork.tilePurchases[0].minute = 2 * TICK_MINUTES;
  expect(() => restoreWorld(future, "chronological-neighbor")).not.toThrow();
});
it("rejects circular same-minute remote claims even with forged projected owners", () => {
  const raw = JSON.parse(JSON.stringify(checkpointWorld(ready())));
  ["frontier:-16:-3", "frontier:-19:-3"].forEach((tileId, owner) => {
    raw.grids[owner].territoryNetwork.tilePurchases = [
      {
        tileId,
        minute: 0,
        price: tilePrice(raw.grids[owner], 0, tileId as TerritoryTileId),
      },
    ];
    raw.grids[1 - owner].multiplayer.tileOwners = {
      [tileId]: { seat: String(owner), name: `Player ${owner}` },
    };
  });
  expect(() => restoreWorld(raw, "circular-anchor")).toThrow();
});
it("reveals a connected peer's acquired utility without granting its ownership or future acquisition anchors", () => {
  const world = ready();
  const target = getTerritoryTile("frontier:7:-4")!;
  expect(
    territoryVisibilityDistance(roomView(world, "1").game!, target),
  ).toBeUndefined();
  expect(target.city).toBeUndefined();
  startClock(world);
  stepWorld(world);
  const offer = acquisitionQuote(world.grids[0], "valley-electric")!;
  expect(
    applyCommand(world, "0", {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: (world.sequences["0"] ?? 0) + 1,
      command: {
        kind: "action",
        name: "acquireUtility",
        payload: {
          targetId: "valley-electric",
          financed: false,
          quoteKey: offer.quoteKey,
        },
      },
    }),
  ).toBeUndefined();
  const game = roomView(world, "1").game!;
  expect(game.utilityExpansion!.acquisitions).toHaveLength(0);
  expect(ownsTerritoryTile(game, "valley-electric:city")).toBe(false);
  expect(territoryVisibilityDistance(game, target)).toBe(3);
  const quote = tilePurchaseQuote(game, target.id)!;
  expect(buy(world, "1", quote.tileId, quote.quoteKey)).toBeUndefined();
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  expect(() => restoreWorld(raw, "acquisition-anchor")).not.toThrow();
  // A forged earlier purchase cannot use the peer's real, later acquisition as an anchor.
  raw.grids[1].territoryNetwork.tilePurchases[0].minute = 0;
  raw.grids[1].multiplayer.peers[0].territoryTileIds = ["valley-electric:city"];
  expect(() => restoreWorld(raw, "future-acquisition")).toThrow();
});
it.each(["missing", "paused", "building", "retired"])(
  "does not reveal disconnected peer land with a %s link",
  (condition) => {
    const world = ready();
    buyToward(world, "0", "frontier:-16:-3");
    const target = getTerritoryTile("frontier:-19:-3")!;
    if (condition === "missing")
      world.grids[1].transmission!.lines =
        world.grids[1].transmission!.lines.filter(
          (line) => !line.corridorId.startsWith("peer:"),
        );
    if (condition === "paused")
      world.grids[0].transmission!.lines.find((line) =>
        line.corridorId.startsWith("peer:"),
      )!.paused = true;
    if (condition === "building")
      world.grids[0].transmission!.lines.find((line) =>
        line.corridorId.startsWith("peer:"),
      )!.yearsToBuildLeft = 1;
    if (condition === "retired")
      world.outcomes["0"] = { outcome: "fired", title: "Retired", month: 0 };
    const game = roomView(world, "1").game!;
    expect(territoryVisibilityDistance(game, target)).toBeUndefined();
    expect(game.multiplayer!.tileOwners?.["frontier:-16:-3"]).toBeUndefined();
    expect(tilePurchaseQuote(game, target.id)).toBeUndefined();
    const cash = currentTick(world.grids[1])!.cash;
    expect(buy(world, "1", target.id, "forged")).toBeDefined();
    expect(currentTick(world.grids[1])!.cash).toBe(cash);
  },
);
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
