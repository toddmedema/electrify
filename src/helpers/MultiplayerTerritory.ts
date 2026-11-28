import {
  type CitySizeType,
  type FacilityOperatingType,
  type FacilityShoppingType,
  type FrontierTerritoryId,
  type GameType,
  type TerrainType,
  type TerritoryTileId,
} from "../Types";
import { getViableLocationCount } from "../data/FacilitySites";
import {
  getHydroAvailability,
  getHydroInventoryKey,
  isConventionalHydro,
  offeredHydroSiteIds,
  resolveHydroInventory,
  HYDRO_SITES,
} from "../data/HydroSites";
import {
  getRegionalGeography,
  hexRadius,
  regionalHexes,
  REGIONAL_MAP_RADIUS,
  REGIONAL_MAP_TILE_KM,
  type HexCoordinate,
} from "../data/RegionalGeography";
import { territoryCoordinateHash } from "../data/Territories";
import type { TerritoryTileDefinition } from "../data/TerritoryTiles";
import { CUSTOMER_MARKET_MULTIPLIER } from "./Customers";
import { HEX_NEIGHBORS } from "./HexNeighbors";
import { cos } from "./Libm";
import {
  territoryTilePowerLimit,
  tileFitsFacility,
  tileSupportsFacilityTechnology,
} from "./TerritoryTiles";
import type { TerritoryTileView } from "./TerritoryMapState";

type OpeningSite = "land" | "hydro" | "offshore" | "geothermal";

export interface TerritorialState {
  version: 1;
  seatIndex: number;
  seatCount: number;
  /** Compact opening plant requirements. The running fleet does not alter the common board. */
  openingSites: OpeningSite[];
  startingTileIds: FrontierTerritoryId[];
  homeTileId: FrontierTerritoryId;
  claims: { tileId: FrontierTerritoryId; minute: number; price: number }[];
}

type BoardTile = TerritoryTileDefinition & {
  id: FrontierTerritoryId;
  territoryId: FrontierTerritoryId;
};
type BoardGame = Pick<
  GameType,
  "location" | "startingYear" | "scenarioId" | "seed" | "customScenario"
>;
type Cell = HexCoordinate & { id: FrontierTerritoryId; terrain: TerrainType };
const idAt = (q: number, r: number): FrontierTerritoryId =>
  `frontier:${q}:${r}`;
const distance = (a: HexCoordinate, b: HexCoordinate) =>
  hexRadius({ q: a.q - b.q, r: a.r - b.r });
const neighbors = ({ q, r }: HexCoordinate) =>
  HEX_NEIGHBORS.map(([dq, dr]) => idAt(q + dq, r + dr));
const wet = (terrain: TerrainType) =>
  terrain === "river" || terrain === "lake" || terrain === "ocean";
const COMPACT_SITE_LIMIT_W = 1e9;
const OPENING_EMPTY_PLOTS = 2;
const HEADQUARTERS_DIRECTIONS = [
  [],
  [],
  [0, 3],
  [0, 2, 4],
  [0, 1, 3, 4],
] as const;

function openingSite(facility: FacilityOperatingType): OpeningSite {
  if (isConventionalHydro(facility)) return "hydro";
  if (facility.fuel === "Offshore Wind") return "offshore";
  if (facility.name === "Geothermal") return "geothermal";
  return "land";
}

interface Board {
  byId: Map<FrontierTerritoryId, BoardTile>;
  homes: FrontierTerritoryId[];
  starts: FrontierTerritoryId[][];
}

const cachedBoards = new WeakMap<
  BoardGame["location"],
  { key: string; board: Board }
>();
const boardsByOpening = new WeakMap<OpeningSite[], Board>();

function boardFor(
  game: BoardGame,
  seatCount: number,
  openingSites: readonly OpeningSite[],
): Board {
  const key = JSON.stringify([
    game.scenarioId,
    game.startingYear,
    game.seed,
    seatCount,
    openingSites,
  ]);
  const cached = cachedBoards.get(game.location);
  if (cached?.key === key) return cached.board;
  const geography = getRegionalGeography(
    game.location,
    game.startingYear,
    game.scenarioId,
  );
  const salt = `multiplayer-territory-v1:${game.location.id}:${game.seed}`;
  const rank = ({ q, r }: HexCoordinate) => territoryCoordinateHash(q, r, salt);
  const rotation = rank({ q: 0, r: 0 }) % HEX_NEIGHBORS.length;
  const plotCount = openingSites.length + OPENING_EMPTY_PLOTS;
  const radius = Math.max(
    REGIONAL_MAP_RADIUS + 1,
    3 + Math.ceil(Math.sqrt(plotCount + 1)),
  );
  const anchorDistance = Math.max(3, radius - 4);
  const anchors = HEADQUARTERS_DIRECTIONS[seatCount].map((index) => {
    const [q, r] = HEX_NEIGHBORS[(index + rotation) % HEX_NEIGHBORS.length];
    return { q: q * anchorDistance, r: r * anchorDistance };
  });
  const cells = regionalHexes(radius).map((coordinate): Cell => ({
    ...coordinate,
    id: idAt(coordinate.q, coordinate.r),
    terrain: geography.terrainAt(coordinate),
  }));
  const byCell = new Map(cells.map((cell) => [cell.id, cell]));
  const used = new Map<FrontierTerritoryId, number>();
  const homes = anchors.map((anchor, seat) => {
    const cell = cells
      .filter(({ id, terrain }) => !used.has(id) && !wet(terrain))
      .sort(
        (a, b) =>
          distance(a, anchor) - distance(b, anchor) || rank(a) - rank(b),
      )[0];
    used.set(cell.id, seat);
    return cell;
  });

  const byId = new Map<FrontierTerritoryId, BoardTile>(
    cells.map((cell) => [
      cell.id,
      {
        ...cell,
        territoryId: cell.id,
        siteKind:
          cell.terrain === "ocean" && game.location.offshore
            ? "wind"
            : "general",
        maxPeakW:
          cell.terrain === "ocean" && game.location.offshore
            ? COMPACT_SITE_LIMIT_W
            : 0,
      },
    ]),
  );
  const cityFor = (cell: Cell) => ({
    ...cell,
    territoryId: cell.id,
    city: { name: geography.city, size: "small" as const },
  });
  for (const city of homes) byId.set(city.id, cityFor(city));

  const inventory = resolveHydroInventory(
    game.location,
    getHydroInventoryKey(game),
  );
  const namedHydro = new Set<FrontierTerritoryId>();
  if (
    inventory?.status === "researched" &&
    inventory.newConstructionAllowed !== false &&
    game.location.resources?.hydro !== false
  ) {
    for (const siteId of offeredHydroSiteIds(inventory)) {
      const site = HYDRO_SITES[siteId];
      const kmPerDegree = 111.195;
      const latitude = game.location.lat - site.lat;
      const longitude = ((site.lon - game.location.long + 540) % 360) - 180;
      const r =
        (latitude * kmPerDegree * 2) / (Math.sqrt(3) * REGIONAL_MAP_TILE_KM);
      const q =
        (longitude * kmPerDegree * cos((game.location.lat * Math.PI) / 180)) /
          REGIONAL_MAP_TILE_KM -
        r / 2;
      const scale = Math.min(1, radius / hexRadius({ q, r }));
      const nearest = { q: q * scale, r: r * scale };
      const cell = cells
        .filter(
          (cell) =>
            !used.has(cell.id) &&
            !namedHydro.has(cell.id) &&
            cell.terrain !== "ocean" &&
            (wet(cell.terrain) ||
              // Reserve ordinary land for growth. Several real dams can fall in one
              // coarse cell; a sparse set of implied reservoirs preserves that scale.
              (rank(cell) % 4 === 0 &&
                homes.every((home) => distance(home, cell) > 2))),
        )
        .sort(
          (a, b) =>
            distance(a, nearest) +
              (wet(a.terrain) ? 0 : 1) -
              distance(b, nearest) -
              (wet(b.terrain) ? 0 : 1) || rank(a) - rank(b),
        )[0];
      if (!cell) continue;
      namedHydro.add(cell.id);
      byId.set(cell.id, {
        ...cell,
        terrain: wet(cell.terrain) ? cell.terrain : "lake",
        territoryId: cell.id,
        siteKind: "hydro",
        hydroSiteId: siteId,
        maxPeakW: site.maxPeakW,
      });
    }
  }

  const geothermal = getViableLocationCount(game.location, "Geothermal") ?? 0;
  if (geothermal) {
    cells
      .filter(
        (cell) =>
          !wet(cell.terrain) &&
          !used.has(cell.id) &&
          !namedHydro.has(cell.id) &&
          homes.every((home) => distance(home, cell) > 1),
      )
      .sort(
        (a, b) =>
          Number(b.terrain === "mountain" || b.terrain === "hills") -
            Number(a.terrain === "mountain" || a.terrain === "hills") ||
          rank(a) - rank(b),
      )
      .slice(0, geothermal * seatCount)
      .forEach((cell) => {
        byId.set(cell.id, {
          ...cell,
          territoryId: cell.id,
          siteKind: "geothermal",
          maxPeakW: COMPACT_SITE_LIMIT_W,
        });
      });
  }

  const starts = homes.map(({ id }) => [id]);
  // Grow all openings together. Favor compact neighborhoods and leave neutral border cells when
  // the terrain permits. The spare plots are assigned before inherited special facilities, so
  // every company can build immediately even with a very specialized opening fleet.
  const specialist = [
    ...openingSites,
    ...Array<OpeningSite>(OPENING_EMPTY_PLOTS).fill("land"),
  ];
  const plotOrder = specialist
    .map((kind, slot) => ({ kind, slot }))
    .sort((a, b) => Number(b.kind === "land") - Number(a.kind === "land"));
  for (const { kind, slot } of plotOrder) {
    for (const [seat, home] of homes.entries()) {
      const owned = starts[seat];
      const candidates = [
        ...new Set(
          owned.filter(Boolean).flatMap((id) => neighbors(byCell.get(id)!)),
        ),
      ]
        .filter((id) => !used.has(id))
        .flatMap((id) => {
          const tile = byId.get(id);
          return tile ? [tile] : [];
        });
      const native = (tile: BoardTile) =>
        kind === "land"
          ? !wet(tile.terrain) && tile.siteKind === "general"
          : kind === "offshore"
            ? tile.terrain === "ocean"
            : kind === "hydro"
              ? tile.terrain === "river" || tile.terrain === "lake"
              : tile.siteKind === "geothermal";
      const cost = (tile: BoardTile) =>
        distance(tile, home) +
        (native(tile) ? 0 : wet(tile.terrain) ? 12 : 5) +
        (namedHydro.has(tile.id) ? 8 : 0) +
        (neighbors(tile).some(
          (near) => used.has(near) && used.get(near) !== seat,
        )
          ? 10
          : 0);
      const plot = candidates.sort(
        (a, b) => cost(a) - cost(b) || rank(a) - rank(b),
      )[0];
      if (!plot) throw new Error("No space for a connected opening territory");
      used.set(plot.id, seat);
      owned[slot + 1] = plot.id;
      if (kind === "land" && !native(plot)) {
        // Opening grids have prepared industrial pads. Named resource plots stay unchanged.
        const cell = byCell.get(plot.id)!;
        byId.set(plot.id, {
          ...cell,
          terrain: wet(cell.terrain) ? "plains" : cell.terrain,
          territoryId: cell.id,
          siteKind: "general",
          maxPeakW: 0,
        });
      }
    }
  }

  const board = { byId, homes: homes.map(({ id }) => id), starts };
  cachedBoards.set(game.location, { key, board });
  return board;
}

export function createMultiplayerTerritory(
  game: GameType,
  seatIndex: number,
  seatCount: number,
): GameType {
  if (
    !game.multiplayer ||
    !Number.isInteger(seatIndex) ||
    seatIndex < 0 ||
    seatIndex >= seatCount ||
    !Number.isInteger(seatCount) ||
    seatCount < 2 ||
    seatCount > 4
  ) {
    throw new Error("Invalid company placement");
  }
  const openingFleet = [...game.facilities].sort((a, b) => a.id - b.id);
  const openingSites = openingFleet.map(openingSite);
  const board = boardFor(game, seatCount, openingSites);
  const startingTileIds = [...board.starts[seatIndex]];
  const tileForFacility = new Map(
    openingFleet.map(({ id }, slot) => [id, startingTileIds[slot + 1]]),
  );
  return {
    ...game,
    facilities: game.facilities.map((facility) => ({
      ...facility,
      tileId: tileForFacility.get(facility.id),
    })),
    multiplayer: {
      ...game.multiplayer,
      territorial: {
        version: 1,
        seatIndex,
        seatCount,
        openingSites,
        startingTileIds,
        homeTileId: board.homes[seatIndex],
        claims: [],
      },
    },
  };
}

function territories(game: GameType) {
  const state = game.multiplayer?.territorial;
  if (!state) return undefined;
  let board = boardsByOpening.get(state.openingSites);
  if (!board) {
    board = boardFor(game, state.seatCount, state.openingSites);
    boardsByOpening.set(state.openingSites, board);
  }
  return board;
}

export function multiplayerTerritoryTile(game: GameType, id: unknown) {
  return typeof id === "string"
    ? territories(game)?.byId.get(id as FrontierTerritoryId)
    : undefined;
}

export function multiplayerTerritoryTiles(game: GameType) {
  return [...(territories(game)?.byId.values() ?? [])];
}

export function multiplayerOwnedTileIds(game: GameType): FrontierTerritoryId[] {
  const state = game.multiplayer?.territorial;
  return state
    ? [...state.startingTileIds, ...state.claims.map(({ tileId }) => tileId)]
    : [];
}

export function multiplayerTerritoryClaimable(tile: TerritoryTileDefinition) {
  return (
    !tile.city &&
    (!wet(tile.terrain) ||
      (tile.terrain === "ocean"
        ? tile.siteKind === "wind"
        : !!tile.hydroSiteId))
  );
}

const claimPrice: Record<TerrainType, number> = {
  plains: 2_400_000,
  forest: 3_000_000,
  hills: 2_800_000,
  mountain: 3_500_000,
  river: 3_000_000,
  lake: 3_000_000,
  ocean: 3_500_000,
};

export function multiplayerClaimQuote(game: GameType, id: unknown) {
  const tile = multiplayerTerritoryTile(game, id);
  if (
    !tile ||
    !multiplayerTerritoryClaimable(tile) ||
    game.multiplayer?.tileOwners?.[tile.id]
  )
    return undefined;
  const own = new Set(multiplayerOwnedTileIds(game));
  if (
    own.has(tile.id) ||
    !neighbors(tile).some((neighbor) => own.has(neighbor))
  )
    return undefined;
  const price = claimPrice[tile.terrain];
  return {
    tileId: tile.id,
    price,
    quoteKey: `territorial-v1:${tile.id}:${price}`,
  };
}

export function multiplayerBorderConnection(gameA: GameType, gameB: GameType) {
  const board = territories(gameA);
  if (!board || !gameB.multiplayer?.territorial) return undefined;
  const ownedB = new Set(multiplayerOwnedTileIds(gameB));
  const ownedA = multiplayerOwnedTileIds(gameA).sort();
  for (const id of ownedA) {
    const tile = board.byId.get(id);
    if (!tile) continue;
    const there = neighbors(tile)
      .sort()
      .find((neighbor) => ownedB.has(neighbor));
    if (there) return { a: id, b: there };
  }
  return undefined;
}

export function multiplayerHydroAvailability(
  game: GameType,
  peakW: number,
  tileId?: TerritoryTileId,
) {
  const own = multiplayerOwnedTileIds(game).filter(
    (id) => tileId === undefined || tileId === id,
  );
  const sites = own.flatMap((id) => {
    const siteId = multiplayerTerritoryTile(game, id)?.hydroSiteId;
    return siteId && !game.facilities.some((facility) => facility.tileId === id)
      ? [siteId]
      : [];
  });
  return getHydroAvailability(
    game,
    peakW,
    undefined,
    undefined,
    new Set(sites),
  );
}

type SiteFacility = Pick<
  FacilityShoppingType,
  "name" | "fuel" | "peakW" | "peakWh"
>;

export function multiplayerBuildAvailability(
  game: GameType,
  facility: SiteFacility,
  tileId?: TerritoryTileId,
): {
  buildable: boolean;
  tileId?: FrontierTerritoryId;
  reason?: string;
  remaining: number;
  total: number;
  maxPeakW: number;
} {
  const own = new Set(multiplayerOwnedTileIds(game));
  const occupied = new Set(game.facilities.map((plant) => plant.tileId));
  const sourceIds = tileId === undefined ? own : [tileId];
  const compatible = [...sourceIds].flatMap((id) => {
    const tile = multiplayerTerritoryTile(game, id);
    return tile &&
      own.has(tile.id) &&
      tileSupportsFacilityTechnology(tile, facility)
      ? [tile]
      : [];
  });
  const available = compatible.filter(
    (tile) =>
      !occupied.has(tile.id) &&
      (!isConventionalHydro(facility) ||
        multiplayerHydroAvailability(game, 1, tile.id).status === "available"),
  );
  const selected = available.find((tile) => tileFitsFacility(tile, facility));
  const maxPeakW = Math.max(
    0,
    ...available.map((tile) => territoryTilePowerLimit(tile, facility)),
  );
  const reason = selected
    ? undefined
    : tileId !== undefined && !own.has(tileId as FrontierTerritoryId)
      ? "Claim this tile before building."
      : available.length
        ? "This facility exceeds the available site capacity."
        : "No vacant owned sites support this facility.";
  return {
    buildable: !!selected,
    tileId: selected?.id,
    reason,
    remaining: available.length,
    total: compatible.length,
    maxPeakW,
  };
}

export function multiplayerTerritoryViews(game: GameType): TerritoryTileView[] {
  const state = game.multiplayer?.territorial;
  if (!state) return [];
  const own = new Set(multiplayerOwnedTileIds(game));
  const facilities = new Map(
    game.facilities.map((facility) => [facility.tileId, facility]),
  );
  const customers = game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER;
  const homeSize: CitySizeType =
    customers < 50_000 ? "small" : customers < 500_000 ? "medium" : "large";
  const ownName = game.multiplayer!.clock?.players.find(
    ({ id }) => id === game.multiplayer!.seat,
  )?.name;
  return multiplayerTerritoryTiles(game).map((tile) => {
    const owned = own.has(tile.id);
    const owner = game.multiplayer?.tileOwners?.[tile.id];
    const operatingFacility = facilities.get(tile.id);
    const facility =
      operatingFacility ?? game.multiplayer?.tileFacilities?.[tile.id];
    return {
      tile: tile.city
        ? { ...tile, city: { ...tile.city, size: homeSize } }
        : tile,
      ownerKey: owned ? "you" : owner && `peer:${owner.seat}`,
      ownerName: owned
        ? (owner?.name ?? ownName ?? "You")
        : (owner?.name ?? "Unclaimed territory"),
      owned,
      developed: owned || !!owner,
      connectable: !owned && !owner && !!multiplayerClaimQuote(game, tile.id),
      operatingFacility,
      facility,
      reserved: !!facility,
      visibilityDistance: 0,
    };
  });
}
