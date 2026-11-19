import cloneDeep from "lodash.clonedeep";
import { GENERATORS, STORAGE } from "../data/Facilities";
import type { TerritoryTileDefinition } from "../data/TerritoryTiles";
import { createGame } from "../testing/Simulator";
import reducer, { buildFacility } from "../reducers/Game";
import { acquireTile } from "../reducers/GameActions";
import { parseSave, serializeSave } from "../SaveGame";
import { currentTick } from "./GameSelectors";
import { projectSiteQuote, selectProject } from "./ProjectBuild";
import { territoryBuildAvailability, tilePurchaseQuotes } from "./Territories";
import {
  assignTerritoryTiles,
  facilityOnTile,
  getTerritoryTile,
  territoryTileInventory,
  territoryTilePowerLimit,
  tileFitsFacility,
} from "./TerritoryTiles";

const ordinary: TerritoryTileDefinition = {
  id: "champlain:site-12",
  territoryId: "champlain",
  q: -3,
  r: -1,
  terrain: "plains",
  siteKind: "open-land",
  maxPeakW: 40e6,
};

it.each([
  ["plains", 150, 300, 1000],
  ["forest", 75, 200, 600],
  ["hills", 100, 450, 750],
  ["mountain", 25, 450, 400],
] as const)(
  "bounds %s solar, wind and compact projects at their exact terrain allowances",
  (terrain, solar, wind, compact) => {
    const tile = { ...ordinary, terrain };
    expect(territoryTilePowerLimit(tile)).toBe(Math.max(wind, compact) * 1e6);
    for (const [fuel, mw] of [
      ["Sun", solar],
      ["Wind", wind],
      ["Airborne Wind", wind],
      ["Natural Gas", compact],
      ["Uranium", compact],
      ["Geothermal", compact],
    ] as const) {
      expect(territoryTilePowerLimit(tile, { fuel })).toBe(mw * 1e6);
      const technology = {
        fuel,
        ...(fuel === "Geothermal" ? { name: "Enhanced Geothermal" } : {}),
      };
      expect(tileFitsFacility(tile, { ...technology, peakW: mw * 1e6 })).toBe(
        true,
      );
      expect(
        tileFitsFacility(tile, { ...technology, peakW: mw * 1e6 + 1 }),
      ).toBe(false);
    }
    expect(territoryTilePowerLimit(tile, { peakWh: 1 })).toBe(compact * 1e6);
  },
);

it.each([NaN, Infinity, -Infinity, -1, 0])(
  "rejects invalid target power %p even for a retained placement",
  (peakW) => {
    expect(tileFitsFacility(ordinary, { fuel: "Sun", peakW })).toBe(false);
    expect(tileFitsFacility(ordinary, { fuel: "Sun", peakW }, true)).toBe(
      false,
    );
    expect(tileFitsFacility(ordinary, { peakWh: peakW, peakW: 1 })).toBe(false);
  },
);

function readyMountain() {
  const initial = createGame({ scenarioId: 116, seed: 61 });
  currentTick(initial)!.cash = 8e9;
  const connection = [...tilePurchaseQuotes(initial).values()].find((quote) => {
    const tile = getTerritoryTile(quote.tileId)!;
    return tile.terrain === "mountain" && tile.siteKind === "general";
  })!;
  expect(connection).toBeDefined();
  const game = cloneDeep(
    reducer(
      initial,
      acquireTile({ tileId: connection.tileId, quoteKey: connection.quoteKey }),
    ),
  );
  const tile = getTerritoryTile(connection.tileId)!;
  expect(territoryTileInventory(game, tile.id)).toMatchObject({
    remaining: 1,
    maxPeakW: 450e6,
  });
  return { game, tile };
}

it("accepts 25 MW mountain solar and rejects one watt more through project review and the reducer", () => {
  const { game, tile } = readyMountain();
  for (const [peakW, buildable] of [
    [25e6, true],
    [25e6 + 1, false],
  ] as const) {
    const solar = GENERATORS(game, peakW, [], []).find(
      ({ name }) => name === "Solar",
    )!;
    expect(
      territoryBuildAvailability(game, solar, tile.territoryId, tile.id),
    ).toMatchObject({ buildable, maxPeakW: 25e6, remaining: 1 });
    expect(
      !!projectSiteQuote(game, selectProject(solar), tile.id).facility,
    ).toBe(buildable);
    const built = reducer(
      game,
      buildFacility({
        facility: solar,
        financed: false,
        territoryId: tile.territoryId,
        tileId: tile.id,
      }),
    );
    expect(!!facilityOnTile(built, tile.id)).toBe(buildable);
    expect(built === game).toBe(!buildable);
  }
});

it("converts storage energy to canonical power before applying the spatial cap", () => {
  const { game, tile } = readyMountain();
  const future = { ...game, date: { ...game.date, year: 2035 } };
  for (const [peakWh, buildable] of [
    [1600e6, true],
    [1600e6 + 4, false],
  ] as const) {
    const battery = STORAGE(future, peakWh).find(
      ({ name }) => name === "Battery",
    )!;
    expect(battery.peakW).toBe(peakWh / 4);
    expect(battery.peakWh).toBeLessThan(battery.maxPeakWh);
    expect(
      territoryBuildAvailability(future, battery, tile.territoryId, tile.id),
    ).toMatchObject({ buildable, maxPeakW: 400e6 });
    const built = reducer(
      future,
      buildFacility({
        facility: battery,
        financed: false,
        territoryId: tile.territoryId,
        tileId: tile.id,
      }),
    );
    expect(!!facilityOnTile(built, tile.id)).toBe(buildable);
  }
});

it("builds enhanced geothermal on ordinary land without consuming a named geothermal site", () => {
  const { game, tile } = readyMountain();
  const future = { ...game, date: { ...game.date, year: 2035 } };
  const geothermal = GENERATORS(future, 400e6, [], []).find(
    ({ name }) => name === "Enhanced Geothermal",
  )!;
  expect(tileFitsFacility(tile, geothermal)).toBe(true);
  expect(tileFitsFacility(tile, { ...geothermal, peakW: 400e6 + 1 })).toBe(
    false,
  );
  const built = reducer(
    future,
    buildFacility({
      facility: geothermal,
      financed: false,
      territoryId: tile.territoryId,
      tileId: tile.id,
    }),
  );
  expect(facilityOnTile(built, tile.id)?.name).toBe("Enhanced Geothermal");
  expect(tileFitsFacility(tile, { fuel: "Geothermal", peakW: 20e6 })).toBe(
    false,
  );
});

it("retains a previously purchased oversized frontier plant without granting a new oversized build", () => {
  const { game, tile } = readyMountain();
  const solar = GENERATORS(game, 25e6, [], []).find(
    ({ name }) => name === "Solar",
  )!;
  const built = reducer(
    game,
    buildFacility({
      facility: solar,
      financed: false,
      territoryId: tile.territoryId,
      tileId: tile.id,
    }),
  );
  const raw = JSON.parse(JSON.stringify(serializeSave(built)));
  const retained = raw.game.facilities.find(
    (facility: { tileId?: string }) => facility.tileId === tile.id,
  );
  retained.peakW = 100e6;
  const loaded = parseSave(raw)!.game;
  expect(facilityOnTile(loaded, tile.id)).toEqual(retained);
  const reassigned = cloneDeep(loaded);
  expect(assignTerritoryTiles(reassigned)).toBe(true);
  expect(reassigned.facilities).toEqual(loaded.facilities);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(loaded))))!.game,
  ).toEqual(loaded);
  expect(tileFitsFacility(tile, retained)).toBe(false);
  const vacant = {
    ...loaded,
    facilities: loaded.facilities.filter(({ id }) => id !== retained.id),
  };
  expect(
    territoryBuildAvailability(
      vacant,
      { ...solar, peakW: retained.peakW },
      tile.territoryId,
      tile.id,
    ),
  ).toMatchObject({ buildable: false, maxPeakW: 25e6 });
});
