import cloneDeep from "lodash.clonedeep";
import { GENERATORS, getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import { getHydroAvailability } from "../data/HydroSites";
import { createGame } from "../testing/Simulator";
import reducer, {
  buildFacility,
  generateForecastTimeline,
  generateNewTimeline,
  previewFacilityBuild,
  tickState,
  sellFacility,
} from "../reducers/Game";
import { modScenario } from "../mods/ModScenario";
import type {
  GameType,
  TerrainType,
  TerritoryTileId,
  LegacyTerritoryTile,
} from "../Types";
import { isStorage } from "../Types";
import { getWindOutputFactor, getOffshoreWindOutputFactor } from "./Energy";
import { currentTick } from "./GameSelectors";
import { LCWH, purchaseTerms } from "./Financials";
import { withResilienceOptions } from "./Hazards";
import {
  getTerrainModifiers,
  getTerrainWindOutputFactor,
} from "./TerrainModifiers";
import { territoryBuildAvailability } from "./Territories";
import { acquisitionAssets } from "./Expansion";
import { parseSave, serializeSave } from "../SaveGame";

// Exercise the full modifier matrix independently of the authored regional map.
// The geography suite checks the real lowland/ridge placements separately.
const terrainFixture = [
  ["green-uplands:site-2", "hills"],
  ["green-uplands:site-3", "mountain"],
] as const;
let authoredTerrains: TerrainType[];
beforeEach(() => {
  authoredTerrains = terrainFixture.map(([id, terrain]) => {
    const tile = TERRITORY_TILES.find((candidate) => candidate.id === id)!;
    const authored = tile.terrain;
    tile.terrain = terrain;
    return authored;
  });
});
afterEach(() => {
  terrainFixture.forEach(([id], index) => {
    TERRITORY_TILES.find((candidate) => candidate.id === id)!.terrain =
      authoredTerrains[index];
  });
});

function fixture() {
  const game = createGame({ scenarioId: 116, seed: 12345 });
  currentTick(game)!.cash = 1e12;
  game.territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: 18e6,
  });
  game.storyEffectsDisabled = true;
  game.weatherHazardsDisabled = true;
  return game;
}
function tile(terrain: TerrainType): TerritoryTileId {
  return TERRITORY_TILES.find(
    (candidate) =>
      candidate.territoryId === "green-uplands" &&
      candidate.terrain === terrain,
  )!.id;
}
function quote(
  game: GameType,
  terrain: TerrainType,
  name = "Wind",
  wind = [20],
) {
  return GENERATORS(
    game,
    50e6,
    wind,
    [500],
    [],
    [],
    "green-uplands",
    tile(terrain),
  ).find((candidate) => candidate.name === name)!;
}

it.each([
  ["plains", 1, 1, 1],
  ["forest", 0.95, 1.05, 1],
  ["hills", 1.1, 1.1, 1],
  ["mountain", 1.15, 1.2, 1.5],
  ["river", 1, 1, 1],
  ["lake", 1, 1, 1],
] as const)(
  "applies %s siting costs to all technologies and residual speed to fixed onshore wind",
  (terrain, speed, cost, time) => {
    const game = fixture();
    const tileId = TERRITORY_TILES.find(
      (candidate) => candidate.terrain === terrain && !candidate.city,
    )!.id;
    expect(getTerrainModifiers(game, "Wind", tileId)).toEqual({
      onshoreWindSpeed: speed,
      buildCost: cost,
      buildTime: time,
    });
    expect(getTerrainModifiers(game, "Sun", tileId)).toEqual({
      onshoreWindSpeed: 1,
      buildCost: cost,
      buildTime: time,
    });
    for (const fuel of [
      "Coal",
      "Hydro",
      "Geothermal",
      "Offshore Wind",
      "Airborne Wind",
      undefined,
    ] as const) {
      expect(getTerrainModifiers(game, fuel, tileId)).toEqual({
        onshoreWindSpeed: 1,
        buildCost: cost,
        buildTime: time,
      });
    }
    expect(getTerrainModifiers(game, "Wind")).toEqual({
      onshoreWindSpeed: 1,
      buildCost: 1,
      buildTime: 1,
    });
  },
);

it("applies speed before cut-in, rated output and storm cut-out rather than multiplying final watts", () => {
  const game = fixture();
  const hills = { fuel: "Wind" as const, tileId: tile("hills") };
  // Baseline is below cut-in; the exposed ridge starts producing.
  expect(getWindOutputFactor(6)).toBe(0);
  expect(getTerrainWindOutputFactor(game, hills, 6)).toBeGreaterThan(0);
  expect(getTerrainWindOutputFactor(game, hills, 20)).toBeCloseTo(0.6994949495);
  expect(getTerrainWindOutputFactor(game, hills, 40)).toBe(1);
  // Baseline is still at rated power, while the ridge has reached storm cut-out.
  expect(getWindOutputFactor(49)).toBe(1);
  expect(getTerrainWindOutputFactor(game, hills, 49)).toBe(0);
  for (const speed of [6, 20, 40, 49]) {
    expect(getTerrainWindOutputFactor(game, hills, speed)).toBe(
      getWindOutputFactor(speed * 1.1),
    );
  }
});

it.each(["forest", "hills", "mountain"] as const)(
  "uses %s local resource and price in expected output and LCOE",
  (terrain) => {
    const game = fixture();
    const wind = [6, 20, 40, 49];
    const local = quote(game, terrain, "Wind", wind);
    const baseline = quote(game, "plains", "Wind", wind);
    const modifiers = getTerrainModifiers(game, "Wind", tile(terrain));
    expect(local.buildCost).toBe(baseline.buildCost * modifiers.buildCost);
    expect(local.capacityFactor).toBe(
      wind.reduce(
        (total, speed) =>
          total +
          getTerrainWindOutputFactor(
            game,
            { fuel: "Wind", tileId: tile(terrain) },
            speed,
          ),
        0,
      ) / wind.length,
    );
    expect(local.lcWh).toBe(
      LCWH(
        local,
        game.date,
        game.feePerKgCO2e,
        game.seed,
        game.location,
        undefined,
        game.interestRate,
      ),
    );
    const solar = quote(game, terrain, "Solar");
    const flatSolar = quote(game, "plains", "Solar");
    expect(solar.buildCost).toBe(flatSolar.buildCost * modifiers.buildCost);
    expect(solar.capacityFactor).toBe(flatSolar.capacityFactor);
    expect(solar.annualOperatingCost).toBe(flatSolar.annualOperatingCost);
    expect(quote(game, terrain, "Natural Gas Peaker").buildCost).toBe(
      quote(game, "plains", "Natural Gas Peaker").buildCost *
        modifiers.buildCost,
    );
  },
);

it.each([false, true])(
  "charges the canonical selected-site price exactly once (financed=%s), including edited quotes",
  (financed) => {
    const game = fixture();
    const tileId = tile("mountain");
    const canonical = getBuildFacilityQuote(
      game,
      { name: "Wind", peakW: 50e6 },
      "green-uplands",
      tileId,
    )!;
    const cash = currentTick(game)!.cash;
    const result = reducer(
      game,
      buildFacility({
        facility: { ...canonical, buildCost: 1, yearsToBuild: 0 },
        financed,
        territoryId: "green-uplands",
        tileId,
      }),
    );
    const built = result.facilities.find(
      (facility) => facility.tileId === tileId,
    )!;
    const terms = purchaseTerms(
      canonical.buildCost,
      financed,
      game.interestRate,
    );
    expect(built.buildCost).toBe(canonical.buildCost);
    expect(built.yearsToBuildLeft).toBe(canonical.yearsToBuild);
    expect(built.loanAmountTotal).toBe(terms.loanAmount);
    expect(currentTick(result)!.cash).toBe(cash - terms.amountDue);
    expect(
      result.facilities.filter((facility) => facility.tileId === tileId),
    ).toHaveLength(1);
  },
);

it("prices solar terrain before the independently toggleable tracker add-on", () => {
  const game = fixture();
  game.date.year = 2020;
  const tileId = tile("forest");
  const raw = quote(game, "forest", "Solar");
  const tracked = withResilienceOptions(raw, game, { solarTrackers: true });
  expect(tracked.resilienceExtraBuildCost).toBeGreaterThan(0);
  const canonical = getBuildFacilityQuote(
    game,
    tracked,
    "green-uplands",
    tileId,
  )!;
  expect(canonical.buildCost).toBe(tracked.buildCost);
  const result = reducer(
    game,
    buildFacility({
      facility: tracked,
      financed: false,
      territoryId: "green-uplands",
      tileId,
    }),
  );
  const built = result.facilities.find(
    (facility) => facility.tileId === tileId,
  )!;
  expect(built.buildCost).toBe(tracked.buildCost);
  expect(built.resilience?.solarTrackers).toBe(true);
  expect(currentTick(result)!.cash).toBe(
    currentTick(game)!.cash - tracked.buildCost,
  );
  const battery = STORAGE(game, 100e6).find(
    (candidate) => candidate.name === "Battery",
  )!;
  expect(
    getBuildFacilityQuote(game, battery, "green-uplands", tileId)?.buildCost,
  ).toBeCloseTo(battery.buildCost * 1.05);
});

it("retains deterministic free-tile fallback and rejects insufficient cash before any mutation", () => {
  const game = fixture();
  const canonical = getBuildFacilityQuote(
    game,
    { name: "Wind", peakW: 50e6 },
    "green-uplands",
  )!;
  const placement = territoryBuildAvailability(
    game,
    canonical,
    "green-uplands",
  );
  const exact = getBuildFacilityQuote(
    game,
    canonical,
    "green-uplands",
    placement.tileId,
  )!;
  expect(canonical).toEqual(exact);
  currentTick(game)!.cash = canonical.buildCost - 1;
  const before = JSON.stringify(game);
  expect(
    JSON.stringify(
      reducer(
        game,
        buildFacility({
          facility: { ...canonical, buildCost: 0 },
          financed: false,
          territoryId: "green-uplands",
        }),
      ),
    ),
  ).toBe(before);
});

it("reprices build-impact preview economics while retaining its explicit commissioning-duration override", () => {
  const game = fixture();
  const canonical = { ...quote(game, "mountain"), yearsToBuild: 0 };
  const before = JSON.stringify(game);
  const expected = previewFacilityBuild(
    game,
    canonical,
    "green-uplands",
    tile("mountain"),
  );
  const edited = previewFacilityBuild(
    game,
    { ...canonical, buildCost: 1 },
    "green-uplands",
    tile("mountain"),
  );
  expect(edited).toEqual(expected);
  expect(edited.commissionedMinute).toBe(game.date.minute);
  expect(edited.after.map((tick) => tick.netWorth)).toEqual(
    expected.after.map((tick) => tick.netWorth),
  );
  expect(JSON.stringify(game)).toBe(before);
});

it("uses the same local wind owner in live ticks, simulated output and estimated-weather forecasts without changing demand", () => {
  const game = fixture();
  const source = game.facilities.find((facility) => facility.fuel === "Wind")!;
  if (isStorage(source)) throw new Error("Expected an onshore wind generator");
  game.facilities = [
    {
      ...source,
      tileId: tile("hills"),
      territoryId: "green-uplands",
      annualOutputDegradation: 0,
    },
  ];
  const before = JSON.stringify(game);
  const now = currentTick(game)!;
  for (const generate of [generateNewTimeline, generateForecastTimeline]) {
    const timeline = generate(game, now.cash, now.customers, 24, 60);
    for (const tick of timeline) {
      expect(tick.supplyByFuel.Wind).toBe(
        source.peakW *
          getTerrainWindOutputFactor(game, game.facilities[0], tick.windKph),
      );
    }
    const flat = cloneDeep(game);
    flat.facilities[0].tileId = tile("plains");
    expect(
      generate(flat, now.cash, now.customers, 24, 60).map(
        (tick) => tick.demandW,
      ),
    ).toEqual(timeline.map((tick) => tick.demandW));
  }
  expect(JSON.stringify(game)).toBe(before);
  tickState(game);
  const processed = game.timeline.find(
    (tick) => tick.supplyByFuel.Wind === game.facilities[0].currentW,
  )!;
  expect(processed).toBeDefined();
  expect(game.facilities[0].currentW).toBe(
    source.peakW *
      getTerrainWindOutputFactor(game, game.facilities[0], processed.windKph),
  );
});

it.each(["authored", "legacy"])(
  "retains installed schema17 %s inland offshore plants and their weather output without granting replacement rights",
  (placement) => {
    const game = fixture();
    const legacy: LegacyTerritoryTile = {
      id: "champlain:legacy-100",
      territoryId: "champlain",
      q: 6,
      r: -4,
      terrain: "ocean",
      siteKind: "wind",
      maxPeakW: 150e6,
    };
    if (placement === "legacy")
      game.territoryNetwork!.legacyTiles!.push(legacy);
    const water =
      placement === "legacy"
        ? legacy
        : TERRITORY_TILES.find(({ id }) => id === "champlain:site-14")!;
    game.storyEffectsDisabled = false;
    game.weatherHazardsDisabled = false;
    let prior: GameType;
    // Recreate the published schema17 geography through the real quote and reducer owners.
    water.terrain = "ocean";
    try {
      const local = GENERATORS(
        game,
        20e6,
        [20, 40],
        [],
        [],
        [],
        "champlain",
        water.id,
      ).find((candidate) => candidate.fuel === "Offshore Wind")!;
      expect(local.available).toBe(true);
      prior = cloneDeep(
        reducer(
          game,
          buildFacility({
            facility: local,
            financed: false,
            territoryId: "champlain",
            tileId: water.id,
          }),
        ),
      );
    } finally {
      if (placement === "authored") water.terrain = "lake";
    }
    const raw = JSON.parse(JSON.stringify(serializeSave(prior!)));
    raw.schemaVersion = 17;
    const unchanged = JSON.stringify(raw);
    const migrated = parseSave(raw)!.game;
    expect(JSON.stringify(raw)).toBe(unchanged);
    expect(migrated.facilities).toEqual(raw.game.facilities);
    expect(migrated.timeline).toEqual(raw.game.timeline);
    const offshore = migrated.facilities.find(
      ({ tileId }) => tileId === water.id,
    )!;
    expect(migrated.territoryNetwork!.legacyLakeOffshore).toEqual([
      { facilityId: offshore.id, tileId: water.id },
    ]);
    expect(getTerrainWindOutputFactor(migrated, offshore, 20)).toBe(
      getOffshoreWindOutputFactor(20),
    );
    expect(getTerrainWindOutputFactor(migrated, offshore, 20, 0)).toBe(0);
    expect(getTerrainWindOutputFactor(migrated, offshore, 20, 40)).toBe(
      getOffshoreWindOutputFactor(40),
    );
    expect(
      getBuildFacilityQuote(migrated, offshore, "champlain", water.id),
    ).toBeUndefined();
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(migrated))))!.game,
    ).toEqual(migrated);
    const operating = cloneDeep(migrated);
    const plant = operating.facilities.find(({ id }) => id === offshore.id)!;
    plant.yearsToBuildLeft = 0;
    operating.facilities = [plant];
    const now = currentTick(operating)!;
    const forecast = generateForecastTimeline(
      operating,
      now.cash,
      now.customers,
      12,
      60,
    );
    expect(
      forecast.some((tick) => (tick.supplyByFuel["Offshore Wind"] ?? 0) > 0),
    ).toBe(true);
    for (const tick of forecast)
      expect(tick.supplyByFuel["Offshore Wind"]).toBe(
        plant.peakW * getOffshoreWindOutputFactor(tick.windKph),
      );
    const sold = reducer(migrated, sellFacility(offshore.id));
    expect(sold.territoryNetwork!.legacyLakeOffshore).toEqual([]);
    expect(
      getBuildFacilityQuote(sold, offshore, "champlain", water.id),
    ).toBeUndefined();
  },
);

it("does not manufacture named hydro or geothermal sites from visual terrain", () => {
  const game = fixture();
  expect(
    getHydroAvailability(game, 10e6, "green-uplands", tile("mountain"))
      .selected,
  ).toBeUndefined();
  expect(
    getHydroAvailability(game, 10e6, "champlain", "champlain:site-0").selected,
  ).toBeUndefined();
  expect(quote(game, "mountain", "Geothermal").available).toBe(false);
  expect(
    territoryBuildAvailability(
      game,
      quote(game, "mountain", "Hydro"),
      "green-uplands",
      tile("mountain"),
    ).buildable,
  ).toBe(false);
});

it("keeps inherited acquisition prices and all non-116 scenarios neutral", () => {
  const game = fixture();
  const network = acquisitionAssets(game, "ridge-electric")!;
  const withoutNetwork = acquisitionAssets(
    { ...game, territoryNetwork: undefined },
    "ridge-electric",
  )!;
  expect(network.map((facility) => facility.buildCost)).toEqual(
    withoutNetwork.map((facility) => facility.buildCost),
  );
  for (const scenarioId of [0, 100, 106, 115]) {
    const other = { ...game, scenarioId };
    expect(
      GENERATORS(
        other,
        50e6,
        [20],
        [500],
        [],
        [],
        "green-uplands",
        tile("mountain"),
      ),
    ).toEqual(GENERATORS(other, 50e6, [20], [500]));
    expect(
      getTerrainWindOutputFactor(
        other,
        { fuel: "Wind", tileId: tile("mountain") },
        20,
      ),
    ).toBe(getWindOutputFactor(20));
  }
});

it("retains terrain effects in a custom package based on scenario116", () => {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "terrain-test",
    title: "Terrain",
    creator: "Test",
    version: "1",
    description: "Terrain contract",
    baseScenarioId: 116,
    seed: 12345,
  });
  const game = createGame({ scenarioId: 999, scenario });
  expect(getTerrainModifiers(game, "Wind", tile("mountain"))).toEqual({
    onshoreWindSpeed: 1.15,
    buildCost: 1.2,
    buildTime: 1.5,
  });
});
