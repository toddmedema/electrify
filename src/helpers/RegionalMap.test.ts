import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getRegionalGeography,
  hexRadius,
  regionalHexes,
  REGIONAL_MAP_RADIUS,
} from "../data/RegionalGeography";
import { LEGACY_SCENARIOS } from "../data/LegacyCampaign";
import { SCENARIOS } from "../data/Scenarios";
import { CHERNOBYL_SCENARIO_ID } from "../data/ChernobylScenario";
import { parseDataCenterCustomerSources } from "../data/DataCenterCustomers";
import { createGame } from "../testing/Simulator";
import type { GameType, LocationType } from "../Types";
import { createDataCenterScenario } from "./DataCenterScenario";
import { HEX_NEIGHBORS } from "./HexNeighbors";
import { getScenarioLocation } from "./Locations";
import { regionalMapViews } from "./RegionalMap";
import { isGeneralBuildingLand } from "./TerritoryTiles";

const publicData = (file: string): unknown =>
  JSON.parse(
    readFileSync(resolve(__dirname, "../../public/data", file), "utf8"),
  );
const { cities } = publicData("weather/index.json") as {
  cities: Record<string, LocationType>;
};
const customerSources = parseDataCenterCustomerSources(
  publicData("data-center-customers.json"),
);

it("has an opening city and period-correct reference for every official location", () => {
  for (const scenario of [...SCENARIOS, ...LEGACY_SCENARIOS]) {
    const location = getScenarioLocation(scenario)!;
    expect(
      getRegionalGeography(location, scenario.startingYear, scenario.id),
    ).toEqual(
      expect.objectContaining({
        city: location.name.split(",")[0],
        utility: expect.stringMatching(/\S/),
      }),
    );
  }
  const nameAt = (id: string, year: number, scenarioId = 999) =>
    getRegionalGeography(cities[id], year, scenarioId, customerSources).utility;
  expect(nameAt("SF", 1880)).toBe("San Francisco model grid");
  expect(nameAt("SJU", 2000)).toBe("Puerto Rico Electric Power Authority");
  expect(nameAt("SJU", 2026)).toBe("LUMA Energy");
  expect(nameAt("Paris", 2010)).toBe("ERDF");
  expect(nameAt("Paris", 2023)).toBe("Enedis");
  expect(nameAt("Kyiv", 1986)).toBe("Kyivenergo");
  expect(nameAt("Johannesburg", 2016, 113)).toBe("Eskom");
  expect(nameAt("Johannesburg", 2016)).toBe("City Power Johannesburg");
});

it("uses the drawn water direction and keeps local references distinct from fallback utilities", () => {
  const terrainAt = (id: string) =>
    getRegionalGeography(cities[id], 2026, 999).terrainAt;
  expect(terrainAt("SF")({ q: -5, r: 0 })).toBe("ocean");
  expect(terrainAt("SF")({ q: 5, r: 0 })).not.toBe("ocean");
  expect(terrainAt("SJU")({ q: 0, r: -5 })).toBe("ocean");
  expect(terrainAt("SJU")({ q: 0, r: 5 })).not.toBe("ocean");
  expect(terrainAt("Delhi")({ q: 1, r: 0 })).toBe("river");
  expect(terrainAt("BurlingtonVT")({ q: -1, r: 0 })).toBe("lake");
  expect(terrainAt("Tokyo")({ q: 3, r: 1 })).toBe("ocean");
  expect(terrainAt("Riyadh")({ q: 3, r: 1 })).not.toBe("ocean");
  expect(
    getRegionalGeography(cities.Sydney, 2050, 999, customerSources).utility,
  ).toMatch(/Ausgrid/);
  const arbitrary = {
    ...cities.Tokyo,
    id: "IndependentlySelected",
    name: "Example City",
  };
  expect(
    getRegionalGeography(arbitrary, 2050, 999, customerSources).utility,
  ).toBe("Example City model grid");
});

it("renders isolated inland water as lakes, including a lone edge sample", () => {
  const { terrainAt } = getRegionalGeography(cities.Manassas, 2026, 106);
  expect(terrainAt({ q: 1, r: 2 })).toBe("lake");
  expect(terrainAt({ q: 0, r: 5 })).toBe("lake");
});

it("keeps coastal water, including a clipped shore with a known offshore point", () => {
  const oslo = getRegionalGeography(cities.Oslo, 2026, 999);
  const sanFrancisco = getRegionalGeography(cities.SF, 2026, 100);
  expect(oslo.terrainAt({ q: -5, r: 5 })).toBe("ocean");
  expect(sanFrancisco.terrainAt({ q: -4, r: 0 })).toBe("ocean");
});

it.each([
  { city: "Austin", upstream: { q: -5, r: 1 }, downstream: { q: 3, r: 2 } },
  { city: "Paris", upstream: { q: -3, r: -2 }, downstream: { q: 5, r: -1 } },
  { city: "Madrid", upstream: { q: 0, r: -5 }, downstream: { q: -2, r: 5 } },
])(
  "keeps the main river connected across $city",
  ({ city, upstream, downstream }) => {
    const { terrainAt } = getRegionalGeography(cities[city], 2026, 999);
    const river = [upstream];
    const seen = new Set([`${upstream.q},${upstream.r}`]);
    for (const { q, r } of river) {
      for (const [dq, dr] of HEX_NEIGHBORS) {
        const next = { q: q + dq, r: r + dr };
        const key = `${next.q},${next.r}`;
        if (
          seen.has(key) ||
          hexRadius(next) > REGIONAL_MAP_RADIUS ||
          terrainAt(next) !== "river"
        )
          continue;
        seen.add(key);
        river.push(next);
      }
    }
    expect(terrainAt(upstream)).toBe("river");
    expect(river).toContainEqual(downstream);
  },
);

it("leaves room between river arms through the sampled region and expanded board", () => {
  const cells = regionalHexes(REGIONAL_MAP_RADIUS + 4);
  const crowded: { city: string; q: number; r: number }[] = [];
  for (const [city, location] of Object.entries(cities)) {
    const { terrainAt } = getRegionalGeography(location, 2026, 999);
    for (const { q, r } of cells) {
      if (terrainAt({ q, r }) !== "river") continue;
      const arms = HEX_NEIGHBORS.filter(
        ([dq, dr]) => terrainAt({ q: q + dq, r: r + dr }) === "river",
      );
      const sidesTouch = arms.some(([aq, ar], index) =>
        arms
          .slice(index + 1)
          .some(([bq, br]) => hexRadius({ q: aq - bq, r: ar - br }) === 1),
      );
      if (sidesTouch) crowded.push({ city, q, r });
    }
  }
  expect(crowded).toEqual([]);
});

it("gives each river reach in the sampled regions an outlet", () => {
  const cells = regionalHexes(REGIONAL_MAP_RADIUS);
  const stranded: { city: string; q: number; r: number }[] = [];
  for (const [city, location] of Object.entries(cities)) {
    const { terrainAt } = getRegionalGeography(location, 2026, 999);
    const remaining = new Set(
      cells
        .filter((cell) => terrainAt(cell) === "river")
        .map(({ q, r }) => `${q},${r}`),
    );
    for (const root of cells) {
      if (!remaining.delete(`${root.q},${root.r}`)) continue;
      const reach = [root];
      let outlet = false;
      for (const { q, r } of reach) {
        for (const [dq, dr] of HEX_NEIGHBORS) {
          const next = { q: q + dq, r: r + dr };
          const terrain = terrainAt(next);
          if (
            terrain === "lake" ||
            terrain === "ocean" ||
            (terrain === "river" && hexRadius(next) > REGIONAL_MAP_RADIUS)
          )
            outlet = true;
          if (remaining.delete(`${next.q},${next.r}`)) reach.push(next);
        }
      }
      if (!outlet) stranded.push({ city, ...root });
    }
  }
  expect(stranded).toEqual([]);
});

it("keeps the three rivers connected at Pittsburgh's confluence", () => {
  const { terrainAt } = getRegionalGeography(cities.PIT, 2026, 103);
  const confluences = regionalHexes(REGIONAL_MAP_RADIUS).filter(
    ({ q, r }) =>
      terrainAt({ q, r }) === "river" &&
      HEX_NEIGHBORS.filter(
        ([dq, dr]) => terrainAt({ q: q + dq, r: r + dr }) === "river",
      ).length === 3,
  );
  expect(confluences).toHaveLength(1);
});

it("uses researched utility names for the selected starting year", () => {
  const nameAt = (id: string, year: number) =>
    getRegionalGeography(cities[id], year, 999, customerSources).utility;
  expect(nameAt("London", 1980)).toBe("London Electricity Board");
  expect(nameAt("London", 2005)).toBe("EDF Energy Networks");
  expect(nameAt("London", 2010)).toBe("UK Power Networks");
  expect(nameAt("Vienna", 2025)).toBe("Vienna model grid");
  expect(nameAt("Vienna", 2026)).toMatch(/^Wiener Netze/);
});

it("uses the city label for an imported Havana without a local utility reference", () => {
  const location = { ...cities.Havana, region: "constructor" };
  expect(
    getRegionalGeography(location, 2026, 999, customerSources).utility,
  ).toBe("Havana model grid");
});

it("keeps every selectable city's center and renders it without a customer-source download", () => {
  for (const location of Object.values(cities)) {
    const geography = getRegionalGeography(location, 2026, 999);
    expect(geography.city).toMatch(/\S/);
    expect(geography.utility).toMatch(/\S/);
    expect(geography.terrainAt({ q: 0, r: 0 })).toBe("plains");
  }
});

it("honors offshore and hydro metadata on an embedded location without an atlas match", () => {
  const embedded = {
    ...cities.HNL,
    id: "CustomCoast",
    name: "Custom coast",
    offshore: true,
    resources: { hydro: true },
  };
  const terrainAt = getRegionalGeography(embedded, 2026, 999).terrainAt;
  const terrains = regionalHexes(5).map(terrainAt);
  expect(terrains).toEqual(expect.arrayContaining(["river", "ocean"]));
  expect(terrainAt({ q: 0, r: 0 })).toBe("plains");
});

const positions = (game: GameType) =>
  Object.fromEntries(
    regionalMapViews(game).flatMap(({ tile, facility, operatingFacility }) =>
      facility && operatingFacility ? [[operatingFacility.id, tile.id]] : [],
    ),
  );

it("keeps seeded plant positions on dispatch reorder, sale and reconstruction of the same save", () => {
  const game = createGame({ scenarioId: 106, seed: 931 });
  const beginning = positions(game);
  expect(Object.keys(beginning)).toHaveLength(game.facilities.length);
  expect(
    positions({ ...game, facilities: [...game.facilities].reverse() }),
  ).toEqual(beginning);
  expect(positions(JSON.parse(JSON.stringify(game)) as GameType)).toEqual(
    beginning,
  );
  const [sold, ...rest] = game.facilities;
  expect(positions({ ...game, facilities: rest })).toEqual(
    Object.fromEntries(
      Object.entries(beginning).filter(([id]) => Number(id) !== sold.id),
    ),
  );
  expect(positions({ ...game, seed: 1942 })).not.toEqual(beginning);
});

it("retains other dam placements when a crowded regional hydro fleet sells a plant", () => {
  const scenario = createDataCenterScenario(cities.Vienna, 2025, 5_000_000);
  const game = createGame({ scenarioId: scenario.id, scenario, seed: 123 });
  const before = positions(game);
  const retired = game.facilities.find((facility) => facility.hydroSiteId)!;
  expect(game.commissionedHydroSiteIds).toContain(retired.hydroSiteId);
  expect(
    positions({
      ...game,
      facilities: game.facilities.filter(
        (facility) => facility.id !== retired.id,
      ),
    }),
  ).toEqual(
    Object.fromEntries(
      Object.entries(before).filter(([id]) => Number(id) !== retired.id),
    ),
  );
});

it("projects real facilities, reserves their cells and connects them to the city", () => {
  const game = createGame({ scenarioId: 106, seed: 931 });
  const views = regionalMapViews(game);
  const city = views.find((view) => view.tile.city)!;
  expect(city.tile.city?.name).toBe("Manassas");
  expect(city.owned).toBe(true);
  expect(city.ownerName).toBe("City of Manassas Electric Department");
  const developed = new Set(
    views
      .filter((view) => view.developed)
      .map(({ tile }) => `${tile.q}:${tile.r}`),
  );
  const reachable = new Set(["0:0"]);
  for (const coordinate of reachable) {
    const [q, r] = coordinate.split(":").map(Number);
    for (const [dq, dr] of HEX_NEIGHBORS) {
      const next = `${q + dq}:${r + dr}`;
      if (developed.has(next)) reachable.add(next);
    }
  }
  expect(reachable).toEqual(developed);
  expect(
    views
      .filter((view) => view.operatingFacility)
      .map((view) => view.operatingFacility),
  ).toEqual(expect.arrayContaining(game.facilities));
  expect(views.filter((view) => view.connectable)).toHaveLength(0);
  expectConnectedBuildSites(game);
});

function expectConnectedBuildSites(game: GameType) {
  const views = regionalMapViews(game);
  const city = views.find(({ tile }) => tile.city)!;
  const developed = new Set(
    views
      .filter((view) => view.developed && view.owned && !view.connection)
      .map(({ tile }) => `${tile.q}:${tile.r}`),
  );
  const reachable = new Set([`${city.tile.q}:${city.tile.r}`]);
  for (const key of reachable) {
    const [q, r] = key.split(":").map(Number);
    for (const [dq, dr] of HEX_NEIGHBORS) {
      const next = `${q + dq}:${r + dr}`;
      if (developed.has(next)) reachable.add(next);
    }
  }
  const available = views.filter(({ buildSite }) => buildSite);
  expect(available.length).toBeGreaterThanOrEqual(2);
  for (const { tile, reserved, operatingFacility } of available) {
    expect(reachable.has(`${tile.q}:${tile.r}`)).toBe(true);
    expect(reserved || !!operatingFacility).toBe(false);
    expect(isGeneralBuildingLand(tile)).toBe(true);
  }
}

it("starts every regional map with two vacant connected sites even without a fleet", () => {
  const game = createGame({ scenarioId: 106, seed: 931 });
  const empty = { ...game, facilities: [], commissionedHydroSiteIds: [] };
  for (const location of Object.values(cities))
    expectConnectedBuildSites({ ...empty, location });
});

it("keeps two connected sites with a dense fleet or a Data Center start", () => {
  const scenario = createDataCenterScenario(cities.HNL, 2025, 5_000_000);
  const game = createGame({ scenarioId: scenario.id, scenario, seed: 931 });
  expectConnectedBuildSites(game);
  const existingPlant = game.facilities.find(({ name }) => name === "Solar")!;
  expectConnectedBuildSites({
    ...game,
    facilities: Array.from({ length: 105 }, (_, index) => ({
      ...existingPlant,
      id: index + 1,
    })),
  });
});

it("also provides two connected sites in the opening Legacy generation", () => {
  expectConnectedBuildSites(createGame({ scenarioId: 117, seed: 931 }));
});

it("keeps all four historical reactors on adjacent, distinct plots north of Kyiv", () => {
  const game = createGame({ scenarioId: CHERNOBYL_SCENARIO_ID, seed: 931 });
  const views = regionalMapViews(game);
  const units = views.filter(({ operatingFacility }) =>
    operatingFacility?.startingAssetId?.startsWith("chernobyl-unit-"),
  );
  expect(units).toHaveLength(4);
  expect(new Set(units.map(({ tile }) => tile.id)).size).toBe(4);
  expect(Math.max(...units.map(({ tile }) => tile.r))).toBeLessThan(0);
  expect(units.filter(({ tile }) => tile.terrain === "plains")).toHaveLength(4);
  expect(regionalHexes(5)).toHaveLength(91);
});
