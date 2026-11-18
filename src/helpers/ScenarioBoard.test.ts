import { VALLEY_BOARD, isValleyBoardTile } from "../data/TerritoryTiles";
import { municipalPlantAt } from "../data/MunicipalUtilities";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { territoryTileViews } from "./TerritoryMapState";
import { purchaseTile, tilePrice, tilePurchaseQuote } from "./Territories";
import { scenarioMapTiles, territoryHexDistance } from "./TerritoryTiles";
import type { TerritoryTileId } from "../Types";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 7 });
  currentTick(game)!.cash = 1e9;
  return game;
}

it("maps the entire board from the first tick and fades distant terrain", () => {
  const game = ready();
  const opening = scenarioMapTiles(game);
  expect(new Set(opening.map(({ tile }) => tile.id))).toEqual(
    new Set(VALLEY_BOARD.map(({ id }) => id)),
  );
  expect(opening).toHaveLength(VALLEY_BOARD.length);
  const edge = opening.find(({ tile }) => tile.id === "frontier:8:1");
  expect(edge?.visibilityDistance).toBe(3);
  expect(tilePurchaseQuote(game, edge!.tile.id)).toBeUndefined();
  const adjacent = tilePurchaseQuote(game, "green-uplands:site-1")!;
  expect(
    purchaseTile(game, {
      tileId: adjacent.tileId,
      quoteKey: adjacent.quoteKey,
    }),
  ).toBe(true);
  const grown = scenarioMapTiles(game);
  expect(grown.map(({ tile }) => tile.id)).toEqual(
    opening.map(({ tile }) => tile.id),
  );
  expect(
    grown.find(({ tile }) => tile.id === adjacent.tileId)?.visibilityDistance,
  ).toBe(0);
});

it("keeps older off-board property visible and caps new connections at the scenario boundary", () => {
  const game = ready();
  const retained = "frontier:-9:0";
  expect(isValleyBoardTile(retained)).toBe(false);
  game.territoryNetwork!.tilePurchases = [
    { tileId: retained, minute: 0, price: tilePrice(game, 0, retained) },
  ];
  expect(
    scenarioMapTiles(game).find(({ tile }) => tile.id === retained),
  ).toMatchObject({
    visibilityDistance: 0,
  });
  expect(tilePurchaseQuote(game, "frontier:-10:0")).toBeUndefined();
  expect(tilePurchaseQuote(game, "frontier:-8:0")).toBeDefined();
});

it("serves each city with a utility and protects the incumbent plant until its customers transfer", () => {
  const game = ready();
  const views = territoryTileViews(game);
  const cities = views.filter(({ tile }) => tile.city);
  expect(cities).toHaveLength(7);
  for (const city of cities) expect(city.ownerKey).toBeDefined();
  for (const [id, utility] of municipalPlantAt) {
    const city = views.find(({ tile }) => tile.id === utility.city.id)!;
    const plant = views.find(({ tile }) => tile.id === id)!;
    expect(plant.ownerKey).toBe(city.ownerKey);
    expect(plant.ownerName).toMatch(new RegExp(`^${city.tile.city!.name} `));
    expect(plant.facility?.peakW).toBeGreaterThan(0);
    expect(territoryHexDistance(city.tile, plant.tile)).toBe(1);
  }

  const connect = (id: TerritoryTileId) => {
    const quote = tilePurchaseQuote(game, id)!;
    expect(quote?.tileId).toBe(id);
    expect(
      purchaseTile(game, { tileId: quote.tileId, quoteKey: quote.quoteKey }),
    ).toBe(true);
  };
  connect("green-uplands:site-1");
  connect("green-uplands:site-4");
  expect(tilePurchaseQuote(game, "parcel-0:site-1")).toBeUndefined();
  connect("parcel-1:city");
  connect("parcel-0:site-1");
  expect(
    territoryTileViews(game).find(({ tile }) => tile.id === "parcel-0:site-1"),
  ).toMatchObject({
    owned: true,
    facility: undefined,
  });
});
