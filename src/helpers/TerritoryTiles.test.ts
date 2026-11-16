import cloneDeep from "lodash.clonedeep";
import { LOCATIONS } from "../Constants";
import { GENERATORS, STORAGE } from "../data/Facilities";
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
  assignTerritoryTiles,
  availableTerritoryTiles,
  facilityOnTile,
  getFacilityTile,
  getTerritoryTiles,
} from "./TerritoryTiles";
import { acquisitionQuote, transferUtility } from "./Expansion";
import type { GameType, StorageOperatingType, TerritoryTileId } from "../Types";

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
function retainedStorageSave() {
  const game = ready();
  tickState(game);
  // Retained plants survive later changes to the local technology/site catalog.
  const quotes = STORAGE(
    { ...game, location: LOCATIONS.SF, date: { ...game.date, year: 2030 } },
    50e6,
  );
  expect(quotes.map(({ name }) => name)).toEqual([
    "Battery",
    "Iron-Air Battery",
    "Pumped Hydro",
  ]);
  for (const [index, quote] of quotes.entries()) {
    const { viableLocationsRemaining: _remaining, ...technology } = quote;
    const facility: StorageOperatingType = {
      ...technology,
      id: 100 + index,
      territoryId: "champlain",
      currentW: 0,
      currentWh: index === 1 ? 0 : quote.peakWh / 2,
      yearsToBuildLeft: index === 1 ? quote.yearsToBuild / 2 : 0,
      paused: index === 1,
      minuteCreated: 0,
      loanAmountTotal: quote.buildCost * 0.8,
      loanAmountLeft: quote.buildCost * 0.6,
      loanMonthlyPayment: 2000,
      interestRate: 0.05,
      lifetimeWh: 1e6,
      lifetimePotentialWh: 2e6,
      lifetimeRevenue: 10000,
      lifetimeExpenses: 2000,
    };
    game.facilities.push(facility);
  }
  currentTick(game)!.storedWh = 50e6;
  expect(assignTerritoryTiles(game)).toBe(true);
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 15;
  for (const facility of raw.game.facilities) delete facility.tileId;
  return { game, raw };
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
it("migrates schema15 generator and storage placements without changing finances, energy, progress or resumed simulation", () => {
  const { game, raw } = retainedStorageSave();
  const untouched = JSON.stringify(raw);
  const migrated = parseSave(raw)!;
  expect(migrated).not.toBeNull();
  expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  expect(JSON.stringify(raw)).toBe(untouched);
  expect(currentTick(migrated.game)!.cash).toBe(currentTick(game)!.cash);
  expect(currentTick(migrated.game)!.storedWh).toBe(50e6);
  expect(migrated.game.date).toEqual(game.date);
  expect(migrated.game.objectiveProgress).toEqual(game.objectiveProgress);
  expect(migrated.game.meaningfulDecisions).toEqual(game.meaningfulDecisions);
  expect(migrated.game.runIdentity).toEqual(game.runIdentity);
  expect(migrated.game.facilities).toEqual(
    raw.game.facilities.map(
      (facility: Record<string, unknown>, index: number) => ({
        ...facility,
        tileId: game.facilities[index].tileId,
      }),
    ),
  );
  expect(
    new Set(migrated.game.facilities.map(({ tileId }) => tileId)).size,
  ).toBe(game.facilities.length);
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
it.each([
  ["missing storage capacity", { peakWh: undefined }],
  ["string storage capacity", { peakWh: "50000000" }],
  ["missing power", { peakW: undefined }],
  ["string power", { peakW: "12500000" }],
  ["fractional identity", { id: 100.5 }],
  ["invalid operating cost", { annualOperatingCost: "bad" }],
])(
  "rejects schema15 storage with %s without modifying the input",
  (_label, changes) => {
    const { raw } = retainedStorageSave();
    Object.assign(
      raw.game.facilities.find(
        (facility: { id: number }) => facility.id === 100,
      ),
      changes,
    );
    const before = JSON.stringify(raw);
    expect(parseSave(raw)).toBeNull();
    expect(JSON.stringify(raw)).toBe(before);
  },
);
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

it("reports the selected tile's physical inventory and resize limit independently of the requested technology size", () => {
  const game = ready();
  const quote = wind(game);
  const tile = availableTerritoryTiles(game, quote, "champlain")[0];
  expect(
    territoryBuildAvailability(game, quote, "champlain", tile.id),
  ).toMatchObject({
    buildable: true,
    total: 1,
    remaining: 1,
    maxPeakW: tile.maxPeakW,
    tileId: tile.id,
  });
  expect(
    territoryBuildAvailability(
      game,
      { ...quote, peakW: 200e6 },
      "champlain",
      tile.id,
    ),
  ).toMatchObject({
    buildable: false,
    total: 1,
    remaining: 1,
    maxPeakW: tile.maxPeakW,
  });
  expect(
    territoryBuildAvailability(game, quote, "champlain", "champlain:city"),
  ).toMatchObject({ buildable: false, total: 0, remaining: 0, maxPeakW: 0 });
  const built = reducer(
    game,
    buildFacility({
      facility: quote,
      financed: false,
      territoryId: "champlain",
      tileId: tile.id,
    }),
  );
  expect(
    territoryBuildAvailability(built, quote, "champlain", tile.id),
  ).toMatchObject({
    buildable: false,
    total: 1,
    remaining: 0,
    maxPeakW: tile.maxPeakW,
  });
});
