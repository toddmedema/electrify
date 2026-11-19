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
  tilePurchaseQuote,
  tilePurchaseQuotes,
  purchaseTile,
} from "./Territories";
import {
  assignTerritoryTiles,
  availableTerritoryTiles,
  facilityOnTile,
  getFacilityTile,
  getTerritoryTiles,
  getTerritoryTile,
  ownsTerritoryTile,
  tileFitsFacility,
  territoryHexDistance,
} from "./TerritoryTiles";
import * as tileCatalogue from "./TerritoryTiles";
import { territoryTileViews } from "./TerritoryMapState";
import { acquisitionQuote, transferUtility } from "./Expansion";
import {
  isStorage,
  type GameType,
  type StorageOperatingType,
  type TerritoryTileId,
} from "../Types";

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
  delete raw.game.territoryNetwork.legacyTiles;
  for (const facility of raw.game.facilities) delete facility.tileId;
  return { game, raw };
}
it("authors distinct terrain cells with exactly one city or construction site each", () => {
  expect(TERRITORY_TILES).toHaveLength(76);
  expect(new Set(TERRITORY_TILES.map(({ id }) => id)).size).toBe(76);
  expect(new Set(TERRITORY_TILES.map(({ q, r }) => `${q},${r}`)).size).toBe(76);
  expect(new Set(TERRITORY_TILES.map(({ terrain }) => terrain))).toEqual(
    new Set(["plains", "forest", "hills", "mountain", "river", "lake"]),
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
  "champlain:site-4",
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
it("retains the territory build API while requiring each new physical cell to be bought", () => {
  let game = ready();
  for (let index = 0; index < 7; index++) {
    const next = landPurchaseQuote(game)!;
    expect(
      purchaseLand(game, {
        territoryId: next.territoryId,
        quoteKey: next.quoteKey,
      }),
    ).toBe(true);
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
  }
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
  delete raw.game.territoryNetwork.legacyTiles;
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
  expect(
    restored.game.facilities.every(({ tileId }) =>
      ownsTerritoryTile(restored.game, tileId!),
    ),
  ).toBe(true);
  const current = JSON.parse(JSON.stringify(serializeSave(game)));
  const oils = current.game.facilities.filter(
    (facility: { fuel: string }) => facility.fuel === "Oil",
  );
  oils[0].tileId = oils[1].tileId;
  expect(parseSave(current)).toBeNull();
  oils[0].tileId = "champlain:city";
  expect(parseSave(current)).toBeNull();
});

it("reports a resource tile's physical inventory and resize limit independently of the requested technology size", () => {
  const game = ready();
  const tile = getTerritoryTile("parcel-7:site-0")!;
  const territoryId = tile.territoryId;
  game.territoryNetwork!.tilePurchases!.push({
    tileId: tile.id,
    minute: 0,
    price: 16e6,
  });
  const quote = GENERATORS(
    game,
    tile.maxPeakW!,
    [20],
    [500],
    [],
    [],
    territoryId,
    tile.id,
  ).find(({ name }) => name === "Hydro")!;
  expect(
    territoryBuildAvailability(game, quote, territoryId, tile.id),
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
      territoryId,
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
      territoryId,
      tileId: tile.id,
    }),
  );
  expect(
    territoryBuildAvailability(built, quote, territoryId, tile.id),
  ).toMatchObject({
    buildable: false,
    total: 1,
    remaining: 0,
    maxPeakW: tile.maxPeakW,
  });
});

it("retains stable legacy property and its empty tower after an earlier plant is sold", () => {
  const raw = JSON.parse(JSON.stringify(serializeSave(ready())));
  raw.schemaVersion = 16;
  delete raw.game.territoryNetwork.legacyTiles;
  delete raw.game.territoryNetwork.tilePurchases;
  const oil = raw.game.facilities.find(
    (plant: { fuel: string }) => plant.fuel === "Oil",
  );
  for (const id of [100, 101])
    raw.game.facilities.push({
      ...oil,
      id,
      startingAssetId: undefined,
      tileId: `champlain:legacy-${id}`,
    });
  let game = parseSave(raw)!.game;
  const first = getTerritoryTile("champlain:legacy-100", game)!;
  const second = getTerritoryTile("champlain:legacy-101", game)!;
  expect(first).toMatchObject({ q: 6, r: -4 });
  expect(second).toMatchObject({ q: 7, r: -4 });
  game = cloneDeep(reducer(game, sellFacility(100)));
  expect(getTerritoryTile(second.id, game)).toEqual(second);
  expect(
    territoryTileViews(game).find(({ tile }) => tile.id === first.id),
  ).toMatchObject({ owned: true, developed: true, facility: undefined });
  expect(tilePurchaseQuote(game, "frontier:6:-4")).toBeUndefined();
  const resumed = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(getTerritoryTile(first.id, resumed)).toEqual(first);
  expect(getTerritoryTile(second.id, resumed)).toEqual(second);
  const replacement = GENERATORS(resumed, 20e6, [20], [500]).find(
    ({ name }) => name === "Natural Gas CC",
  )!;
  const rebuilt = reducer(
    resumed,
    buildFacility({
      facility: replacement,
      financed: false,
      territoryId: first.territoryId,
      tileId: first.id,
    }),
  );
  expect(facilityOnTile(rebuilt, first.id)?.name).toBe("Natural Gas CC");
  expect(getTerritoryTile(second.id, rebuilt)).toEqual(second);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(rebuilt)))),
  ).not.toBeNull();
  const forged = JSON.parse(JSON.stringify(serializeSave(resumed)));
  forged.game.territoryNetwork.tilePurchases.push({
    tileId: "frontier:6:-4",
    minute: 0,
    price: 3e6,
  });
  expect(parseSave(forged)).toBeNull();
});

it("checks locked catalogue tiles directly without enumerating the frontier", () => {
  const game = ready();
  const quote = wind(game);
  const tile = availableTerritoryTiles(game, quote, "champlain")[0];
  const catalogue = jest
    .spyOn(tileCatalogue, "availableTerritoryTiles")
    .mockImplementation(() => {
      throw new Error("explicit tile must not enumerate the frontier");
    });
  try {
    expect(
      territoryBuildAvailability(game, quote, "champlain", tile.id),
    ).toMatchObject({ buildable: true, tileId: tile.id, remaining: 1 });
  } finally {
    catalogue.mockRestore();
  }
});

it("freezes overflow footprints while assigning a current starting fleet", () => {
  const game = ready();
  const oil = game.facilities.find((plant) => plant.fuel === "Oil")!;
  for (let id = 100; id < 112; id++)
    game.facilities.push({
      ...oil,
      id,
      startingAssetId: undefined,
      tileId: undefined,
    });
  expect(assignTerritoryTiles(game)).toBe(true);
  expect(game.territoryNetwork!.legacyTiles!.length).toBeGreaterThan(0);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
});

it.each(["missing", "empty", "moved", "duplicate", "invalid capacity"])(
  "rejects %s retained property descriptors in a current save",
  (change) => {
    const raw = JSON.parse(JSON.stringify(serializeSave(ready())));
    raw.schemaVersion = 16;
    delete raw.game.territoryNetwork.legacyTiles;
    delete raw.game.territoryNetwork.tilePurchases;
    const oil = raw.game.facilities.find(
      (plant: { fuel: string }) => plant.fuel === "Oil",
    );
    raw.game.facilities.push({
      ...oil,
      id: 100,
      startingAssetId: undefined,
      tileId: "champlain:legacy-100",
    });
    const migrated = parseSave(raw)!;
    expect(migrated).not.toBeNull();
    const current = JSON.parse(JSON.stringify(serializeSave(migrated.game)));
    const state = current.game.territoryNetwork;
    if (change === "missing") delete state.legacyTiles;
    if (change === "empty") state.legacyTiles = [];
    if (change === "moved") state.legacyTiles[0].q = -4;
    if (change === "duplicate")
      state.legacyTiles.push({ ...state.legacyTiles[0] });
    if (change === "invalid capacity") state.legacyTiles[0].maxPeakW = -1;
    expect(parseSave(current)).toBeNull();
  },
);

it("retains Enhanced Geothermal on its paid named site without permitting a new incompatible build", () => {
  const game = ready();
  tickState(game);
  const tile = TERRITORY_TILES.find((tile) => tile.siteKind === "geothermal")!;
  for (let step = 0; !ownsTerritoryTile(game, tile) && step < 30; step++) {
    const next = [...tilePurchaseQuotes(game).values()].sort(
      (a, b) =>
        territoryHexDistance(getTerritoryTile(a.tileId)!, tile) -
        territoryHexDistance(getTerritoryTile(b.tileId)!, tile),
    )[0];
    expect(
      purchaseTile(game, { tileId: next.tileId, quoteKey: next.quoteKey }),
    ).toBe(true);
  }
  expect(ownsTerritoryTile(game, tile)).toBe(true);
  const quote = GENERATORS(
    { ...game, date: { ...game.date, year: 2030 } },
    10e6,
    [],
    [],
  ).find(({ name }) => name === "Enhanced Geothermal")!;
  const template = game.facilities[0];
  if (isStorage(template)) throw new Error("Expected an opening generator");
  const facility = {
    ...template,
    ...quote,
    id: 100,
    minuteCreated: game.date.minute,
    territoryId: tile.territoryId,
    tileId: tile.id,
    startingAssetId: undefined,
    hydroSiteId: undefined,
    gasCycle: undefined,
    resilience: undefined,
    constructionKgco2eTotal: 0,
    constructionKgco2eEmitted: 0,
  };
  game.facilities.push(facility);
  expect(tileFitsFacility(tile, facility)).toBe(false);
  expect(tileFitsFacility(tile, facility, true)).toBe(true);
  expect(assignTerritoryTiles(game)).toBe(true);
  const parsed = parseSave(serializeSave(game));
  expect(parsed).not.toBeNull();
  expect(
    parsed!.game.facilities.find(({ id }) => id === facility.id)?.tileId,
  ).toBe(tile.id);
  const ordinaryLand = TERRITORY_TILES.find(
    (candidate) => candidate.siteKind === "open-land",
  )!;
  expect(tileFitsFacility(ordinaryLand, facility)).toBe(true);
  expect(
    tileFitsFacility(tile, { ...facility, name: "Solar", fuel: "Sun" }, true),
  ).toBe(false);
});
