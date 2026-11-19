import cloneDeep from "lodash.clonedeep";
import { VALLEY_BOARD, isValleyBoardTile } from "../data/TerritoryTiles";
import { municipalPlantAt } from "../data/MunicipalUtilities";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { territoryTileViews } from "./TerritoryMapState";
import { purchaseTile, tilePrice, tilePurchaseQuote } from "./Territories";
import {
  getTerritoryTile,
  isAdjacentToOwnedTerritoryTile,
  scenarioMapTiles,
  territoryHexDistance,
} from "./TerritoryTiles";
import { parseSave, serializeSave } from "../SaveGame";
import reducer from "../reducers/Game";
import { acquisitionQuote } from "./Expansion";
import { gameObjectiveResults } from "./ObjectiveRules";
import { acquireUtility } from "../reducers/GameActions";
import { validTerritoryNetwork } from "./TerritoryValidation";
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

it("serves each city with a utility and sells both sites from the plant border", () => {
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
  const plant = getTerritoryTile("parcel-0:site-1")!;
  const city = getTerritoryTile("parcel-1:city")!;
  expect(tilePurchaseQuote(game, plant.id)).toBeUndefined();
  connect("green-uplands:site-2");
  connect("green-uplands:site-5");
  expect(isAdjacentToOwnedTerritoryTile(game, city)).toBe(false);
  expect(isAdjacentToOwnedTerritoryTile(game, plant)).toBe(true);
  expect(tilePurchaseQuote(game, plant.id)).toBeUndefined();
  expect(tilePurchaseQuote(game, city.id)).toBeUndefined();
  const quote = acquisitionQuote(game, "parcel-1")!;
  if (quote.kind !== "municipal")
    throw new Error("Expected the Vergennes offer");
  expect(quote.territory.purchases.map(({ tileId }) => tileId)).toEqual([
    plant.id,
    city.id,
  ]);
  const payload = {
    targetId: quote.targetId,
    financed: false,
    quoteKey: quote.quoteKey,
  };
  const cash = currentTick(game)!.cash;
  const customers = currentTick(game)!.customers;
  const short = cloneDeep(game);
  currentTick(short)!.cash = quote.cashDue - 1;
  expect(reducer(short, acquireUtility(payload))).toBe(short);
  expect(reducer(game, acquireUtility({ ...payload, financed: true }))).toBe(
    game,
  );
  expect(reducer(game, acquireUtility({ ...payload, quoteKey: "stale" }))).toBe(
    game,
  );
  const purchased = reducer(game, acquireUtility(payload));
  expect(reducer(purchased, acquireUtility(payload))).toBe(purchased);
  expect(currentTick(purchased)!.cash).toBeCloseTo(cash - quote.cashDue);
  expect(currentTick(purchased)!.customers).toBe(customers + quote.customers);
  expect(
    gameObjectiveResults(purchased).find(({ id }) => id === "acquire-neighbor"),
  ).toMatchObject({
    observed: 1,
    target: 3,
    status: "inProgress",
  });
  for (const id of [plant.id, city.id]) {
    expect(
      territoryTileViews(purchased).find(({ tile }) => tile.id === id),
    ).toMatchObject({
      owned: true,
      facility: undefined,
    });
  }
  expect(validTerritoryNetwork(purchased)).toBe(true);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(purchased)))),
  ).not.toBeNull();

  const saved = JSON.parse(JSON.stringify(serializeSave(purchased)));
  saved.schemaVersion = 19;
  saved.game.objectiveProgress = {
    rulesDigest: "legacy-retirement-objectives",
  };
  const restored = parseSave(saved)!.game;
  expect(restored.objectiveProgress!.entries.map(({ id }) => id)).toEqual([
    "acquire-neighbor",
    "retain-customers",
  ]);
  expect(gameObjectiveResults(restored)).toEqual(
    gameObjectiveResults(purchased),
  );
  expect(restored.territoryNetwork).toEqual(purchased.territoryNetwork);
  let expanded = restored;
  for (const targetId of ["parcel-11", "ridge-electric"] as const) {
    const offer = acquisitionQuote(expanded, targetId)!;
    expanded = reducer(
      expanded,
      acquireUtility({ targetId, financed: false, quoteKey: offer.quoteKey }),
    );
  }
  const goal = gameObjectiveResults(expanded).find(
    ({ id }) => id === "acquire-neighbor",
  );
  expect(goal).toMatchObject({ status: "completed", observed: 3, target: 3 });
  expect(goal).not.toHaveProperty("reason");
});
