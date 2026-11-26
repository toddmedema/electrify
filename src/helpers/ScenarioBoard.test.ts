import cloneDeep from "lodash.clonedeep";
import { tileConnectionDuration } from "./TerritoryConnections";
import { MINUTES_PER_MONTH } from "./DateTime";
import { ordinaryTileConnectionPrice } from "./Territories";
import { runMonths } from "../testing/SimulationTestHelpers";
import { VALLEY_BOARD, isValleyBoardTile } from "../data/TerritoryTiles";
import { municipalPlantAt } from "../data/MunicipalUtilities";
import { createGame } from "../testing/Simulator";
import { retiredValleyOpeningProgress } from "../testing/SaveTestHelpers";
import { getMonthlyPayment, maxLoanAmount } from "./Financials";
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
import reducer, { applyAcquireUtility } from "../reducers/Game";
import { acquisitionQuote, utilityAcquisitions } from "./Expansion";
import { gameObjectiveResults } from "./ObjectiveRules";
import { acquireTile, acquireUtility } from "../reducers/GameActions";
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

it("prices ordinary building tiles by terrain and the nearest owned city", () => {
  let game = ready();
  const price = (id: TerritoryTileId) => tilePurchaseQuote(game, id)!.price;
  const connect = (id: TerritoryTileId) => {
    const quote = tilePurchaseQuote(game, id)!;
    const next = reducer(
      game,
      acquireTile({ tileId: id, quoteKey: quote.quoteKey }),
    );
    expect(next).not.toBe(game);
    game = next;
  };

  // Both sites start three hexes from Burlington, one in forest and one on plains.
  expect(price("green-uplands:site-1")).toBeCloseTo(6.45e6);
  expect(price("green-uplands:site-2")).toBeCloseTo(4.2e6);
  connect("green-uplands:site-2");
  expect(price("green-uplands:site-5")).toBeCloseTo(7.8e6);
  connect("green-uplands:site-5");

  const remaining = "green-uplands:site-4";
  const before = tilePurchaseQuote(game, remaining)!;
  expect(before.price).toBeCloseTo(4.8e6);
  game = cloneDeep(game);
  runMonths(game, tileConnectionDuration(game.difficulty) / MINUTES_PER_MONTH);
  const town = acquisitionQuote(game, "parcel-1")!;
  game = reducer(
    game,
    acquireUtility({
      targetId: town.targetId,
      financed: false,
      quoteKey: town.quoteKey,
    }),
  );
  expect(price(remaining)).toBeCloseTo(
    ordinaryTileConnectionPrice(game, game.date.minute, "plains", 1),
  );
  expect(
    purchaseTile(game, { tileId: remaining, quoteKey: before.quoteKey }),
  ).toBe(false);
  connect(remaining);

  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  expect(parseSave(raw)?.game.territoryNetwork?.tilePurchases).toEqual(
    game.territoryNetwork?.tilePurchases,
  );
  const first = raw.game.territoryNetwork.tilePurchases[0];
  first.connectionDistance = 1;
  first.price = 3e6;
  expect(parseSave(raw)).toBeNull();
});

it.each([true, false])(
  "restores a tile purchase made in the same tick as a regional acquisition (acquisition first: %s)",
  (acquisitionFirst) => {
    const game = ready();
    const tileId = "green-uplands:site-3";
    const acquire = () => {
      const targetId = "ridge-electric";
      const quote = acquisitionQuote(game, targetId)!;
      expect(
        applyAcquireUtility(game, {
          targetId,
          financed: false,
          quoteKey: quote.quoteKey,
        }),
      ).toBe(true);
    };
    if (acquisitionFirst) acquire();
    const quote = tilePurchaseQuote(game, tileId)!;
    expect(purchaseTile(game, { tileId, quoteKey: quote.quoteKey })).toBe(true);
    if (!acquisitionFirst) acquire();
    expect(game.territoryNetwork!.tilePurchases![0].connectionDistance).toBe(
      acquisitionFirst ? 1 : 3,
    );
    expect(parseSave(serializeSave(game))).not.toBeNull();
  },
);

it("keeps a schema 19 receipt at its original parcel price", () => {
  const game = ready();
  const tileId = "green-uplands:site-2";
  const price = tilePrice(game, 0, tileId);
  expect(tilePurchaseQuote(game, tileId)!.price).toBeGreaterThan(price);
  const receipt = { tileId, minute: 0, price } as const;
  game.territoryNetwork!.tilePurchases = [receipt];
  currentTick(game)!.cash -= price;
  const save = parseSave({ ...serializeSave(game), schemaVersion: 19 });
  expect(save?.game.territoryNetwork?.tilePurchases).toEqual([receipt]);
  expect(currentTick(save!.game)!.cash).toBe(currentTick(game)!.cash);
  expect(parseSave(serializeSave(save!.game))?.game).toEqual(save!.game);
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
  const legacy = cloneDeep(game);
  for (const receipt of legacy.territoryNetwork!.tilePurchases!)
    delete receipt.connectionMinute;
  runMonths(game, tileConnectionDuration(game.difficulty) / MINUTES_PER_MONTH);
  const quote = acquisitionQuote(game, "parcel-1")!;
  if (quote.kind !== "municipal")
    throw new Error("Expected the Vergennes offer");
  expect(quote.territory.purchases.map(({ tileId }) => tileId)).toEqual([
    plant.id,
    city.id,
  ]);
  expect(quote.plantPrice).toBeGreaterThan(0);
  expect(quote.cashDue).toBe(quote.territory.price + quote.plantPrice);
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
  const shortDownPayment = cloneDeep(game);
  currentTick(shortDownPayment)!.cash = quote.financedCashDue - 1;
  const financedAction = acquireUtility({ ...payload, financed: true });
  expect(reducer(shortDownPayment, financedAction)).toBe(shortDownPayment);
  const financedGame = cloneDeep(game);
  currentTick(financedGame)!.cash = quote.financedCashDue;
  const financed = reducer(financedGame, financedAction);
  expect(reducer(financed, financedAction)).toBe(financed);
  expect(currentTick(financed)!.cash).toBe(0);
  expect(currentTick(financed)!.customers).toBe(customers + quote.customers);
  expect(utilityAcquisitions(financed)).toMatchObject([
    { targetId: quote.targetId, financed: true },
  ]);
  expect(financed.utilityExpansion?.loans).toMatchObject([
    {
      targetId: quote.targetId,
      kind: "purchase",
      principal: quote.newLoan,
      loanAmountLeft: quote.newLoan,
      loanMonthlyPayment: quote.monthlyDebtService,
    },
  ]);
  const financedSave = cloneDeep(serializeSave(financed));
  const reloaded = parseSave(financedSave);
  expect(
    reloaded?.game.facilities.find(({ tileId }) => tileId === plant.id),
  ).toMatchObject({
    name: "Natural Gas Peaker",
    peakW: 55e6,
    yearsToBuildLeft: 0,
  });
  expect(reloaded?.game.utilityExpansion?.loans).toEqual(
    financed.utilityExpansion?.loans,
  );
  const olderSave = cloneDeep(financedSave);
  olderSave.game.facilities = olderSave.game.facilities.filter(
    ({ tileId }) => tileId !== plant.id,
  );
  const olderLoan = olderSave.game.utilityExpansion!.loans[0];
  olderLoan.principal = maxLoanAmount(quote.territory.price);
  olderLoan.loanAmountLeft = olderLoan.principal;
  olderLoan.loanMonthlyPayment = getMonthlyPayment(
    olderLoan.principal,
    olderLoan.interestRate,
    olderLoan.months,
  );
  expect(parseSave(olderSave)).not.toBeNull();
  financedSave.game.utilityExpansion!.loans[0].targetId = "parcel-5";
  financedSave.game.utilityExpansion!.loans[0].id =
    "scenario-116-parcel-5-purchase";
  expect(parseSave(financedSave)).toBeNull();
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
  const purchasedViews = territoryTileViews(purchased);
  expect(purchasedViews.find(({ tile }) => tile.id === city.id)).toMatchObject({
    owned: true,
  });
  expect(purchasedViews.find(({ tile }) => tile.id === plant.id)).toMatchObject(
    {
      owned: true,
      operatingFacility: {
        name: "Natural Gas Peaker",
        peakW: 55e6,
        yearsToBuildLeft: 0,
      },
    },
  );
  expect(validTerritoryNetwork(purchased)).toBe(true);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(purchased)))),
  ).not.toBeNull();

  const legacyQuote = acquisitionQuote(legacy, "parcel-1")!;
  const legacyPurchased = reducer(
    legacy,
    acquireUtility({ ...payload, quoteKey: legacyQuote.quoteKey }),
  );
  const saved = JSON.parse(JSON.stringify(serializeSave(legacyPurchased)));
  saved.schemaVersion = 19;
  saved.game.objectiveProgress = retiredValleyOpeningProgress(legacyPurchased);
  const restored = parseSave(saved)!.game;
  expect(restored.objectiveProgress!.entries.map(({ id }) => id)).toEqual([
    "acquire-neighbor",
  ]);
  expect(gameObjectiveResults(restored)).toEqual(
    gameObjectiveResults(legacyPurchased),
  );
  expect(restored.territoryNetwork).toEqual(legacyPurchased.territoryNetwork);
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

it("rejects nonexistent municipal building sites at the purchase and restore boundaries", () => {
  const game = ready();
  const tileId = "parcel-1:site-0";
  expect(getTerritoryTile(tileId, game)).toBeUndefined();
  expect(tilePurchaseQuote(game, tileId)).toBeUndefined();
  expect(purchaseTile(game, { tileId, quoteKey: "nonexistent-site" })).toBe(
    false,
  );
  expect(game.territoryNetwork!.tilePurchases).toEqual([]);
  game.territoryNetwork!.tilePurchases = [{ tileId, minute: 0, price: 32e6 }];
  expect(validTerritoryNetwork(game)).toBe(false);
  expect(parseSave(serializeSave(game))).toBeNull();
});
