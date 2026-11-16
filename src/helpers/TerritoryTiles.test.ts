import cloneDeep from "lodash.clonedeep";
import { GENERATORS } from "../data/Facilities";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import reducer, {
  buildFacility,
  sellFacility,
  tickState,
} from "../reducers/Game";
import { currentTick } from "./GameSelectors";
import {
  landPurchaseQuote,
  purchaseLand,
  territoryBuildAvailability,
} from "./Territories";
import {
  availableTerritoryTiles,
  facilityOnTile,
  getFacilityTile,
  getTerritoryTiles,
} from "./TerritoryTiles";
import { acquisitionQuote, transferUtility } from "./Expansion";
import type { GameType, TerritoryTileId } from "../Types";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 12345 });
  currentTick(game)!.cash = 3e9;
  return game;
}
function wind(game: GameType) {
  return GENERATORS(game, 50e6, [20], [500]).find(
    (quote) => quote.name === "Wind",
  )!;
}
it("authors distinct terrain cells with exactly one city or construction site each", () => {
  expect(TERRITORY_TILES).toHaveLength(76);
  expect(new Set(TERRITORY_TILES.map(({ id }) => id)).size).toBe(76);
  expect(new Set(TERRITORY_TILES.map(({ q, r }) => `${q},${r}`)).size).toBe(76);
  expect(new Set(TERRITORY_TILES.map(({ terrain }) => terrain))).toEqual(
    new Set([
      "plains",
      "forest",
      "hills",
      "mountain",
      "river",
      "lake",
      "ocean",
    ]),
  );
  expect(TERRITORY_TILES.every((tile) => !!tile.city !== !!tile.siteKind)).toBe(
    true,
  );
});
it("places every opening and acquired asset on a separate matching tile", () => {
  const game = ready();
  expect(new Set(game.facilities.map(({ tileId }) => tileId)).size).toBe(
    game.facilities.length,
  );
  for (const facility of game.facilities)
    expect(getFacilityTile(facility)?.startingAssetId).toBe(
      facility.startingAssetId,
    );
  const quote = acquisitionQuote(game, "valley-electric")!;
  expect(
    transferUtility(game, {
      targetId: quote.targetId,
      financed: false,
      quoteKey: quote.quoteKey,
    }),
  ).toBe(true);
  expect(new Set(game.facilities.map(({ tileId }) => tileId)).size).toBe(
    game.facilities.length,
  );
  for (const facility of game.facilities)
    expect(facilityOnTile(game, facility.tileId!)?.id).toBe(facility.id);
  expect(
    game.facilities.filter(
      ({ territoryId }) => territoryId === "valley-electric",
    ),
  ).toHaveLength(UTILITY_AREAS["valley-electric"].facilities.length);
});
it.each([
  "champlain:city",
  "champlain:site-0",
  "champlain:site-14",
  "champlain:site-7",
  "valley-electric:site-1",
  "imaginary",
])(
  "rejects invalid, city, occupied, foreign and underwater destinations atomically: %s",
  (tileId) => {
    const game = ready();
    const before = JSON.stringify(game);
    const result = reducer(
      game,
      buildFacility({
        facility: wind(game),
        financed: false,
        territoryId: "champlain",
        tileId: tileId as TerritoryTileId,
      }),
    );
    expect(JSON.stringify(result)).toBe(before);
  },
);
it("reserves one selected slot during construction and pause; selling makes that same cell available", () => {
  let game = ready();
  const quote = wind(game);
  const tile = availableTerritoryTiles(game, quote, "champlain")[0];
  game = cloneDeep(
    reducer(
      game,
      buildFacility({
        facility: quote,
        financed: false,
        territoryId: "champlain",
        tileId: tile.id,
      }),
    ),
  );
  const project = facilityOnTile(game, tile.id)!;
  expect(project.yearsToBuildLeft).toBeGreaterThan(0);
  project.paused = true;
  expect(
    territoryBuildAvailability(game, quote, "champlain", tile.id).buildable,
  ).toBe(false);
  const cash = currentTick(game)!.cash;
  const rejected = reducer(
    game,
    buildFacility({
      facility: quote,
      financed: false,
      territoryId: "champlain",
      tileId: tile.id,
    }),
  );
  expect(currentTick(rejected)!.cash).toBe(cash);
  expect(rejected.facilities).toHaveLength(game.facilities.length);
  game = cloneDeep(reducer(game, sellFacility(project.id)));
  expect(
    territoryBuildAvailability(game, quote, "champlain", tile.id),
  ).toMatchObject({ buildable: true, tileId: tile.id });
});
it("retains the old territory API by choosing a different free cell for each build", () => {
  let game = ready();
  const land = landPurchaseQuote(game)!;
  expect(
    purchaseLand(game, {
      territoryId: land.territoryId,
      quoteKey: land.quoteKey,
    }),
  ).toBe(true);
  for (let index = 0; index < 7; index++)
    game = cloneDeep(
      reducer(
        game,
        buildFacility({
          facility: wind(game),
          financed: false,
          territoryId: "green-uplands",
        }),
      ),
    );
  const projects = game.facilities.filter(
    ({ territoryId }) => territoryId === "green-uplands",
  );
  expect(projects).toHaveLength(7);
  expect(new Set(projects.map(({ tileId }) => tileId)).size).toBe(7);
  expect(
    territoryBuildAvailability(game, wind(game), "green-uplands").buildable,
  ).toBe(false);
});
it("migrates schema15 placements without changing finances, progress or resumed simulation", () => {
  const game = ready();
  const source = serializeSave(game);
  const raw = JSON.parse(JSON.stringify(source));
  raw.schemaVersion = 15;
  for (const facility of raw.game.facilities) delete facility.tileId;
  const untouched = JSON.stringify(raw);
  const migrated = parseSave(raw)!;
  expect(migrated).not.toBeNull();
  expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  expect(JSON.stringify(raw)).toBe(untouched);
  expect(currentTick(migrated.game)!.cash).toBe(currentTick(game)!.cash);
  expect(migrated.game.runIdentity).toEqual(game.runIdentity);
  expect(migrated.game.facilities).toEqual(
    raw.game.facilities.map(
      (facility: Record<string, unknown>, index: number) => ({
        ...facility,
        tileId: game.facilities[index].tileId,
      }),
    ),
  );
  const restored = parseSave(cloneDeep(serializeSave(migrated.game)))!.game;
  tickState(migrated.game);
  tickState(restored);
  // Hydration rebuilds non-enumerable forecast caches; persisted state and dispatch metadata must agree.
  expect(JSON.parse(JSON.stringify(restored))).toEqual(
    JSON.parse(JSON.stringify(migrated.game)),
  );
  expect(serializeSave(restored).commitmentForecast).toEqual(
    serializeSave(migrated.game).commitmentForecast,
  );
});
it("gives retained pre-map overflow projects their own cells while rejecting malformed current placements", () => {
  const game = ready();
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 15;
  for (const facility of raw.game.facilities) delete facility.tileId;
  const oil = raw.game.facilities.find(
    (facility: { fuel: string }) => facility.fuel === "Oil",
  );
  for (let id = 100; id < 112; id++)
    raw.game.facilities.push({ ...oil, id, startingAssetId: undefined });
  const restored = parseSave(raw)!;
  expect(restored).not.toBeNull();
  expect(restored.game.facilities).toHaveLength(raw.game.facilities.length);
  expect(
    new Set(restored.game.facilities.map(({ tileId }) => tileId)).size,
  ).toBe(raw.game.facilities.length);
  expect(getTerritoryTiles(restored.game).length).toBeGreaterThan(76);
  const current = JSON.parse(JSON.stringify(serializeSave(game)));
  const oils = current.game.facilities.filter(
    (facility: { fuel: string }) => facility.fuel === "Oil",
  );
  oils[0].tileId = oils[1].tileId;
  expect(parseSave(current)).toBeNull();
  oils[0].tileId = "champlain:city";
  expect(parseSave(current)).toBeNull();
});
