import cloneDeep from "lodash.clonedeep";
import type { TerrainType, TerritoryTileId } from "../Types";
import reducer, { buildFacility, tickState } from "../reducers/Game";
import { acquireTile } from "../reducers/GameActions";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import { acquisitionAssets } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { tilePrice, tilePurchaseQuote } from "../helpers/Territories";
import { territoryTileViews } from "../helpers/TerritoryMapState";
import { getTerrainWindOutputFactor } from "../helpers/TerrainModifiers";
import { facilityOnTile } from "../helpers/TerritoryTiles";
import { getBuildFacilityQuote } from "./Facilities";
import { getAuthoredTerritoryTile, TERRITORY_TILES } from "./TerritoryTiles";
import { UTILITY_AREAS } from "./UtilityExpansion";

// The published terrain and the bounded Champlain Valley refinement. Keep this
// historical fixture independent of the current data to exercise retained saves.
const terrainChanges: readonly [TerritoryTileId, TerrainType, TerrainType][] = [
  ["champlain:site-1", "plains", "plains"],
  ["champlain:site-2", "forest", "plains"],
  ["champlain:site-3", "hills", "plains"],
  ["champlain:site-4", "mountain", "plains"],
  ["champlain:site-5", "plains", "plains"],
  ["champlain:site-6", "forest", "plains"],
  ["champlain:site-7", "hills", "plains"],
  ["champlain:site-12", "hills", "plains"],
  ["champlain:site-13", "forest", "plains"],
  ["green-uplands:site-2", "hills", "plains"],
  ["green-uplands:site-3", "mountain", "plains"],
  ["green-uplands:site-6", "hills", "plains"],
  ["valley-electric:site-3", "hills", "mountain"],
  ["valley-electric:site-8", "plains", "mountain"],
  ["ridge-electric:site-10", "forest", "mountain"],
];

function withPublishedTerrain<T>(run: () => T): T {
  const previous = terrainChanges.map(([id, terrain]) => {
    const tile = getAuthoredTerritoryTile(id)!;
    const current = tile.terrain;
    tile.terrain = terrain;
    return { tile, current };
  });
  try {
    return run();
  } finally {
    for (const { tile, current } of previous) tile.terrain = current;
  }
}

it("keeps city IDs stable with Vermont settlements in geographic order and population tiers", () => {
  expect(
    TERRITORY_TILES.filter(({ city }) => city).map(({ id, q, r, city }) => [
      id,
      q,
      r,
      city!.name,
      city!.size,
    ]),
  ).toEqual([
    ["champlain:city", -1, -3, "Burlington", "large"],
    ["valley-electric:city", 0, -4, "Winooski", "small"],
    ["ridge-electric:city", 0, -1, "Williston", "medium"],
    ["parcel-1:city", -4, 2, "Vergennes", "small"],
    ["parcel-5:city", 4, 2, "Waterbury", "small"],
    ["parcel-9:city", 1, 3, "Bristol", "small"],
    ["parcel-11:city", -4, 3, "Middlebury", "medium"],
  ]);
});

it("places western lowlands and eastern rising ground explicitly while preserving inherited wind and water", () => {
  for (const [id, , terrain] of terrainChanges)
    expect(getAuthoredTerritoryTile(id)).toMatchObject({ id, terrain });
  for (const id of ["champlain:site-0", "champlain:site-14"])
    expect(getAuthoredTerritoryTile(id)?.terrain).toBe("lake");
  expect(getAuthoredTerritoryTile("valley-electric:city")?.terrain).toBe(
    "river",
  );
  expect(getAuthoredTerritoryTile("valley-electric:site-0")?.terrain).toBe(
    "river",
  );
  for (const id of ["champlain:site-8", "ridge-electric:site-5"])
    expect(getAuthoredTerritoryTile(id)).toMatchObject({ terrain: "hills" });
  for (const id of ["green-uplands:site-1", "green-uplands:site-5"])
    expect(getAuthoredTerritoryTile(id)?.terrain).toBe("forest");
  expect(TERRITORY_TILES.some(({ terrain }) => terrain === "ocean")).toBe(
    false,
  );
});

it("keeps the complete opening state, demand, inherited acquisition assets and visible owners unchanged", () => {
  const opening = () => {
    const game = createGame({ scenarioId: 116, seed: 12345 });
    return {
      game,
      acquired: [
        acquisitionAssets(game, "valley-electric"),
        acquisitionAssets(game, "ridge-electric"),
      ],
      owners: territoryTileViews(game).map(({ tile, ownerKey }) => [
        tile.id,
        ownerKey,
      ]),
    };
  };
  const published = withPublishedTerrain(opening);
  expect(opening()).toEqual(published);
  expect(currentTick(published.game)!.demandW).toBeGreaterThan(0);
  expect(
    Object.values(UTILITY_AREAS).map(({ customers }) => customers),
  ).toEqual([90000, 159000, 50000]);
});

it.each(["Wind", "Solar", "Biomass"] as const)(
  "uses the refined geography in canonical %s quotes",
  (name) => {
    const game = createGame({ scenarioId: 116, seed: 12345 });
    for (const [id, oldCost, newCost] of [
      ["green-uplands:site-2", 1.1, 1],
      ["green-uplands:site-3", 1.2, 1],
      ["valley-electric:site-8", 1, 1.2],
    ] as const) {
      const territoryId = getAuthoredTerritoryTile(id)!.territoryId;
      const quote = () =>
        getBuildFacilityQuote(game, { name, peakW: 20e6 }, territoryId, id)!;
      const published = withPublishedTerrain(quote);
      const refined = quote();
      expect(refined).toBeDefined();
      expect(refined.buildCost).toBeCloseTo(
        (published.buildCost * newCost) / oldCost,
        5,
      );
      expect(refined.capacityFactor === published.capacityFactor).toBe(
        name !== "Wind",
      );
    }
  },
);

it("restores parcel-priced saves built on the published terrain and resumes reproducibly", () => {
  const retained = withPublishedTerrain(() => {
    let game = createGame({ scenarioId: 116, seed: 12345 });
    currentTick(game)!.cash = 3e9;
    for (const [tileId, name, financed] of [
      ["green-uplands:site-2", "Wind", true],
      ["green-uplands:site-3", "Solar", false],
    ] as const) {
      const purchase = tilePurchaseQuote(game, tileId)!;
      expect(purchase).toBeDefined();
      game = cloneDeep(
        reducer(game, acquireTile({ tileId, quoteKey: purchase.quoteKey })),
      );
      // The published terrain predates distance-based pricing.
      const receipt = game.territoryNetwork!.tilePurchases!.at(-1)!;
      const price = tilePrice(game, receipt.minute, tileId);
      currentTick(game)!.cash += receipt.price - price;
      receipt.price = price;
      delete receipt.connectionDistance;
      const quote = getBuildFacilityQuote(
        game,
        { name, peakW: 20e6 },
        "green-uplands",
        tileId,
      )!;
      game = cloneDeep(
        reducer(
          game,
          buildFacility({
            facility: quote,
            territoryId: "green-uplands",
            tileId,
            financed,
          }),
        ),
      );
      expect(facilityOnTile(game, tileId)?.name).toBe(name);
    }
    const wind = facilityOnTile(game, "green-uplands:site-2")!;
    const oldWindFactor = getTerrainWindOutputFactor(game, wind, 20);
    // Retain real in-progress construction and its outstanding financed balance.
    tickState(game);
    return {
      raw: JSON.parse(
        JSON.stringify({ ...serializeSave(game), schemaVersion: 19 }),
      ),
      oldWindFactor,
    };
  });
  const untouched = JSON.stringify(retained.raw);
  const loaded = parseSave(retained.raw);
  expect(loaded).not.toBeNull();
  expect(JSON.stringify(retained.raw)).toBe(untouched);
  const restored = loaded!.game;
  expect(restored).toEqual(retained.raw.game);
  expect(restored.territoryNetwork!.tilePurchases).toHaveLength(2);
  const wind = facilityOnTile(restored, "green-uplands:site-2")!;
  expect(wind.loanAmountLeft).toBeGreaterThan(0);
  expect(wind.yearsToBuildLeft).toBeGreaterThan(0);
  expect(getTerrainWindOutputFactor(restored, wind, 20)).toBeLessThan(
    retained.oldWindFactor,
  );
  const currentQuote = getBuildFacilityQuote(
    restored,
    wind,
    "green-uplands",
    wind.tileId,
  )!;
  expect(wind.buildCost).toBeCloseTo(currentQuote.buildCost * 1.1, 5);
  const resumed = parseSave(
    JSON.parse(JSON.stringify(serializeSave(restored))),
  )!.game;
  expect(resumed).toEqual(restored);
  for (let tick = 0; tick < 8; tick++) {
    tickState(restored);
    tickState(resumed);
  }
  expect(resumed).toEqual(restored);
  expect(restored.facilities.map(({ tileId }) => tileId)).toEqual(
    retained.raw.game.facilities.map(
      ({ tileId }: { tileId: string }) => tileId,
    ),
  );
  expect(restored.territoryNetwork).toEqual(retained.raw.game.territoryNetwork);
});
