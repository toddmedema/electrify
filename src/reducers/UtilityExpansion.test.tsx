import { GAME_TO_REAL_YEARS, TICKS_PER_HOUR } from "../Constants";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { copyOfficialGame } from "../testing/OfficialScenarioExecutionFixtures";
import { GENERATORS } from "../data/Facilities";
import { UTILITY_TARGETS } from "../data/UtilityExpansion";
import { MINUTES_PER_MONTH, getDateFromMinute } from "../helpers/DateTime";
import { currentTick } from "../helpers/GameSelectors";
import {
  acquisitionAssets,
  acquisitionQuote,
  expansionRetentionBaseline,
  entitlementSources,
  networkCarryingValue,
  ownedUtility,
} from "../helpers/Expansion";
import {
  intertieContextForGame,
  intertieUpgradeQuote,
} from "../helpers/Transmission";
import type { GameType, UtilityTargetId } from "../Types";
import reducer, {
  buildTransmissionLine,
  buildFacility,
  generateForecastTimeline,
  sellFacility,
  togglePauseTransmissionLine,
  upgradeTransmissionLine,
  recordExpansionMilestones,
  tickState,
} from "./Game";
import { acquireUtility } from "./GameActions";

function ready(targetId: UtilityTargetId = "valley-electric") {
  let game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  currentTick(game)!.cash = 2e9;
  game = copyOfficialGame(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: UTILITY_TARGETS.find((target) => target.id === targetId)!
          .corridorId,
        financed: false,
      }),
    ),
  );
  game.transmission!.lines[0].yearsToBuildLeft = 0;
  return game;
}
function buy(
  game: GameType,
  targetId: UtilityTargetId = "valley-electric",
  financed = true,
) {
  const quote = acquisitionQuote(game, targetId)!;
  expect(quote).toBeDefined();
  return copyOfficialGame(
    reducer(
      game,
      acquireUtility({ targetId, financed, quoteKey: quote.quoteKey }),
    ),
  );
}

it("requires the correct completed connection, current quote and enough cash before changing any state", () => {
  const game = ready();
  expect(acquisitionQuote(game, "ridge-electric")).toBeUndefined();
  game.transmission!.lines[0].yearsToBuildLeft = 1;
  expect(acquisitionQuote(game, "valley-electric")).toBeUndefined();
  game.transmission!.lines[0].yearsToBuildLeft = 0;
  const quote = acquisitionQuote(game, "valley-electric")!;
  expect(
    reducer(
      game,
      acquireUtility({
        targetId: quote.targetId,
        financed: true,
        quoteKey: "stale",
      }),
    ),
  ).toEqual(game);
  const poor = copyOfficialGame(game);
  currentTick(poor)!.cash = 0;
  expect(
    reducer(
      poor,
      acquireUtility({
        targetId: quote.targetId,
        financed: true,
        quoteKey: quote.quoteKey,
      }),
    ),
  ).toEqual(poor);
});

it.each(["valley-electric", "ridge-electric"] as const)(
  "folds %s into one customer count, pool, shared fleet and policy ledger",
  (targetId) => {
    const game = ready(targetId);
    game.transmission!.lines[0].paused = true;
    const quote = acquisitionQuote(game, targetId)!;
    const before = cloneDeep(currentTick(game)!);
    const bought = buy(game, targetId);
    const now = currentTick(bought)!;
    expect(now.customers).toBeCloseTo(before.customers + quote.customers, 6);
    expect(now.cash).toBeCloseTo(before.cash - quote.financedCashDue, 4);
    expect(now.netWorth).toBeCloseTo(before.netWorth - quote.fee, 3);
    expect(expansionRetentionBaseline(bought)).toBe(90000 + quote.customers);
    expect(bought.objectiveProgress!.retentionBaseline).toBe(
      expansionRetentionBaseline(bought),
    );
    expect(bought.customerMarketSize).toBe(
      targetId === "valley-electric" ? 498000 : 280000,
    );
    expect(bought.utilityExpansion!.networkAssets).toHaveLength(1);
    expect(bought.utilityExpansion!.loans).toHaveLength(2);
    expect(bought.facilities).toHaveLength(
      game.facilities.length + quote.facilities.length,
    );
    expect(
      bought.facilities.every(
        (f) => !Object.prototype.hasOwnProperty.call(f, "operatingAreaId"),
      ),
    ).toBe(true);
    expect(
      bought.timeline.every(
        (t) => !Object.prototype.hasOwnProperty.call(t, "areaTicks"),
      ),
    ).toBe(true);
    expect(bought.transmission!.lines[0]).toMatchObject({
      paused: false,
      currentFlowW: 0,
    });
    expect(ownedUtility(bought, targetId)).toBe(true);
    expect(acquisitionQuote(bought, targetId)).toBeUndefined();
  },
);

it("retains original seller age and identities without booking new construction emissions", () => {
  const game = ready();
  const assets = acquisitionAssets(game, "valley-electric")!;
  expect(assets.every((asset) => asset.constructionKgco2eTotal === 0)).toBe(
    true,
  );
  expect(
    assets.find((asset) => asset.fuel === "Hydro")!.minuteOperational,
  ).toBeLessThan(0);
  const before = currentTick(game)!.constructionKgco2e;
  const bought = buy(game);
  expect(currentTick(bought)!.constructionKgco2e).toBe(before);
  expect(bought.facilities.map((f) => f.startingAssetId)).toContain(
    "scenario-116-valley-oil",
  );
});

it("uses one shared dispatch and retains ownership even when the old wire record cannot carry power", () => {
  const game = buy(ready("ridge-electric"), "ridge-electric");
  const now = currentTick(game)!;
  const before = generateForecastTimeline(game, now.cash, now.customers);
  const noWire = copyOfficialGame(game);
  noWire.transmission!.lines = [];
  const after = generateForecastTimeline(noWire, now.cash, now.customers);
  expect(
    after.map((t) => [t.supplyW, t.demandW, t.entitlementImportCapacityW]),
  ).toEqual(
    before.map((t) => [t.supplyW, t.demandW, t.entitlementImportCapacityW]),
  );
  expect(ownedUtility(noWire, "ridge-electric")).toBe(true);
});

it("removes the acquired external pool and cannot resell unused source rights", () => {
  const game = buy(ready());
  game.facilities = [];
  currentTick(game)!.customers = 1;
  const forecast = generateForecastTimeline(game, currentTick(game)!.cash, 1);
  expect(
    forecast.every((t) => t.transmissionCapacityW === 0 && t.exportedW === 0),
  ).toBe(true);
  expect(
    forecast.every(
      (t) =>
        t.importedW === t.entitlementImportedW &&
        t.entitlementImportedW! <= t.entitlementImportCapacityW!,
    ),
  ).toBe(true);
});

it("keeps corporate debt after plant sales and never writes impaired network value back up", () => {
  const game = buy(ready());
  const debt = cloneDeep(game.utilityExpansion!.loans);
  const plant = game.facilities.find(
    (f) => f.startingAssetId === "scenario-116-valley-oil",
  )!;
  const sold = copyOfficialGame(reducer(game, sellFacility(plant.id)));
  expect(sold.utilityExpansion!.loans).toEqual(debt);
  const network = sold.utilityExpansion!.networkAssets[0];
  network.retentionLowWatermark = 0.8;
  expect(
    networkCarryingValue(
      network,
      network.activatedMinute + 120 * MINUTES_PER_MONTH,
    ),
  ).toBeCloseTo(network.initialValue * 0.75 * 0.8, 4);
});

it("rejects no-op spending and operation controls on an acquired connection", () => {
  const opening = ready();
  const openingLine = opening.transmission!.lines[0];
  expect(
    intertieUpgradeQuote(
      openingLine,
      opening.date.year,
      1,
      1,
      intertieContextForGame(opening),
    ),
  ).toBeDefined();
  const game = buy(opening);
  const line = game.transmission!.lines[0];
  expect(
    intertieUpgradeQuote(
      line,
      game.date.year,
      1,
      1,
      intertieContextForGame(game),
    ),
  ).toBeUndefined();
  expect(reducer(game, togglePauseTransmissionLine(line.id))).toEqual(game);
  expect(
    reducer(
      game,
      upgradeTransmissionLine({ corridorId: line.corridorId, financed: true }),
    ),
  ).toEqual(game);
});

it("ordinary builds join the common fleet and forecasts leave the live company untouched", () => {
  let game = buy(ready());
  const quote = GENERATORS(game, 100e6, [10], [100]).find(
    (f) => f.available && f.name === "Natural Gas CC",
  )!;
  game = copyOfficialGame(
    reducer(game, buildFacility({ facility: quote, financed: true })),
  );
  expect(game.facilities.at(-1)).not.toHaveProperty("operatingAreaId");
  const before = JSON.stringify(game);
  const now = currentTick(game)!;
  generateForecastTimeline(game, now.cash, now.customers);
  expect(JSON.stringify(game)).toBe(before);
});

it("keeps Valley's 2017 reduction dated and notices once, without resetting it on a late purchase", () => {
  const game = buy(ready());
  const frame = currentTick(game)!;
  const capacity = (month: number) =>
    entitlementSources(game, {
      ...frame,
      minute: month * MINUTES_PER_MONTH,
    }).reduce((sum, source) => sum + source.capacityW, 0);
  // The balancing offer may vary by date; compare the fixed nuclear entitlement itself.
  const nuclear = (month: number) =>
    entitlementSources(game, {
      ...frame,
      minute: month * MINUTES_PER_MONTH,
    }).find((source) => source.id === "valley-nuclear")!.capacityW;
  expect(nuclear(143) - nuclear(144)).toBe(76e6);
  expect(capacity(240)).toBe(0);
  for (const month of [120, 120, 144, 144]) {
    game.date = getDateFromMinute(month * MINUTES_PER_MONTH, 2005);
    recordExpansionMilestones(game);
  }
  expect(
    game.reportedEventKeys.filter((key) =>
      key.startsWith("scenario-116-valley-supply-"),
    ),
  ).toHaveLength(2);
});

it("buys cheaper acquired nuclear rights before expensive native hydro for a partial company load", () => {
  const game = buy(ready());
  for (const facility of game.facilities) facility.paused = true;
  const next = game.timeline[1];
  next.demandW = 200e6;
  for (const type of DEMAND_TYPES)
    next.demandByType[type] = type === "Residential" ? next.demandW : 0;
  const offers = entitlementSources(game, next);
  expect(
    offers
      .filter((source) => source.utilityId === "champlain")
      .reduce((sum, source) => sum + source.capacityW, 0),
  ).toBeLessThanOrEqual(300e6);
  expect(
    offers
      .filter((source) => source.utilityId === "valley-electric")
      .reduce((sum, source) => sum + source.capacityW, 0),
  ).toBeLessThanOrEqual(350e6);
  tickState(game);
  const now = currentTick(game)!;
  expect(now.entitlementImportedW).toBe(200e6);
  expect(now.expensesImports).toBeCloseTo(
    (((200e6 / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS) / 1e6) * 40,
    4,
  );
  expect(now.importedKgco2e).toBe(0);
  expect(offers.slice(0, 2).map((source) => source.id)).toEqual([
    "champlain-nuclear",
    "valley-nuclear",
  ]);
  expect(offers[0].capacityW + offers[1].capacityW).toBe(247e6);
});
