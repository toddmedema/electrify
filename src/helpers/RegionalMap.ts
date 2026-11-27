import type {
  CitySizeType,
  FacilityOperatingType,
  FrontierTerritoryId,
  GameType,
  TerrainType,
} from "../Types";
import type { DataCenterCustomerSources } from "../data/DataCenterCustomers";
import { CHERNOBYL_SCENARIO_ID } from "../data/ChernobylScenario";
import { getHydroSite, isConventionalHydro } from "../data/HydroSites";
import {
  getRegionalGeography,
  hexRadius,
  regionalHexes,
  REGIONAL_MAP_RADIUS,
  REGIONAL_MAP_TILE_KM,
  type HexCoordinate,
  type RegionalGeography,
} from "../data/RegionalGeography";
import { territoryCoordinateHash } from "../data/Territories";
import type { TerritoryTileDefinition } from "../data/TerritoryTiles";
import { CUSTOMER_MARKET_MULTIPLIER } from "./Customers";
import { HEX_NEIGHBORS } from "./HexNeighbors";
import { cos } from "./Libm";
import { readTerritoryDisasters } from "./TerritoryDisasters";
import type { TerritoryTileView } from "./TerritoryMapState";

const HOME = { q: 0, r: 0 };
const CORE_CELLS = regionalHexes(REGIONAL_MAP_RADIUS);
const KM_PER_DEGREE = 111.195;
const distance = (a: HexCoordinate, b: HexCoordinate) =>
  hexRadius({ q: a.q - b.q, r: a.r - b.r });
const tileId = ({ q, r }: HexCoordinate): FrontierTerritoryId =>
  `frontier:${q}:${r}`;

interface Cell extends HexCoordinate {
  terrain: TerrainType;
}
type RegionalTile = TerritoryTileDefinition & {
  id: FrontierTerritoryId;
  territoryId: FrontierTerritoryId;
};

const land = ({ terrain }: Cell) =>
  terrain !== "ocean" && terrain !== "lake" && terrain !== "river";
const freshwater = ({ terrain }: Cell) =>
  terrain === "river" || terrain === "lake";

// The four historical reactors share one site northwest of the Dnipro in the Kyiv region.
// Their compressed schematic positions leave their runtime identities and dispatch untouched.
const CHERNOBYL_REACTOR_CELLS: Readonly<
  Partial<Record<string, HexCoordinate>>
> = {
  "chernobyl-unit-1": { q: -1, r: -4 },
  "chernobyl-unit-2": { q: 0, r: -4 },
  "chernobyl-unit-3": { q: -1, r: -3 },
  "chernobyl-unit-4": { q: 0, r: -3 },
};

function isChernobyl(game: Pick<GameType, "scenarioId" | "location">) {
  return (
    game.scenarioId === CHERNOBYL_SCENARIO_ID && game.location.id === "Kyiv"
  );
}

function plotNear(
  location: GameType["location"],
  lat: number,
  long: number,
): HexCoordinate {
  const latitudeKm = (location.lat - lat) * KM_PER_DEGREE;
  const longitude = ((long - location.long + 540) % 360) - 180;
  const longitudeKm =
    longitude * KM_PER_DEGREE * cos((location.lat * Math.PI) / 180);
  const r = (latitudeKm / REGIONAL_MAP_TILE_KM) * (2 / Math.sqrt(3));
  const q = longitudeKm / REGIONAL_MAP_TILE_KM - r / 2;
  const scale = Math.min(1, REGIONAL_MAP_RADIUS / hexRadius({ q, r }));
  return { q: q * scale, r: r * scale };
}

function firstSite(
  sites: readonly Cell[],
  id: number,
  available: (cell: Cell) => boolean,
  near?: HexCoordinate,
): Cell | undefined {
  if (near) {
    return sites
      .filter(available)
      .reduce<Cell | undefined>(
        (best, cell) =>
          best && distance(best, near) <= distance(cell, near) ? best : cell,
        undefined,
      );
  }
  const offset = Math.max(0, id - 1) % Math.max(1, sites.length);
  return (
    sites.slice(offset).find(available) ??
    sites.slice(0, offset).find(available)
  );
}

function growCitySize(
  game: Pick<GameType, "customerMarketSize">,
): CitySizeType {
  const customers = game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER;
  return customers < 50_000
    ? "small"
    : customers < 500_000
      ? "medium"
      : "large";
}

function layoutFor(
  game: Pick<
    GameType,
    "seed" | "location" | "scenarioId" | "commissionedHydroSiteIds"
  >,
  geography: RegionalGeography,
  facilities: readonly FacilityOperatingType[],
  citySize: CitySizeType,
) {
  const cells = new Map(
    CORE_CELLS.map((cell) => [
      tileId(cell),
      {
        ...cell,
        terrain: geography.terrainAt(cell),
      },
    ]),
  );
  const reserved = new Set([tileId(HOME)]);
  const placements = new Map<FrontierTerritoryId, FacilityOperatingType>();
  if (isChernobyl(game)) {
    for (const cell of Object.values(CHERNOBYL_REACTOR_CELLS)) {
      if (!cell) continue;
      const id = tileId(cell);
      reserved.add(id);
      cells.set(id, { ...cell, terrain: "plains" });
    }
  }

  // Each plant initially addresses its own spot in a seeded permutation, regardless of
  // dispatch order. Alternate sites are only probed if a special site or a very large fleet
  // needs the same cell. More rings append spare land and preserve the opening landscape.
  const placementSalt = `regional-plant-placement-v1:${game.location.id}:${game.seed}`;
  const shuffleRank = (cell: HexCoordinate) =>
    territoryCoordinateHash(cell.q, cell.r, placementSalt);
  let radius = REGIONAL_MAP_RADIUS;
  const plotOrder = [...cells.values()]
    .filter((cell) => !reserved.has(tileId(cell)))
    .sort(
      (a, b) =>
        Number(hexRadius(a) > 3) - Number(hexRadius(b) > 3) ||
        shuffleRank(a) - shuffleRank(b),
    );
  const ordinary = plotOrder.filter(land);
  const reservoirs = plotOrder.filter(freshwater);
  const sea = plotOrder.filter(({ terrain }) => terrain === "ocean");
  const offshoreSite =
    geography.offshore &&
    plotNear(game.location, geography.offshore.lat, geography.offshore.long);
  const available = (cell: HexCoordinate) =>
    !placements.has(tileId(cell)) && !reserved.has(tileId(cell));

  const spareLand = () => {
    if (ordinary.some(available)) return ordinary;
    radius++;
    for (const coordinates of regionalHexes(radius)) {
      if (hexRadius(coordinates) !== radius) continue;
      const extra = {
        ...coordinates,
        terrain: geography.terrainAt(coordinates),
      };
      cells.set(tileId(extra), extra);
      ordinary.push(extra);
    }
    return ordinary;
  };

  // A conventional site's reservoir remains after the plant retires. The existing
  // commissioned inventory keeps its place reserved when several dams share one direction.
  const namedHydro = new Map(
    facilities.flatMap((facility) =>
      isConventionalHydro(facility) && facility.hydroSiteId
        ? [[facility.hydroSiteId, facility] as const]
        : [],
    ),
  );
  const projectedFacilities = new Set<number>();
  for (const siteId of new Set([
    ...game.commissionedHydroSiteIds,
    ...namedHydro.keys(),
  ])) {
    const site = getHydroSite(siteId);
    if (!site) continue;
    const position = plotNear(game.location, site.lat, site.lon);
    const nearby = firstSite(reservoirs, 1, available, position);
    const cell =
      nearby && distance(nearby, position) <= 2
        ? nearby
        : {
            ...firstSite(spareLand(), 1, available, position)!,
            terrain: "lake" as const,
          };
    const id = tileId(cell);
    // Reserve the geometry itself, even when there is no operating asset.
    cells.set(id, cell);
    reserved.add(id);
    const facility = namedHydro.get(siteId);
    if (facility) {
      placements.set(id, facility);
      projectedFacilities.add(facility.id);
    }
  }

  for (const facility of facilities) {
    if (projectedFacilities.has(facility.id)) continue;
    const fixed =
      isChernobyl(game) &&
      facility.startingAssetId &&
      Object.hasOwn(CHERNOBYL_REACTOR_CELLS, facility.startingAssetId)
        ? CHERNOBYL_REACTOR_CELLS[facility.startingAssetId]
        : undefined;
    if (fixed && !placements.has(tileId(fixed))) {
      placements.set(tileId(fixed), facility);
      continue;
    }
    const hydro =
      isConventionalHydro(facility) || facility.name === "Pumped Hydro";
    const offshore = facility.fuel === "Offshore Wind";
    const sites = hydro ? reservoirs : offshore ? sea : ordinary;
    let cell = firstSite(sites, facility.id, available);
    if (!cell) {
      // Off-window water resources use an illustrative site in their general direction.
      const fallback = firstSite(
        spareLand(),
        facility.id,
        available,
        offshore ? offshoreSite : undefined,
      )!;
      cell = {
        ...fallback,
        terrain: hydro ? "lake" : offshore ? "ocean" : fallback.terrain,
      };
      cells.set(tileId(cell), cell);
    }
    placements.set(tileId(cell), facility);
  }

  // The existing renderer uses the developed hex graph to draw suspended and submerged
  // connections. Trace representative paths to the home city without adding dispatch rules.
  const developed = new Set([tileId(HOME)]);
  for (const id of placements.keys()) {
    let current = cells.get(id)!;
    while (!developed.has(tileId(current))) {
      developed.add(tileId(current));
      const { q, r } = current;
      const distanceFromCity = hexRadius(current);
      const next = HEX_NEIGHBORS.flatMap(([dq, dr]) => {
        const adjacent = cells.get(tileId({ q: q + dq, r: r + dr }));
        return adjacent && hexRadius(adjacent) < distanceFromCity
          ? [adjacent]
          : [];
      });
      current =
        next.find((cell) => developed.has(tileId(cell))) ??
        next.find(land) ??
        next[0];
    }
  }

  const tiles: RegionalTile[] = [];
  for (const [id, cell] of cells) {
    const base = { ...cell, id, territoryId: id };
    const facility = placements.get(id);
    tiles.push(
      id === tileId(HOME)
        ? { ...base, city: { name: geography.city, size: citySize } }
        : {
            ...base,
            siteKind: freshwater(cell)
              ? "hydro"
              : cell.terrain === "ocean"
                ? "wind"
                : "general",
            maxPeakW: facility?.peakW ?? 0,
            ...(facility?.hydroSiteId
              ? { hydroSiteId: facility.hydroSiteId }
              : {}),
          },
    );
  }
  return {
    tiles,
    developed,
    facilityIds: new Map(
      [...placements].map(([id, facility]) => [id, facility.id]),
    ),
  };
}

const layouts = new WeakMap<
  GameType["location"],
  {
    key: string;
    utility: string;
    sources?: DataCenterCustomerSources;
    layout: ReturnType<typeof layoutFor>;
  }
>();

/** A visual projection of the live regional company. Facility sales, purchases and upgrades
 * use their existing owning actions. No synthetic plots or links enter save/simulation state. */
export function regionalMapViews(
  game: GameType,
  sources?: DataCenterCustomerSources,
): TerritoryTileView[] {
  const facilities = [...game.facilities].sort((a, b) => a.id - b.id);
  const citySize = growCitySize(game);
  const key = JSON.stringify([
    game.scenarioId,
    game.seed,
    game.startingYear,
    citySize,
    game.commissionedHydroSiteIds,
    facilities.map(
      ({ id, fuel, name, startingAssetId, hydroSiteId, peakW }) => [
        id,
        fuel,
        name,
        startingAssetId,
        hydroSiteId,
        peakW,
      ],
    ),
  ]);
  let cached = layouts.get(game.location);
  if (!cached || cached.key !== key || cached.sources !== sources) {
    const geography = getRegionalGeography(
      game.location,
      game.startingYear,
      game.scenarioId,
      sources,
    );
    cached = {
      key,
      utility: geography.utility,
      sources,
      layout: layoutFor(game, geography, facilities, citySize),
    };
    layouts.set(game.location, cached);
  }
  const {
    layout: { tiles, developed, facilityIds },
    utility,
  } = cached;
  const current = new Map(
    facilities.map((facility) => [facility.id, facility]),
  );
  const readDisaster = readTerritoryDisasters(game);
  return tiles.map((tile) => {
    const owned = developed.has(tile.id);
    const facilityId = facilityIds.get(tile.id);
    const facility =
      facilityId === undefined ? undefined : current.get(facilityId);
    return {
      tile,
      ownerName: owned ? utility : "Regional terrain",
      ownerKey: owned ? "you" : undefined,
      owned,
      developed: owned,
      facility,
      operatingFacility: facility,
      reserved: !!facility,
      visibilityDistance: 0,
      disaster: readDisaster(tile, facility),
    };
  });
}
