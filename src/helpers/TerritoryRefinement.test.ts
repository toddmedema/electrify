import cloneDeep from "lodash.clonedeep";
import { TRANSMISSION_CORRIDORS } from "../data/AdjacentMarkets";
import { GENERATORS, getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import * as tileData from "../data/TerritoryTiles";
import reducer, { buildFacility, tickState } from "../reducers/Game";
import { parseSave, serializeSave } from "../SaveGame";
import { acquireTile } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { acceptAgreement, powerAgreementQuote } from "./PowerAgreements";
import {
  tilePurchaseQuote,
  tilePurchaseQuotes,
  territoryBuildAvailability,
  tilePrice,
} from "./Territories";
import {
  getTerritoryTile,
  isAdjacentToOwnedTerritoryTile,
  tileFitsFacility,
  territoryVisibilityDistance,
  tileSupportsFacilityTechnology,
} from "./TerritoryTiles";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 3e9;
  return game;
}

it("quotes only neutral cells touching physical owned land, while sight extends three rings", () => {
  const game = ready();
  const distant = getTerritoryTile("frontier:-7:-3")!;
  expect(territoryVisibilityDistance(game, distant)).toBe(3);
  expect(tilePurchaseQuote(game, distant.id)).toBeUndefined();
  expect(tilePurchaseQuotes(game).has(distant.id)).toBe(false);
  const before = JSON.stringify(game);
  const forgedQuote = JSON.stringify([distant.id, 3e6, "general", 0]);
  expect(
    JSON.stringify(
      reducer(game, acquireTile({ tileId: distant.id, quoteKey: forgedQuote })),
    ),
  ).toBe(before);
  const adjacent = tilePurchaseQuote(game, "frontier:-5:-3")!;
  expect(adjacent).toBeDefined();
  const expanded = cloneDeep(
    reducer(
      game,
      acquireTile({ tileId: adjacent.tileId, quoteKey: adjacent.quoteKey }),
    ),
  );
  expect(tilePurchaseQuote(expanded, "frontier:-6:-3")).toBeDefined();
});

it("does not turn a PPA visibility anchor into physical purchase adjacency", () => {
  const game = ready();
  const offer = powerAgreementQuote(game, "valley-purchase", 3)!;
  expect(
    acceptAgreement(game, { blockId: offer.id, quoteKey: offer.quoteKey }),
  ).toBe(true);
  const remote = getTerritoryTile("frontier:5:-4")!;
  expect(territoryVisibilityDistance(game, remote)).toBe(1);
  expect(tilePurchaseQuote(game, remote.id)).toBeUndefined();
  expect(tilePurchaseQuotes(game).has(remote.id)).toBe(false);
});

it("uses all six physical neighbors of empty retained property, with fresh lookups after ownership changes", () => {
  const game = ready();
  game.territoryNetwork!.legacyTiles!.push({
    id: "champlain:legacy-100",
    territoryId: "champlain",
    q: 100,
    r: -100,
    terrain: "plains",
    siteKind: "industrial",
    maxPeakW: 40e6,
  });
  const quotes = tilePurchaseQuotes(game);
  for (const [q, r] of [
    [101, -100],
    [99, -100],
    [100, -99],
    [100, -101],
    [101, -101],
    [99, -99],
  ]) {
    const tile = getTerritoryTile(`frontier:${q}:${r}`, game)!;
    expect(isAdjacentToOwnedTerritoryTile(game, tile)).toBe(true);
    expect(quotes.get(tile.id)).toBeDefined();
    expect(tilePurchaseQuote(game, tile.id)).toEqual(quotes.get(tile.id));
  }
  for (const [q, r] of [
    [101, -99],
    [99, -101],
    [102, -100],
    [100, -98],
  ]) {
    const tile = getTerritoryTile(`frontier:${q}:${r}`, game)!;
    expect(territoryVisibilityDistance(game, tile)).toBe(2);
    expect(isAdjacentToOwnedTerritoryTile(game, tile)).toBe(false);
    expect(tilePurchaseQuote(game, tile.id)).toBeUndefined();
    expect(quotes.has(tile.id)).toBe(false);
  }
  expect(quotes.has("champlain:legacy-100")).toBe(false);
  expect(getTerritoryTile("frontier:100:-100", game)).toBeUndefined();
  game.territoryNetwork!.legacyTiles = [];
  expect(tilePurchaseQuote(game, "frontier:101:-100")).toBeUndefined();
  expect(tilePurchaseQuotes(game).has("frontier:101:-100")).toBe(false);
});

it("keeps connected peer sight and overlapping legacy IDs separate from owned coordinates and exclusive claims", () => {
  const game = ready();
  const retained = {
    id: "champlain:legacy-100" as const,
    territoryId: "champlain" as const,
    q: 100,
    r: -100,
    terrain: "plains" as const,
    siteKind: "industrial" as const,
    maxPeakW: 40e6,
  };
  game.territoryNetwork!.legacyTiles!.push(retained);
  const corridor = TRANSMISSION_CORRIDORS[0];
  game.transmission!.lines.push({
    ...game.transmission!.lines[0],
    id: 999,
    corridorId: corridor.id,
    paused: false,
    yearsToBuildLeft: 0,
    capacityW: 1e6,
    minuteCreated: 0,
  });
  game.multiplayer = {
    seat: "local",
    peers: [
      {
        id: "peer",
        name: "Neighbor",
        locationId: "SF",
        corridor,
        connected: true,
        territoryTileIds: ["frontier:1000:-1000"],
      },
    ],
    legacyTiles: [
      {
        tile: { ...retained, q: 200, r: -200 },
        seat: "peer",
        name: "Neighbor",
      },
    ],
  };
  const quotes = tilePurchaseQuotes(game);
  for (const id of ["frontier:201:-200", "frontier:1001:-1000"] as const) {
    const tile = getTerritoryTile(id, game)!;
    expect(territoryVisibilityDistance(game, tile)).toBe(1);
    expect(isAdjacentToOwnedTerritoryTile(game, tile)).toBe(false);
    expect(tilePurchaseQuote(game, tile.id)).toBeUndefined();
    expect(quotes.has(tile.id)).toBe(false);
  }
  const adjacent = getTerritoryTile("frontier:101:-100", game)!;
  expect(quotes.get(adjacent.id)).toBeDefined();
  const owner = { seat: "peer", name: "Neighbor" };
  game.multiplayer.tileOwners = { [adjacent.id]: owner };
  expect(tilePurchaseQuote(game, adjacent.id)).toBeUndefined();
  expect(tilePurchaseQuotes(game).has(adjacent.id)).toBe(false);
  game.multiplayer.tileOwners = {};
  game.multiplayer.landOwners = { [adjacent.territoryId]: owner };
  expect(tilePurchaseQuote(game, adjacent.id)).toBeUndefined();
  expect(tilePurchaseQuotes(game).has(adjacent.id)).toBe(false);
});

it("bounds owned coordinate reads while quoting a long purchased frontier", () => {
  const game = ready();
  const count = 500;
  game.territoryNetwork!.tilePurchases = Array.from(
    { length: count },
    (_, index) => ({
      tileId: `frontier:${-5 - index}:-3`,
      minute: 0,
      price: 3e6,
    }),
  );
  const budget = count * 100;
  let reads = 0;
  const read = (value: number) => {
    if (++reads > budget)
      throw new Error(
        "Purchase quotes exceeded the owned-coordinate read budget",
      );
    return value;
  };
  const generate = tileData.getGeneratedTerritoryTile;
  const spy = jest
    .spyOn(tileData, "getGeneratedTerritoryTile")
    .mockImplementation((id) => {
      const tile = generate(id);
      return tile
        ? {
            ...tile,
            get q() {
              return read(tile.q);
            },
            get r() {
              return read(tile.r);
            },
          }
        : undefined;
    });
  try {
    const quotes = tilePurchaseQuotes(game);
    expect(quotes.has("frontier:-505:-3")).toBe(true);
    expect(quotes.has("frontier:-506:-3")).toBe(false);
    expect(quotes.size).toBeGreaterThan(count);
    expect(reads).toBeGreaterThan(count);
    expect(reads).toBeLessThanOrEqual(budget);
  } finally {
    spy.mockRestore();
  }
});

it("leaves general sites uncapped while named sites keep their physical power limit", () => {
  const game = ready();
  const tile = getTerritoryTile("green-uplands:site-0")!;
  game.territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: 18e6,
  });
  const wind = GENERATORS(
    game,
    500e6,
    [20],
    [500],
    [],
    [],
    "green-uplands",
    tile.id,
  ).find(({ name }) => name === "Wind")!;
  expect(tileFitsFacility(tile, wind)).toBe(true);
  expect(
    territoryBuildAvailability(game, wind, "green-uplands", tile.id),
  ).toMatchObject({ buildable: true, maxPeakW: Infinity });
  const named = TERRITORY_TILES.find((entry) => entry.siteKind === "hydro")!;
  expect(tileFitsFacility(named, wind)).toBe(false);
  expect(tileSupportsFacilityTechnology(named, wind)).toBe(false);
  expect(
    tileFitsFacility(named, { fuel: "Hydro", peakW: named.maxPeakW! }),
  ).toBe(true);
  expect(
    tileFitsFacility(named, { fuel: "Hydro", peakW: named.maxPeakW! + 1 }),
  ).toBe(false);
  expect(
    getBuildFacilityQuote(game, wind, "green-uplands", tile.id),
  ).toBeDefined();
  expect(
    getBuildFacilityQuote(
      game,
      { ...wind, peakW: wind.maxPeakW + 1 },
      "green-uplands",
      tile.id,
    ),
  ).toBeUndefined();
  const built = reducer(
    game,
    buildFacility({
      facility: wind,
      financed: true,
      territoryId: "green-uplands",
      tileId: tile.id,
    }),
  );
  expect(built.facilities.find(({ tileId }) => tileId === tile.id)?.peakW).toBe(
    500e6,
  );
  const future = { ...game, date: { ...game.date, year: 2025 } };
  const battery = STORAGE(future, 2e9).find(({ name }) => name === "Battery")!;
  expect(tileFitsFacility(tile, battery)).toBe(true);
  expect(
    getBuildFacilityQuote(
      future,
      { ...battery, peakWh: battery.maxPeakWh + 1 },
      "green-uplands",
      tile.id,
    ),
  ).toBeUndefined();
});

it("retains paid disconnected schema17 property and finances while rejecting a new disconnected receipt", () => {
  const game = ready();
  const tileId = "frontier:-7:-3";
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.game.territoryNetwork.tilePurchases.push({
    tileId,
    minute: 0,
    price: tilePrice(game, 0, tileId),
  });
  expect(parseSave(cloneDeep(raw))).toBeNull();
  raw.schemaVersion = 17;
  const unchanged = JSON.stringify(raw);
  const migrated = parseSave(raw)!.game;
  expect(JSON.stringify(raw)).toBe(unchanged);
  expect(migrated.territoryNetwork!.tilePurchases).toEqual([
    { ...raw.game.territoryNetwork.tilePurchases[0], legacy: true },
  ]);
  expect(migrated.timeline).toEqual(raw.game.timeline);
  expect(migrated.facilities).toEqual(raw.game.facilities);
  expect(tilePurchaseQuote(migrated, "frontier:-8:-3")).toBeDefined();
  const resumed = parseSave(
    JSON.parse(JSON.stringify(serializeSave(migrated))),
  )!.game;
  expect(resumed).toEqual(migrated);
  tickState(migrated);
  tickState(resumed);
  expect(resumed).toEqual(migrated);
  const forged = cloneDeep(raw);
  forged.game.territoryNetwork.tilePurchases[0].tileId = "frontier:-50:-3";
  forged.game.territoryNetwork.tilePurchases[0].price = tilePrice(
    game,
    0,
    "frontier:-50:-3",
  );
  expect(parseSave(forged)).toBeNull();
});

it("classifies the inland authored water cell as a lake and rejects new offshore construction there", () => {
  const lake = getTerritoryTile("champlain:site-14")!;
  expect(lake.terrain).toBe("lake");
  expect(tileFitsFacility(lake, { fuel: "Offshore Wind", peakW: 20e6 })).toBe(
    false,
  );
});
