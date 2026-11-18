import { GENERATORS, STORAGE } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import {
  hasTerritoryNetwork,
  landPurchaseQuote,
  purchaseLand,
  ownedTerritories,
  territoryBuildAvailability,
  territorySiteInventory,
  territoryDemandShares,
} from "./Territories";
import { transferUtility, acquisitionQuote } from "./Expansion";
import reducer, { buildFacility, sellFacility } from "../reducers/Game";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 1e9;
  return game;
}
function buyLand(game: ReturnType<typeof ready>) {
  const quote = landPurchaseQuote(game)!;
  expect(
    purchaseLand(game, {
      territoryId: quote.territoryId,
      quoteKey: quote.quoteKey,
    }),
  ).toBe(true);
}
it("enables site budgets only in the expansion scenario", () => {
  const game = ready();
  expect(hasTerritoryNetwork(game)).toBe(true);
  expect(hasTerritoryNetwork({ ...game, scenarioId: 100 })).toBe(false);
  expect(ownedTerritories(game)).toEqual(["champlain"]);
});
it("exchanges one seventh of the old land price for a single immediate tile, with no plants, customers or line", () => {
  const game = createGame({ scenarioId: 116, seed: 61 });
  const before = {
    cash: currentTick(game)!.cash,
    customers: currentTick(game)!.customers,
    netWorth: currentTick(game)!.netWorth,
    facilities: game.facilities.length,
  };
  const quote = landPurchaseQuote(game)!;
  expect(quote.price).toBeCloseTo((before.cash * 0.15) / 7, 5);
  buyLand(game);
  expect(currentTick(game)!.cash).toBeCloseTo(before.cash - quote.price, 5);
  expect(currentTick(game)!.cash).toBeGreaterThan(100e6);
  expect(currentTick(game)!.netWorth).toBe(before.netWorth);
  expect(currentTick(game)!.customers).toBe(before.customers);
  expect(game.facilities).toHaveLength(before.facilities);
  expect(game.transmission!.lines).toEqual([]);
  expect(ownedTerritories(game)).toContain("green-uplands");
  expect(landPurchaseQuote(game)?.tileId).not.toBe(quote.tileId);
});
it.each([
  null,
  {},
  { territoryId: "ridge-electric", quoteKey: "fake" },
  { territoryId: "green-uplands", quoteKey: "fake", price: 0 },
])("rejects malformed land purchase %p atomically", (payload) => {
  const game = ready();
  const before = JSON.stringify(game);
  expect(purchaseLand(game, payload)).toBe(false);
  expect(JSON.stringify(game)).toBe(before);
});
it("rejects unaffordable and duplicate purchases atomically", () => {
  const game = ready();
  const quote = landPurchaseQuote(game)!;
  const payload = { territoryId: quote.territoryId, quoteKey: quote.quoteKey };
  currentTick(game)!.cash = quote.price - 1;
  const before = JSON.stringify(game);
  expect(purchaseLand(game, payload)).toBe(false);
  expect(JSON.stringify(game)).toBe(before);
  currentTick(game)!.cash = quote.price;
  expect(purchaseLand(game, payload)).toBe(true);
  expect(currentTick(game)!.cash).toBe(0);
  const after = JSON.stringify(game);
  expect(purchaseLand(game, payload)).toBe(false);
  expect(JSON.stringify(game)).toBe(after);
});
it("reserves shared general sites through construction and pause; selling frees the site", () => {
  let game = ready();
  const wind = GENERATORS(game, 50e6, [20], [500]).find(
    (f) => f.fuel === "Wind",
  )!;
  expect(
    territoryBuildAvailability(game, wind, "green-uplands").buildable,
  ).toBe(false);
  buyLand(game);
  for (let i = 0; i < 7; i++) {
    if (i > 0) buyLand(game);
    game = JSON.parse(
      JSON.stringify(
        reducer(
          game,
          buildFacility({
            facility: wind,
            financed: false,
            territoryId: "green-uplands",
          }),
        ),
      ),
    );
  }
  expect(
    territorySiteInventory(game, "green-uplands", "general").remaining,
  ).toBe(0);
  const remote = game.facilities.find(
    (f) => f.territoryId === "green-uplands",
  )!;
  remote.paused = true;
  expect(
    territoryBuildAvailability(game, wind, "green-uplands").buildable,
  ).toBe(false);
  game = JSON.parse(JSON.stringify(reducer(game, sellFacility(remote.id))));
  expect(
    territorySiteInventory(game, "green-uplands", "general").remaining,
  ).toBe(1);
  expect(
    territoryBuildAvailability(game, { ...wind, peakW: 300e6 }, "green-uplands")
      .buildable,
  ).toBe(true);
  expect(
    territoryBuildAvailability(game, { ...wind, peakW: 301e6 }, "green-uplands")
      .buildable,
  ).toBe(false);
  const battery = STORAGE(
    { ...game, date: { ...game.date, year: 2025 } },
    50e6,
  )[0];
  expect(
    territoryBuildAvailability(game, battery, "green-uplands").buildable,
  ).toBe(true);
});
it("retains utility sector demand weights while using a single company demand total", () => {
  const game = ready();
  const quote = acquisitionQuote(game, "ridge-electric")!;
  expect(
    transferUtility(game, {
      targetId: "ridge-electric",
      financed: false,
      quoteKey: quote.quoteKey,
    }),
  ).toBe(true);
  const tick = currentTick(game)!;
  const shares = territoryDemandShares(game, tick);
  expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(
    tick.demandW,
    5,
  );
  expect(shares["green-uplands"]).toBe(0);
  expect(shares["ridge-electric"]).toBeGreaterThan(0);
});
