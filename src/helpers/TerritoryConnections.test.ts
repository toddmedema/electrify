import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES } from "../Constants";
import * as municipalUtilities from "../data/MunicipalUtilities";
import { getBuildFacilityQuote } from "../data/Facilities";
import { parseSave, serializeSave } from "../SaveGame";
import gameReducer, { buildFacility, tickState } from "../reducers/Game";
import { acquireTile } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import type { GameType, TerritoryTileId } from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";
import { expansionRetentionBaseline } from "./Expansion";
import { currentTick } from "./GameSelectors";
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
    let game = valley();
    const city = getTerritoryTile("parcel-1:city")!;
    // The shipped towns have plants; exercise the supported standalone-town purchase.
    const utilityAt = municipalUtilities.municipalUtilityAt;
    jest
      .spyOn(municipalUtilities, "municipalUtilityAt")
      .mockImplementation((tile) =>
        tile.id === city.id ? undefined : utilityAt(tile),
      );
    const originalMarket = game.customerMarketSize;
    const originalBaseline = expansionRetentionBaseline(game);
    advanceTo(game, startMinute);
    while (!tilePurchaseQuote(game, city.id)) {
      const next = [...tilePurchaseQuotes(game).keys()]
        .map((tileId) => getTerritoryTile(tileId)!)
        .sort(
          (a, b) =>
            territoryHexDistance(a, city) - territoryHexDistance(b, city),
        )[0];
      game = connect(game, next.id);
    }
    const quote = tilePurchaseQuote(game, city.id)!;
    game = connect(game, city.id);
    const decoded = parseSave(JSON.parse(JSON.stringify(serializeSave(game))));
    expect(decoded?.game.customerMarketSize).toBe(originalMarket);
    advanceTo(game, quote.connectionMinute - TICK_MINUTES);
    expect(landTransferredCustomers(game, city.territoryId)).toBe(0);
    expect(expansionRetentionBaseline(game)).toBe(originalBaseline);
    const customers = currentTick(game)!.customers;
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
