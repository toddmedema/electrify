import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import { LAND_TERRITORIES } from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import {
  landPurchaseQuote,
  ownedTerritories,
  landPrice,
  tilePurchaseQuotes,
} from "../helpers/Territories";
import {
  getTerritoryTiles,
  getTerritoryTile,
  territoryHexDistance,
} from "../helpers/TerritoryTiles";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
  savedMatchSpec,
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
  const index = world.seats.findIndex((s) => s.id === seat);
  const target = getTerritoryTiles().find((tile) => tile.territoryId === id)!;
  for (
    let step = 0;
    !landPurchaseQuote(world.grids[index], id) && step < 40;
    step++
  ) {
    const view = roomView(world, seat).game!;
    const nearest = [...tilePurchaseQuotes(view).values()]
      .filter((quote) => {
        const tile = getTerritoryTile(quote.tileId, view)!;
        return quote.territoryId !== id && !tile.city;
      })
      .sort(
        (a, b) =>
          territoryHexDistance(getTerritoryTile(a.tileId)!, target) -
          territoryHexDistance(getTerritoryTile(b.tileId)!, target),
      )[0];
    expect(nearest).toBeDefined();
    expect(
      applyCommand(world, seat, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: (world.sequences[seat] ?? 0) + 1,
        command: {
          kind: "action",
          name: "acquireTile",
          payload: { tileId: nearest.tileId, quoteKey: nearest.quoteKey },
        },
      }),
    ).toBeUndefined();
  }
  const quote = landPurchaseQuote(world.grids[index], id)!;
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
const PUBLISHED_SCHEMA_20_RULES =
  "coop-2-cf979e3b45deb328dd12a266f291e16398174095d47beca6df0d4f9da1dbd577";

it.each([undefined, 20])(
  "retains independent parcel claims and cash through schema%s save/resume",
  (schema) => {
    const world = ready();
    expect(buy(world, "0", "parcel-0")).toBeUndefined();
    expect(buy(world, "1", "parcel-0")).toMatch(/owned/i);
    const losingCash = currentTick(world.grids[1])!.cash;
    expect(buy(world, "1", "parcel-0")).toMatch(/owned/i);
    expect(currentTick(world.grids[1])!.cash).toBe(losingCash);
    expect(buy(world, "1", "parcel-2")).toBeUndefined();
    expect(buy(world, "0", "parcel-1")).toBeUndefined();
    expect(roomView(world, "1").game!.multiplayer!.tileOwners).toMatchObject({
      "parcel-0:site-0": { seat: "0" },
      "parcel-1:city": { seat: "0" },
      "parcel-2:site-0": { seat: "1" },
    });
    const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
    if (schema === 20) {
      raw.gameSchema = schema;
      raw.rules = PUBLISHED_SCHEMA_20_RULES;
    }
    expect(savedMatchSpec(raw)).toEqual(world.spec);
    const restored = restoreWorld(raw, "restored");
    expect(restored.gameSchema).toBe(SAVE_SCHEMA_VERSION);
    expect(restored.grids.map((grid) => currentTick(grid)!.cash)).toEqual(
      world.grids.map((grid) => currentTick(grid)!.cash),
    );
    const roundTrip = restoreWorld(
      JSON.parse(JSON.stringify(checkpointWorld(restored))),
      "roundtrip",
    );
    expect(checkpointWorld(roundTrip).grids).toEqual(
      checkpointWorld(restored).grids,
    );
    expect(ownedTerritories(restored.grids[0])).toEqual(
      expect.arrayContaining(["parcel-0", "parcel-1"]),
    );
    expect(ownedTerritories(restored.grids[1])).toContain("parcel-2");
    expect(buy(restored, "1", "parcel-1")).toMatch(/owned/i);
  },
);

it("rejects unknown schema20 identities and corrupted published schema20 grids", () => {
  const world = ready();
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  raw.gameSchema = 20;
  raw.rules = `${PUBLISHED_SCHEMA_20_RULES}-unknown`;
  expect(() => savedMatchSpec(raw)).toThrow();
  expect(() => restoreWorld(raw, "unknown")).toThrow();
  raw.rules = PUBLISHED_SCHEMA_20_RULES;
  raw.grids[0].customerRate = -1;
  expect(() => restoreWorld(raw, "corrupt")).toThrow();
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
