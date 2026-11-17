import cloneDeep from "lodash.clonedeep";
import { GENERATORS, getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import reducer, { buildFacility, tickState } from "../reducers/Game";
import { currentTick } from "./GameSelectors";
import { territoryBuildAvailability } from "./Territories";
import {
  facilityOnTile,
  getTerritoryTile,
  territoryTilePowerLimit,
  tileFitsFacility,
  tileSupportsFacilityTechnology,
} from "./TerritoryTiles";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 3e9;
  return game;
}

// This ordinary opening tile originally presented as hills and incorrectly allowed only Solar.
const ordinaryId = "champlain:site-12";

it.each([
  "Solar",
  "Wind",
  "Oil",
  "Natural Gas Peaker",
  "Natural Gas CC",
  "Biomass",
  "Coal",
  "Nuclear",
])("builds %s on the opening ordinary land tile", (name) => {
  const game = ready();
  const tile = getTerritoryTile(ordinaryId)!;
  expect(tile).toMatchObject({ siteKind: "open-land" });
  expect(["plains", "forest", "hills", "mountain"]).toContain(tile.terrain);
  expect(facilityOnTile(game, tile.id)).toBeUndefined();
  const technology = GENERATORS(
    game,
    20e6,
    [20],
    [500],
    [],
    [],
    tile.territoryId,
    tile.id,
  ).find((quote) => quote.name === name)!;
  expect(technology).toBeDefined();
  expect(tileSupportsFacilityTechnology(tile, technology)).toBe(true);
  expect(
    territoryBuildAvailability(game, technology, tile.territoryId, tile.id),
  ).toMatchObject({ buildable: true, maxPeakW: Infinity, tileId: tile.id });
  const quote = getBuildFacilityQuote(
    game,
    technology,
    tile.territoryId,
    tile.id,
  )!;
  expect(quote).toBeDefined();
  const built = reducer(
    game,
    buildFacility({
      facility: technology,
      territoryId: tile.territoryId,
      tileId: tile.id,
      financed: false,
    }),
  );
  expect(facilityOnTile(built, tile.id)).toMatchObject({ name, peakW: 20e6 });
  expect(currentTick(built)!.cash).toBeCloseTo(
    currentTick(game)!.cash - quote.buildCost,
    4,
  );
});

it("treats every ordinary land category as general building land without a site power cap", () => {
  const game = ready();
  const wind = GENERATORS(game, 500e6, [20], [500]).find(
    ({ name }) => name === "Wind",
  )!;
  for (const siteKind of ["industrial", "wind", "open-land", "general"]) {
    const tile = TERRITORY_TILES.find(
      (entry) =>
        entry.siteKind === siteKind &&
        ["plains", "forest", "hills", "mountain"].includes(entry.terrain),
    )!;
    expect(tile).toBeDefined();
    expect(tileSupportsFacilityTechnology(tile, wind)).toBe(true);
    expect(territoryTilePowerLimit(tile)).toBe(Infinity);
    expect(tileFitsFacility(tile, wind)).toBe(true);
  }
  const tile = getTerritoryTile(ordinaryId)!;
  expect(
    getBuildFacilityQuote(
      game,
      { ...wind, peakW: wind.maxPeakW + 1 },
      tile.territoryId,
      tile.id,
    ),
  ).toBeUndefined();
});

it("preserves special resource requirements, resource caps and water restrictions", () => {
  const ordinary = getTerritoryTile(ordinaryId)!;
  const hydro = TERRITORY_TILES.find((tile) => tile.siteKind === "hydro")!;
  const geothermal = TERRITORY_TILES.find(
    (tile) => tile.siteKind === "geothermal",
  )!;
  const lake = getTerritoryTile("champlain:site-14")!;
  for (const fuel of ["Hydro", "Geothermal", "Offshore Wind"] as const)
    expect(tileSupportsFacilityTechnology(ordinary, { fuel })).toBe(false);
  for (const tile of [hydro, geothermal]) {
    const fuel = tile.siteKind === "hydro" ? "Hydro" : "Geothermal";
    expect(tileFitsFacility(tile, { fuel, peakW: tile.maxPeakW! })).toBe(true);
    expect(tileFitsFacility(tile, { fuel, peakW: tile.maxPeakW! + 1 })).toBe(
      false,
    );
    expect(tileSupportsFacilityTechnology(tile, { fuel: "Wind" })).toBe(false);
    expect(territoryTilePowerLimit(tile)).toBe(tile.maxPeakW);
  }
  for (const fuel of ["Wind", "Sun", "Natural Gas", "Offshore Wind"] as const)
    expect(tileSupportsFacilityTechnology(lake, { fuel })).toBe(false);
  const ocean = { ...lake, terrain: "ocean" as const };
  expect(tileFitsFacility(ocean, { fuel: "Offshore Wind", peakW: 20e6 })).toBe(
    true,
  );
  expect(tileSupportsFacilityTechnology(ocean, { fuel: "Wind" })).toBe(false);
  expect(tileSupportsFacilityTechnology(ocean, { fuel: "Sun" })).toBe(false);
  expect(territoryTilePowerLimit(ocean)).toBe(lake.maxPeakW);
});

it("keeps ownership, city, occupancy, cash, size and calendar validation at purchase time", () => {
  const game = ready();
  const tile = getTerritoryTile(ordinaryId)!;
  const wind = GENERATORS(game, 20e6, [20], [500]).find(
    ({ name }) => name === "Wind",
  )!;
  const payload = {
    facility: wind,
    financed: false,
    territoryId: tile.territoryId,
    tileId: tile.id,
  };
  const built = reducer(game, buildFacility(payload));
  expect(facilityOnTile(built, tile.id)).toBeDefined();
  expect(reducer(built, buildFacility(payload))).toEqual(built);
  expect(
    reducer(game, buildFacility({ ...payload, tileId: "champlain:city" })),
  ).toEqual(game);
  expect(
    reducer(
      game,
      buildFacility({
        ...payload,
        territoryId: "valley-electric",
        tileId: "valley-electric:site-10",
      }),
    ),
  ).toEqual(game);
  const poor = cloneDeep(game);
  currentTick(poor)!.cash = 0;
  expect(reducer(poor, buildFacility(payload))).toEqual(poor);
  expect(
    reducer(
      game,
      buildFacility({
        ...payload,
        facility: { ...wind, peakW: wind.maxPeakW + 1 },
      }),
    ),
  ).toEqual(game);
  const future = { ...game, date: { ...game.date, year: 2030 } };
  const battery = STORAGE(future, 20e6).find(({ name }) => name === "Battery")!;
  expect(tileSupportsFacilityTechnology(tile, battery)).toBe(true);
  expect(
    reducer(game, buildFacility({ ...payload, facility: battery })),
  ).toEqual(game);
});

it("round trips a new cross-category plant and resumes deterministically without changing its footprint", () => {
  const game = ready();
  const wind = GENERATORS(game, 20e6, [20], [500]).find(
    ({ name }) => name === "Wind",
  )!;
  const built = cloneDeep(
    reducer(
      game,
      buildFacility({
        facility: wind,
        financed: false,
        territoryId: "champlain",
        tileId: ordinaryId,
      }),
    ),
  );
  const loaded = parseSave(
    JSON.parse(JSON.stringify(serializeSave(built))),
  )!.game;
  expect(JSON.parse(JSON.stringify(serializeSave(loaded).game))).toEqual(
    JSON.parse(JSON.stringify(serializeSave(built).game)),
  );
  tickState(built);
  tickState(loaded);
  expect(JSON.parse(JSON.stringify(serializeSave(loaded).game))).toEqual(
    JSON.parse(JSON.stringify(serializeSave(built).game)),
  );
  expect(facilityOnTile(loaded, ordinaryId)?.name).toBe("Wind");
});
