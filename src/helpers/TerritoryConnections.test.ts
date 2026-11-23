import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES } from "../Constants";
import * as municipalUtilities from "../data/MunicipalUtilities";
import { getBuildFacilityQuote } from "../data/Facilities";
import { parseSave, serializeSave } from "../SaveGame";
import gameReducer, {
  buildFacility,
  generateForecastTimeline,
  tickState,
} from "../reducers/Game";
import { acquireTile } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import type { GameType, TerritoryTileId } from "../Types";
import { customerBatteryFleet } from "./CustomerBatteries";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { expansionRetentionBaseline } from "./Expansion";
import { currentTick } from "./GameSelectors";
import { emptyPolicies, programCustomers } from "./Policies";
import { landTransferredCustomers } from "./TerritoryCustomers";
import { territoryTileViews } from "./TerritoryMapState";
import { tilePurchaseQuote, tilePurchaseQuotes } from "./Territories";
import { validTerritoryNetwork } from "./TerritoryValidation";
import {
  getTerritoryTile,
  isAdjacentToOwnedTerritoryTile,
  territoryHexDistance,
} from "./TerritoryTiles";

afterEach(() => jest.restoreAllMocks());

function valley(difficulty: GameType["difficulty"] = "Intern") {
  const game = createGame({ scenarioId: 116, seed: 61, difficulty });
  currentTick(game)!.cash = 1e9;
  return game;
}

function connect(game: GameType, tileId: TerritoryTileId) {
  const quote = tilePurchaseQuote(game, tileId)!;
  const result = gameReducer(
    game,
    acquireTile({ tileId, quoteKey: quote.quoteKey }),
  );
  expect(currentTick(result)!.cash).toBe(currentTick(game)!.cash - quote.price);
  return cloneDeep(result);
}

function advanceTo(game: GameType, minute: number) {
  while (game.date.minute < minute) tickState(game);
  expect(game.date.minute).toBe(minute);
}

function connectTown(
  game: GameType,
  tileId: TerritoryTileId = "parcel-1:city",
) {
  const city = getTerritoryTile(tileId)!;
  // The shipped towns have plants; exercise the supported standalone-town purchase.
  const utilityAt = municipalUtilities.municipalUtilityAt;
  jest
    .spyOn(municipalUtilities, "municipalUtilityAt")
    .mockImplementation((tile) =>
      tile.id === city.id ? undefined : utilityAt(tile),
    );
  while (!tilePurchaseQuote(game, city.id)) {
    const next = [...tilePurchaseQuotes(game).keys()]
      .map((tileId) => getTerritoryTile(tileId)!)
      .sort(
        (a, b) => territoryHexDistance(a, city) - territoryHexDistance(b, city),
      )[0];
    game = connect(game, next.id);
  }
  const quote = tilePurchaseQuote(game, city.id)!;
  return { game: connect(game, city.id), city, quote };
}

it.each([
  ["Intern", 1],
  ["Employee", 2],
  ["Manager", 3],
  ["VP", 4],
  ["CEO", 6],
] as const)(
  "schedules a %s connection for %i game months",
  (difficulty, months) => {
    const game = valley(difficulty);
    const tile = "green-uplands:site-1";
    const connected = connect(game, tile);
    expect(connected.territoryNetwork!.tilePurchases![0].connectionMinute).toBe(
      game.date.minute + months * MINUTES_PER_MONTH,
    );
  },
);

it("starts an adjacent project from a pending claim and unlocks construction at its own scheduled minute", () => {
  const initial = valley();
  const first = "green-uplands:site-1";
  const openingOffers = tilePurchaseQuotes(initial);
  let game = connect(initial, first);
  const second = [...tilePurchaseQuotes(game).values()].find(
    ({ tileId }) =>
      !openingOffers.has(tileId) &&
      getTerritoryTile(tileId)?.siteKind === "general",
  )!.tileId;
  expect(
    isAdjacentToOwnedTerritoryTile(initial, getTerritoryTile(second)!),
  ).toBe(false);

  advanceTo(game, TICK_MINUTES);
  game = connect(game, second);
  const target = getTerritoryTile(second)!;
  const quote = getBuildFacilityQuote(
    game,
    { name: "Wind", peakW: 10e6 },
    target.territoryId,
    second,
  )!;
  const build = buildFacility({
    facility: quote,
    financed: false,
    territoryId: target.territoryId,
    tileId: second,
  });
  expect(gameReducer(game, build)).toBe(game);

  const decoded = parseSave(JSON.parse(JSON.stringify(serializeSave(game))))!;
  expect(decoded.game.territoryNetwork?.tilePurchases).toEqual(
    game.territoryNetwork?.tilePurchases,
  );
  const malformed = cloneDeep(game);
  malformed.territoryNetwork!.tilePurchases![1].connectionMinute! -=
    TICK_MINUTES;
  expect(validTerritoryNetwork(malformed)).toBe(false);

  game = cloneDeep(game);
  advanceTo(game, MINUTES_PER_MONTH);
  const views = territoryTileViews(game);
  expect(views.find(({ tile }) => tile.id === first)).toMatchObject({
    developed: true,
  });
  expect(views.find(({ tile }) => tile.id === second)).toMatchObject({
    owned: true,
    developed: false,
  });
  expect(gameReducer(game, build)).toBe(game);

  game = cloneDeep(game);
  tickState(game);
  expect(
    territoryTileViews(game).find(({ tile }) => tile.id === second),
  ).toMatchObject({ developed: true });
  expect(gameReducer(game, build).facilities).toEqual(
    expect.arrayContaining([expect.objectContaining({ tileId: second })]),
  );
  const resumed = cloneDeep(decoded.game);
  advanceTo(resumed, game.date.minute);
  expect(JSON.stringify(currentTick(resumed))).toBe(
    JSON.stringify(currentTick(game)),
  );
});

it.each([0, TICK_MINUTES])(
  "credits a pending town at its scheduled time from minute %i",
  (startMinute) => {
    const initial = valley();
    const originalMarket = initial.customerMarketSize;
    const originalBaseline = expansionRetentionBaseline(initial);
    advanceTo(initial, startMinute);
    const { game, city, quote } = connectTown(initial);
    const decoded = parseSave(JSON.parse(JSON.stringify(serializeSave(game))));
    expect(decoded?.game.customerMarketSize).toBe(originalMarket);
    advanceTo(game, quote.connectionMinute - TICK_MINUTES);
    expect(landTransferredCustomers(game, city.territoryId)).toBe(0);
    expect(expansionRetentionBaseline(game)).toBe(originalBaseline);
    const { cash, customers } = currentTick(game)!;
    const beforeForecast = JSON.stringify(game);
    const withoutTown = cloneDeep(game);
    withoutTown.territoryNetwork!.tilePurchases =
      withoutTown.territoryNetwork!.tilePurchases!.filter(
        ({ tileId }) => tileId !== city.id,
      );
    for (const stepMinutes of [TICK_MINUTES, 60]) {
      const baselines: number[] = [];
      const forecast = generateForecastTimeline(
        game,
        cash,
        customers,
        3,
        stepMinutes,
        (state) => baselines.push(expansionRetentionBaseline(state)),
      );
      const withoutConnection = generateForecastTimeline(
        withoutTown,
        cash,
        customers,
        3,
        stepMinutes,
      );
      expect(forecast[0].customers).toBe(withoutConnection[0].customers);
      expect(forecast[0].demandW).toBe(withoutConnection[0].demandW);
      expect(baselines).toEqual([
        originalBaseline,
        originalBaseline + quote.customers,
        originalBaseline + quote.customers,
      ]);
      for (const index of [1, 2]) {
        expect(
          forecast[index].customers - withoutConnection[index].customers,
        ).toBeCloseTo(quote.customers, -2);
      }
      const inMonth = quote.connectionMinute % MINUTES_PER_MONTH !== 0;
      const settlesBeforeConnecting = inMonth && stepMinutes === TICK_MINUTES;
      expect(
        Math.sign(forecast[1].demandW - withoutConnection[1].demandW),
      ).toBe(settlesBeforeConnecting ? 0 : 1);
      expect(forecast[2].demandW).toBeGreaterThan(withoutConnection[2].demandW);
    }
    expect(JSON.stringify(game)).toBe(beforeForecast);
    tickState(game);
    expect(landTransferredCustomers(game, city.territoryId)).toBe(
      quote.customers,
    );
    expect(expansionRetentionBaseline(game)).toBe(
      originalBaseline + quote.customers,
    );
    expect(currentTick(game)!.customers - customers).toBeCloseTo(
      quote.customers,
      -2,
    );
    tickState(game);
    expect(currentTick(game)!.customers - customers).toBeCloseTo(
      quote.customers,
      -2,
    );
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
    ).not.toBeNull();
  },
);

it.each([false, true])(
  "preserves installed battery dispatch through a v3 agreement close (town connects: %s)",
  (withConnection) => {
    const initial = valley();
    const purchaseMinute = 216 * MINUTES_PER_MONTH - 2 * TICK_MINUTES;
    initial.date = getDateFromMinute(purchaseMinute, initial.startingYear);
    for (const tick of initial.timeline) tick.minute += purchaseMinute;
    const { game, city, quote } = connectTown(initial, "parcel-5:city");
    const start = quote.connectionMinute - TICK_MINUTES;
    game.date = getDateFromMinute(start, game.startingYear);
    for (const tick of game.timeline) tick.minute += start - purchaseMinute;
    if (!withConnection) {
      game.territoryNetwork!.tilePurchases =
        game.territoryNetwork!.tilePurchases!.filter(
          ({ tileId }) => tileId !== city.id,
        );
    }
    const month = game.date.monthsElapsed;
    game.policies = emptyPolicies(month);
    game.policies.programs.battery = {
      ...game.policies.programs.battery,
      tier: "On",
      startHour: 23,
      adoption: 0.5,
      installs: [[month, 0.5]],
    };
    const now = currentTick(game)!;
    now.customerBatteryWhStart = customerBatteryFleet(
      game.policies.programs.battery,
      month,
      game.startingYear,
      programCustomers(game),
      game.location,
    ).capacityWh;
    now.customerBatteryWh = now.customerBatteryWhStart;
    game.transmission!.agreementAccounts = [
      {
        agreementId: "test-meter",
        termsVersion: 3,
        accountingStartMinute: start,
        accountedThroughMinute: start,
        months: [],
      },
    ];
    const close = generateForecastTimeline(game, now.cash, now.customers, 3)[2];
    const sameFrame = generateForecastTimeline(
      game,
      now.cash,
      now.customers,
      4,
    )[2];
    expect(close.minute + TICK_MINUTES).toBe(217 * MINUTES_PER_MONTH);
    expect(close.cash).not.toBe(sameFrame.cash);
    expect(sameFrame.customerBatteryDischargeW).toBeGreaterThan(0);
    expect(close.customerBatteryDischargeW).toBeCloseTo(
      sameFrame.customerBatteryDischargeW!,
      5,
    );
  },
);
