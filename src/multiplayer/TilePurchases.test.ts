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
function acquireTown(world: World, seat: string, quoteKey: string) {
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: {
      kind: "action",
      name: "acquireUtility",
      payload: { targetId: "parcel-1", financed: false, quoteKey },
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
it.each([
  [
    19,
    "coop-2-c85efcd401375172030f9ab31b7b1f81f0ecf4f450732f36d86e265355e91bef",
  ],
  [
    20,
    "coop-2-cf979e3b45deb328dd12a266f291e16398174095d47beca6df0d4f9da1dbd577",
  ],
  [
    21,
    "coop-2-fcb444f119733dd48aef5c28f13cb78fc856be210f448c495109eb5987d70476",
  ],
  [
    21,
    "coop-2-15c753596aead2c7b8214074ea6ee123deffa20b96db9d73b4abd0e420548a55",
  ],
  [
    21,
    "coop-2-8423406cc7fc00c2bcf0e3cd7b647ad746beabc840cbeb1fc847e15d0389d64c",
  ],
])(
  "resumes a published schema %i co-op world with its parcel-priced receipt (%s)",
  (gameSchema, rules) => {
    const world = ready();
    const game = world.grids[0];
    const tileId = "green-uplands:site-2";
    const price = tilePrice(game, 0, tileId);
    const receipt = { tileId, minute: 0, price } as const;
    game.territoryNetwork!.tilePurchases = [receipt];
    currentTick(game)!.cash -= price;
    const raw = {
      ...checkpointWorld(world),
      gameSchema,
      rules,
    };
    const resumed = restoreWorld(raw, "parcel-receipt");
    expect(resumed.grids[0].territoryNetwork!.tilePurchases).toEqual([receipt]);
    expect(currentTick(resumed.grids[0])!.cash).toBe(currentTick(game)!.cash);
    const quote = tilePurchaseQuote(
      roomView(resumed, "0").game!,
      "green-uplands:site-5",
    )!;
    expect(buy(resumed, "0", quote.tileId, quote.quoteKey)).toBeUndefined();
    const roundTrip = restoreWorld(
      checkpointWorld(resumed),
      "mixed-tile-prices",
    );
    expect(roundTrip.grids[0].territoryNetwork!.tilePurchases).toEqual([
      receipt,
      { ...quote.purchases[0], minute: game.date.minute },
    ]);
  },
);

it("accepts unchanged land quotes after a host clock tick and rejects real CPI repricing", () => {
  const world = ready();
  buyToward(world, "0", "green-uplands:site-4");
  const offer = tilePurchaseQuote(
    roomView(world, "0").game!,
    "green-uplands:site-0",
  )!;
  const city = acquisitionQuote(roomView(world, "0").game!, "parcel-1")!;
  startClock(world);
  stepWorld(world);
  expect(world.grids[0].date.minute).toBe(TICK_MINUTES);
  expect(
    tilePurchaseQuote(roomView(world, "0").game!, offer.tileId)!.price,
  ).toBe(offer.price);
  expect(buy(world, "0", offer.tileId, offer.quoteKey)).toBeUndefined();
  const grownCity = acquisitionQuote(
    roomView(world, "0").game!,
    city.targetId,
  )!;
  expect(grownCity.customers).toBeGreaterThan(city.customers);
  const customers = currentTick(world.grids[0])!.customers;
  expect(acquireTown(world, "0", city.quoteKey)).toMatch(/quote has changed/);
  expect(acquireTown(world, "0", grownCity.quoteKey)).toBeUndefined();
  expect(currentTick(world.grids[0])!.customers).toBe(
    customers + grownCity.customers,
  );
  const next = tilePurchaseQuote(
    roomView(world, "0").game!,
    "green-uplands:site-2",
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
  for (let count = 0; count < 40; count++) {
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
it("reveals connected peer land but requires each company's own physical path for new purchases and resume", () => {
  const world = ready();
  const peerTile = "frontier:-8:3";
  const target = getTerritoryTile("frontier:-8:6")!;
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
  expect(tilePurchaseQuote(view, target.id)).toBeUndefined();
  const before = JSON.stringify(world.grids);
  expect(
    buy(
      world,
      "1",
      target.id,
      JSON.stringify([
        target.id,
        tilePrice(view, view.date.minute, target.id),
        "general",
        0,
      ]),
    ),
  ).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(before);
  buyToward(world, "1", target.id);
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
  const independent = restoreWorld(unknown, "independent-physical-path");
  expect(ownsTerritoryTile(independent.grids[1], target)).toBe(true);
  expect(ownsTerritoryTile(independent.grids[0], peerTile)).toBe(false);
  const future = cloneDeep(raw);
  future.grids[0].territoryNetwork.tilePurchases[0].minute = 2 * TICK_MINUTES;
  expect(() => restoreWorld(future, "future-anchor")).toThrow();
  future.grids[0].territoryNetwork.tilePurchases.forEach(
    (receipt: { minute: number }) => {
      receipt.minute = 2 * TICK_MINUTES;
    },
  );
  future.grids[1].territoryNetwork.tilePurchases.forEach(
    (receipt: { minute: number }) => {
      receipt.minute = 2 * TICK_MINUTES;
    },
  );
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
it("rejects missing land ledgers before replaying co-op tile purchases", () => {
  const world = ready();
  buyToward(world, "0", "green-uplands:site-4");
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  expect(() => restoreWorld(raw, "valid-land-ledger")).not.toThrow();
  delete raw.grids[0].territoryNetwork.landPurchases;
  expect(() => restoreWorld(raw, "missing-land-ledger")).toThrow(
    "Multiplayer save contains invalid grids or connections",
  );
});
it("rejects invalid retained tile IDs before replaying co-op purchases", () => {
  const world = ready();
  buyToward(world, "0", "green-uplands:site-4");
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  expect(() => restoreWorld(raw, "valid-retained-tiles")).not.toThrow();
  for (const id of [undefined, 42]) {
    raw.grids[0].territoryNetwork.legacyTiles = [
      { id, territoryId: "champlain", q: 6, r: -4 },
    ];
    expect(() => restoreWorld(raw, "invalid-retained-tile")).toThrow(
      "Multiplayer save contains invalid grids or connections",
    );
  }
});
it("reveals a connected peer's acquired utility without granting its ownership or future acquisition anchors", () => {
  const world = ready();
  // This history also serves as a schema 17 fixture after the acquisition.
  for (const grid of world.grids)
    grid.utilityExpansion!.sellerFleet = "authored";
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
  expect(tilePurchaseQuote(game, target.id)).toBeUndefined();
  const before = JSON.stringify(world.grids);
  expect(
    buy(world, "1", target.id, "peer-sight-is-not-ownership"),
  ).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(before);
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  expect(() => restoreWorld(raw, "acquisition-anchor")).not.toThrow();
  // A forged new receipt cannot use the peer's acquired utility as physical property.
  raw.grids[1].territoryNetwork.tilePurchases.push({
    tileId: target.id,
    minute: TICK_MINUTES,
    price: tilePrice(game, TICK_MINUTES, target.id),
  });
  expect(() => restoreWorld(raw, "new-peer-only-claim")).toThrow();
  raw.gameSchema = 17;
  for (const grid of raw.grids) delete grid.utilityExpansion.sellerFleet;
  raw.rules =
    "coop-2-b590dfc2a358c3d4fd7c14330f8a5e92181b38944a04098dc416dcfbbf904907";
  const retained = restoreWorld(raw, "paid-schema17-peer-claim");
  expect(ownsTerritoryTile(retained.grids[1], target)).toBe(true);
  expect(currentTick(retained.grids[1])!.cash).toBe(
    currentTick(world.grids[1])!.cash,
  );
  raw.grids[1].territoryNetwork.tilePurchases[0].minute = 0;
  raw.grids[1].multiplayer.peers[0].territoryTileIds = ["valley-electric:city"];
  expect(() => restoreWorld(raw, "future-acquisition")).toThrow();
});
it.each(["missing", "paused", "building", "retired"])(
  "does not reveal disconnected peer land with a %s link",
  (condition) => {
    const world = ready();
    buyToward(world, "0", "frontier:-8:3");
    const target = getTerritoryTile("frontier:-8:6")!;
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
    expect(game.multiplayer!.tileOwners?.["frontier:-8:3"]).toBeUndefined();
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
  buyToward(world, "0", "green-uplands:site-4");
  const game = world.grids[0];
  const quote = acquisitionQuote(game, "parcel-1")!;
  const before = JSON.stringify(world.grids);
  expect(acquireTown(world, "0", "stale")).toMatch(/quote has changed/);
  expect(JSON.stringify(world.grids)).toBe(before);
  currentTick(game)!.cash = quote.cashDue - 1;
  const low = JSON.stringify(world.grids);
  expect(acquireTown(world, "0", quote.quoteKey)).toMatch(/not enough cash/i);
  expect(JSON.stringify(world.grids)).toBe(low);
  currentTick(game)!.cash = quote.cashDue;
  const customers = currentTick(game)!.customers;
  expect(acquireTown(world, "0", quote.quoteKey)).toBeUndefined();
  expect(currentTick(world.grids[0])!.cash).toBe(0);
  expect(currentTick(world.grids[0])!.customers).toBe(
    customers + quote.customers,
  );
  const after = JSON.stringify(world.grids);
  expect(acquireTown(world, "1", quote.quoteKey)).toMatch(/quote has changed/);
  expect(JSON.stringify(world.grids)).toBe(after);
  expect(acquireTown(world, "0", quote.quoteKey)).toBeDefined();
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
    (grid: {
      territoryNetwork: { tilePurchases?: unknown; legacyTiles?: unknown };
    }) => {
      delete grid.territoryNetwork.tilePurchases;
      delete grid.territoryNetwork.legacyTiles;
    },
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
