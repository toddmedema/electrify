import {
  createWorld,
  applyCommand,
  roomView,
  checkpointWorld,
  restoreWorld,
} from "./World";
import {
  getTerritoryTile,
  territoryVisibilityDistance,
} from "../helpers/TerritoryTiles";
import { landPurchaseQuote, tilePurchaseQuote } from "../helpers/Territories";
import { currentTick } from "../helpers/GameSelectors";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { powerAgreementQuote } from "../helpers/PowerAgreements";
import { territoryTileViews } from "../helpers/TerritoryMapState";
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
  const quote = landPurchaseQuote(world.grids[0])!;
  expect(
    command(world, "0", {
      kind: "action",
      name: "acquireLand",
      payload: { territoryId: quote.territoryId, quoteKey: quote.quoteKey },
    }),
  ).toBeUndefined();
  const tile = getTerritoryTile(quote.tileId)!;
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

it("projects and reserves retained peer property, including after retirement of its plant", () => {
  loadSimData(UTILITY_AREAS.champlain.location);
  const initial = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "retained-view",
    "epoch",
  );
  const raw = JSON.parse(JSON.stringify(checkpointWorld(initial)));
  raw.gameSchema = 16;
  raw.rules =
    "coop-2-06e4afd05778c47de20788acd02787291d3f09456465a0a89ace5fbeadd2d018";
  for (const grid of raw.grids) {
    delete grid.territoryNetwork.tilePurchases;
    delete grid.territoryNetwork.legacyTiles;
  }
  const oil = raw.grids[0].facilities.find(
    (plant: { fuel: string }) => plant.fuel === "Oil",
  );
  raw.grids[0].facilities.push({
    ...oil,
    id: 100,
    startingAssetId: undefined,
    tileId: "champlain:legacy-100",
  });
  const duplicateRights = JSON.parse(JSON.stringify(raw));
  duplicateRights.grids[1].facilities.push({
    ...oil,
    id: 100,
    startingAssetId: undefined,
    tileId: "champlain:legacy-100",
  });
  const grandfathered = restoreWorld(duplicateRights, "grandfathered");
  for (const seat of ["0", "1"])
    expect(
      territoryTileViews(roomView(grandfathered, seat).game!).find(
        ({ tile }) => tile.id === "champlain:legacy-100",
      ),
    ).toMatchObject({
      ownerKey: "you",
      owned: true,
      facility: { name: oil.name },
    });
  const world = restoreWorld(raw, "retained");
  currentTick(world.grids[1])!.cash = 3e9;
  const tile = getTerritoryTile("champlain:legacy-100", world.grids[0])!;
  const view = roomView(world, "1").game!;
  expect(territoryVisibilityDistance(view, tile)).toBe(0);
  expect(
    territoryTileViews(view).find(({ tile: entry }) => entry.id === tile.id),
  ).toMatchObject({
    ownerKey: "peer:0",
    ownerName: world.seats[0].name,
    owned: false,
    facility: { name: oil.name },
  });
  expect(
    command(world, "1", {
      kind: "action",
      name: "acceptPowerAgreement",
      payload: {
        blockId: "valley-purchase",
        quoteKey: powerAgreementQuote(world.grids[1], "valley-purchase")!
          .quoteKey,
      },
    }),
  ).toBeUndefined();
  expect(
    tilePurchaseQuote(roomView(world, "1").game!, "frontier:6:-4"),
  ).toBeUndefined();
  expect(
    command(world, "1", {
      kind: "action",
      name: "acquireTile",
      payload: {
        tileId: "frontier:6:-4",
        quoteKey: JSON.stringify(["frontier:6:-4", 3e6, "general", 0]),
      },
    }),
  ).toMatch(/owned|unavailable/i);
  const forged = JSON.parse(JSON.stringify(checkpointWorld(world)));
  forged.grids[1].territoryNetwork.tilePurchases.push({
    tileId: "frontier:6:-4",
    minute: 0,
    price: 3e6,
  });
  expect(() => restoreWorld(forged, "overlap")).toThrow();
  expect(
    command(world, "0", { kind: "action", name: "sellFacility", payload: 100 }),
  ).toBeUndefined();
  const resumed = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "resumed",
  );
  expect(
    territoryTileViews(roomView(resumed, "1").game!).find(
      ({ tile: entry }) => entry.id === tile.id,
    ),
  ).toMatchObject({ ownerKey: "peer:0", owned: false, facility: undefined });
  resumed.outcomes["0"] = { outcome: "fired", title: "Retired", month: 0 };
  const retiredView = roomView(resumed, "1").game!;
  // The utility PPA still reveals the property, but the retired peer no longer anchors sight.
  expect(territoryVisibilityDistance(retiredView, tile)).toBe(2);
  expect(tilePurchaseQuote(retiredView, "frontier:6:-4")).toBeUndefined();
  expect(
    territoryTileViews(retiredView).find(
      ({ tile: entry }) => entry.id === tile.id,
    ),
  ).toMatchObject({ ownerKey: "peer:0", owned: false });
});

it("withholds unknown retired-peer footprints while retaining host reservations and later discovery", () => {
  loadSimData(UTILITY_AREAS.champlain.location);
  const initial = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "hidden-retained-view",
    "epoch",
  );
  const raw = JSON.parse(JSON.stringify(checkpointWorld(initial)));
  raw.gameSchema = 16;
  raw.rules =
    "coop-2-06e4afd05778c47de20788acd02787291d3f09456465a0a89ace5fbeadd2d018";
  for (const grid of raw.grids) {
    delete grid.territoryNetwork.tilePurchases;
    delete grid.territoryNetwork.legacyTiles;
  }
  const oil = raw.grids[0].facilities.find(
    (plant: { fuel: string }) => plant.fuel === "Oil",
  );
  for (const id of [100, 101])
    raw.grids[0].facilities.push({
      ...oil,
      id,
      startingAssetId: undefined,
      tileId: `champlain:legacy-${id}`,
    });
  const world = restoreWorld(raw, "retained");
  const tile = getTerritoryTile("champlain:legacy-101", world.grids[0])!;
  expect(tile).toMatchObject({ q: 7, r: -4, maxPeakW: 40e6 });
  const connectedView = roomView(world, "1").game!;
  expect(territoryVisibilityDistance(connectedView, tile)).toBe(0);
  expect(connectedView.multiplayer!.legacyTiles).toContainEqual({
    tile,
    seat: "0",
    name: world.seats[0].name,
    facility: { name: "Oil", fuel: "Oil", peakW: 40e6, yearsToBuildLeft: 0 },
  });
  expect(
    command(world, "0", { kind: "action", name: "sellFacility", payload: 100 }),
  ).toBeUndefined();
  expect(getTerritoryTile(tile.id, world.grids[0])).toEqual(tile);
  world.outcomes["0"] = { outcome: "fired", title: "Retired", month: 0 };
  const before = JSON.stringify(checkpointWorld(world));
  const hiddenView = roomView(world, "1").game!;
  expect(territoryVisibilityDistance(hiddenView, tile)).toBeUndefined();
  expect(hiddenView.multiplayer!.legacyTiles).toEqual([]);
  expect(hiddenView.multiplayer!.tileOwners?.[tile.id]).toBeUndefined();
  expect(hiddenView.multiplayer!.tileFacilities?.[tile.id]).toBeUndefined();
  expect(JSON.stringify(checkpointWorld(world))).toBe(before);

  // A later utility contract reveals the retained cell without reviving peer sight.
  currentTick(world.grids[1])!.cash = 3e9;
  expect(
    command(world, "1", {
      kind: "action",
      name: "acceptPowerAgreement",
      payload: {
        blockId: "valley-purchase",
        quoteKey: powerAgreementQuote(world.grids[1], "valley-purchase")!
          .quoteKey,
      },
    }),
  ).toBeUndefined();
  const discoveredView = roomView(world, "1").game!;
  expect(territoryVisibilityDistance(discoveredView, tile)).toBe(3);
  expect(discoveredView.multiplayer!.legacyTiles).toContainEqual({
    tile,
    seat: "0",
    name: world.seats[0].name,
    facility: { name: "Oil", fuel: "Oil", peakW: 40e6, yearsToBuildLeft: 0 },
  });
  expect(tilePurchaseQuote(discoveredView, "frontier:7:-4")).toBeUndefined();
  const cash = currentTick(world.grids[1])!.cash;
  expect(
    command(world, "1", {
      kind: "action",
      name: "acquireTile",
      payload: {
        tileId: "frontier:7:-4",
        quoteKey: JSON.stringify(["frontier:7:-4", 3e6, "general", 0]),
      },
    }),
  ).toMatch(/owned|unavailable/i);
  expect(currentTick(world.grids[1])!.cash).toBe(cash);
  const forged = JSON.parse(JSON.stringify(checkpointWorld(world)));
  forged.grids[1].territoryNetwork.tilePurchases.push({
    tileId: "frontier:7:-4",
    minute: 0,
    price: 3e6,
  });
  expect(() => restoreWorld(forged, "overlap")).toThrow();
});
