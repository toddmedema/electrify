import {
  isStorage,
  type FacilityOperatingType,
  type FacilityShoppingType,
  type GameType,
  type TerrainType,
  type TerritoryId,
  type TerritoryTileId,
} from "../Types";
import {
  TERRITORIES,
  purchasedLandTerritories,
  isLandTerritoryId,
  type TerritorySiteKind,
} from "../data/Territories";
import {
  TERRITORY_TILES,
  getAuthoredTerritoryTile,
  getGeneratedTerritoryTile,
  territoryTileAt,
  type TerritoryTileDefinition,
} from "../data/TerritoryTiles";
import {
  POWER_AGREEMENT_BLOCKS,
  UTILITY_AREAS,
} from "../data/UtilityExpansion";
import { isUtilityExpansionGame } from "./ExpansionContext";

export function hasTerritoryNetwork(
  game: Pick<GameType, "scenarioId" | "customScenario" | "territoryNetwork">,
): boolean {
  return isUtilityExpansionGame(game) && game.territoryNetwork?.version === 3;
}
export function ownedTerritories(game: GameType): TerritoryId[] {
  if (!hasTerritoryNetwork(game)) return ["champlain"];
  return [
    ...TERRITORIES.filter(
      ({ id }) =>
        id === "champlain" ||
        (!isLandTerritoryId(id) &&
          game.utilityExpansion?.acquisitions.some(
            ({ targetId }) => targetId === id,
          )),
    ),
    ...purchasedLandTerritories(game),
  ].map(({ id }) => id);
}
export function facilityTerritoryId(
  facility: Pick<FacilityOperatingType, "territoryId" | "startingAssetId">,
): TerritoryId {
  return (
    facility.territoryId ??
    Object.values(UTILITY_AREAS).find((area) =>
      area.facilities.some(
        ({ assetId }) => assetId === facility.startingAssetId,
      ),
    )?.id ??
    "champlain"
  );
}
export function territorySiteKind(
  facility: Pick<FacilityShoppingType, "fuel" | "peakWh">,
): TerritorySiteKind {
  if (isStorage(facility)) return "open-land";
  if (facility.fuel === "Hydro") return "hydro";
  if (facility.fuel === "Geothermal") return "geothermal";
  if (
    facility.fuel === "Wind" ||
    facility.fuel === "Offshore Wind" ||
    facility.fuel === "Airborne Wind"
  )
    return "wind";
  return facility.fuel === "Sun" ? "open-land" : "industrial";
}
const water = (terrain: TerrainType) =>
  terrain === "river" || terrain === "lake" || terrain === "ocean";
/** Technology eligibility and one-site power limits are separate from ownership/occupancy. */
export function tileFitsFacility(
  tile: TerritoryTileDefinition,
  facility: Pick<FacilityShoppingType, "fuel" | "peakWh" | "peakW">,
  allowHistoricalSize = false,
): boolean {
  if (tile.city || !Number.isFinite(facility.peakW) || facility.peakW <= 0)
    return false;
  if (!allowHistoricalSize && facility.peakW > tile.maxPeakW) return false;
  if (tile.terrain === "ocean")
    return (
      !isStorage(facility) &&
      facility.fuel === "Offshore Wind" &&
      tile.siteKind === "wind"
    );
  if (facility.fuel === "Offshore Wind") return false;
  const kind = territorySiteKind(facility);
  if (water(tile.terrain)) return kind === "hydro" && tile.siteKind === "hydro";
  return (
    tile.siteKind === kind ||
    (tile.siteKind === "general" && kind !== "hydro" && kind !== "geothermal")
  );
}
function historicalTile(
  facility: FacilityOperatingType,
  index: number,
): TerritoryTileDefinition | undefined {
  const territoryId = facilityTerritoryId(facility);
  if (facility.tileId !== `${territoryId}:legacy-${facility.id}`)
    return undefined;
  const kind = territorySiteKind(facility);
  return {
    id: facility.tileId,
    territoryId,
    q: 6 + (index % 4),
    r: -4 + Math.floor(index / 4),
    terrain:
      kind === "hydro"
        ? "lake"
        : kind === "geothermal"
          ? "mountain"
          : facility.fuel === "Offshore Wind"
            ? "ocean"
            : "plains",
    siteKind: kind,
    maxPeakW: facility.peakW,
    ...(facility.hydroSiteId ? { hydroSiteId: facility.hydroSiteId } : {}),
  };
}
type TileGame = Pick<GameType, "facilities"> &
  Partial<
    Pick<
      GameType,
      | "scenarioId"
      | "customScenario"
      | "territoryNetwork"
      | "utilityExpansion"
      | "date"
      | "transmission"
      | "multiplayer"
    >
  >;
function legacyTiles(
  game?: Pick<GameType, "facilities">,
): TerritoryTileDefinition[] {
  return (game?.facilities ?? [])
    .filter(
      (facility) =>
        typeof facility.tileId === "string" &&
        facility.tileId.includes(":legacy-"),
    )
    .sort((a, b) => a.id - b.id)
    .flatMap((facility, index) => {
      const tile = historicalTile(facility, index);
      return tile ? [tile] : [];
    });
}
export function getTerritoryTile(
  id: unknown,
  game?: Pick<GameType, "facilities">,
): TerritoryTileDefinition | undefined {
  return (
    getAuthoredTerritoryTile(id) ??
    getGeneratedTerritoryTile(id) ??
    legacyTiles(game).find((tile) => tile.id === id)
  );
}
export function ownsTerritoryTile(
  game: Pick<GameType, "territoryNetwork" | "utilityExpansion">,
  tileOrId: TerritoryTileDefinition | TerritoryTileId,
): boolean {
  const tile =
    typeof tileOrId === "string" ? getTerritoryTile(tileOrId) : tileOrId;
  if (!tile) return false;
  return (
    tile.territoryId === "champlain" ||
    (!isLandTerritoryId(tile.territoryId) &&
      !!game.utilityExpansion?.acquisitions.some(
        ({ targetId }) => targetId === tile.territoryId,
      )) ||
    !!game.territoryNetwork?.landPurchases.some(
      ({ territoryId }) => territoryId === tile.territoryId,
    ) ||
    !!game.territoryNetwork?.tilePurchases?.some(
      ({ tileId }) => tileId === tile.id,
    )
  );
}
export const territoryHexDistance = (
  a: { q: number; r: number },
  b: { q: number; r: number },
) =>
  Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(a.q + a.r - b.q - b.r),
  );
/** Only in-force, accepted utility PPAs extend sight; scheduled and expired agreements do not. */
export function territoryVisibilityAnchors(
  game: TileGame,
): TerritoryTileDefinition[] {
  const remote = new Set(
    (game.transmission?.acceptedAgreements ?? []).flatMap((receipt) => {
      const block = POWER_AGREEMENT_BLOCKS.find(
        ({ id }) => id === receipt.blockId,
      );
      return block &&
        "sellerUtilityId" in block &&
        game.date &&
        receipt.startMinute <= game.date.minute &&
        game.date.minute < receipt.endMinute &&
        !game.utilityExpansion?.acquisitions.some(
          ({ targetId }) => targetId === block.sellerUtilityId,
        )
        ? [block.sellerUtilityId]
        : [];
    }),
  );
  const retained = [
    ...TERRITORY_TILES,
    ...legacyTiles(game),
    ...(game.territoryNetwork?.tilePurchases ?? []).flatMap(({ tileId }) => {
      const tile = getTerritoryTile(tileId, game);
      return tile ? [tile] : [];
    }),
  ];
  return retained.filter(
    (tile) =>
      ownsTerritoryTile(game, tile) || remote.has(tile.territoryId as never),
  );
}
export function territoryVisibilityDistance(
  game: TileGame,
  tile: TerritoryTileDefinition,
): 0 | 1 | 2 | 3 | undefined {
  const distance = Math.min(
    Infinity,
    ...territoryVisibilityAnchors(game).map((anchor) =>
      territoryHexDistance(anchor, tile),
    ),
  );
  return distance <= 3 ? (distance as 0 | 1 | 2 | 3) : undefined;
}
/** Finite discovered frontier only: at most 37 cells per owned/active-PPA anchor. */
export function getTerritoryTiles(
  game?: TileGame,
): readonly TerritoryTileDefinition[] {
  if (!game) return TERRITORY_TILES;
  const result = new Map(
    [...TERRITORY_TILES, ...legacyTiles(game)].map((tile) => [tile.id, tile]),
  );
  const legacyAt = new Map(
    legacyTiles(game).map((tile) => [`${tile.q},${tile.r}`, tile]),
  );
  for (const anchor of territoryVisibilityAnchors(game)) {
    for (let dq = -3; dq <= 3; dq++)
      for (let dr = Math.max(-3, -dq - 3); dr <= Math.min(3, -dq + 3); dr++) {
        const tile =
          legacyAt.get(`${anchor.q + dq},${anchor.r + dr}`) ??
          territoryTileAt(anchor.q + dq, anchor.r + dr);
        if (tile) result.set(tile.id, tile);
      }
  }
  return [...result.values()];
}
export function isTerritoryTileId(
  value: unknown,
  game?: Pick<GameType, "facilities">,
): value is TerritoryTileId {
  return !!getTerritoryTile(value, game);
}
export function getFacilityTile(
  facility: Pick<FacilityOperatingType, "tileId" | "startingAssetId">,
  game?: Pick<GameType, "facilities">,
): TerritoryTileDefinition | undefined {
  return facility.tileId
    ? getTerritoryTile(facility.tileId, game)
    : TERRITORY_TILES.find(
        (tile) =>
          !!facility.startingAssetId &&
          tile.startingAssetId === facility.startingAssetId,
      );
}
export const facilityTileId = (
  facility: Pick<FacilityOperatingType, "tileId" | "startingAssetId">,
): TerritoryTileId | undefined =>
  facility.tileId ?? getFacilityTile(facility)?.id;
export function facilityOnTile(
  game: Pick<GameType, "facilities">,
  id: TerritoryTileId,
): FacilityOperatingType | undefined {
  return game.facilities.find((facility) => facilityTileId(facility) === id);
}
function tileReserved(
  game: Pick<GameType, "facilities"> &
    Partial<Pick<GameType, "commissionedHydroSiteIds">>,
  tile: TerritoryTileDefinition,
) {
  return (
    !!facilityOnTile(game, tile.id) ||
    (!!tile.hydroSiteId &&
      !!game.commissionedHydroSiteIds?.includes(tile.hydroSiteId))
  );
}
/** Physical inventory stays available for a too-large quote so the UI can offer a smaller size. */
export function territoryTileInventory(
  game: Pick<GameType, "facilities"> &
    Partial<Pick<GameType, "commissionedHydroSiteIds">>,
  id: unknown,
): { remaining: number; total: number; maxPeakW: number } {
  const tile = getTerritoryTile(id, game);
  if (!tile || tile.city) return { remaining: 0, total: 0, maxPeakW: 0 };
  return {
    remaining: tileReserved(game, tile) ? 0 : 1,
    total: 1,
    maxPeakW: tile.maxPeakW,
  };
}
export function availableTerritoryTiles(
  game: GameType,
  facility: FacilityShoppingType,
  id: TerritoryId,
): readonly TerritoryTileDefinition[] {
  if (!ownedTerritories(game).includes(id)) return [];
  return getTerritoryTiles(game).filter(
    (tile) =>
      tile.territoryId === id &&
      ownsTerritoryTile(game, tile) &&
      tileFitsFacility(tile, facility) &&
      !tileReserved(game, tile),
  );
}
/** Assign missing placements only; explicit invalid/duplicate placements are never silently repaired. */
export function assignTerritoryTiles(game: GameType): boolean {
  if (!hasTerritoryNetwork(game)) return true;
  const occupied = new Set<TerritoryTileId>();
  const ordered = [...game.facilities].sort(
    (a, b) =>
      (!!b.startingAssetId ? 1 : 0) - (!!a.startingAssetId ? 1 : 0) ||
      a.id - b.id,
  );
  for (const facility of ordered) {
    const territoryId = facilityTerritoryId(facility);
    const historicalSize = !territoryId.startsWith("parcel-");
    if (facility.tileId !== undefined) {
      const tile = getTerritoryTile(facility.tileId, game);
      if (
        !tile ||
        tile.territoryId !== territoryId ||
        occupied.has(tile.id) ||
        !tileFitsFacility(tile, facility, historicalSize)
      )
        return false;
      occupied.add(tile.id);
      continue;
    }
    const candidates = getTerritoryTiles(game).filter(
      (tile) =>
        tile.territoryId === territoryId &&
        !occupied.has(tile.id) &&
        tileFitsFacility(tile, facility, historicalSize),
    );
    const tile =
      candidates.find(
        (tile) =>
          !!facility.startingAssetId &&
          tile.startingAssetId === facility.startingAssetId,
      ) ?? candidates[0];
    facility.tileId = tile?.id ?? `${territoryId}:legacy-${facility.id}`;
    occupied.add(facility.tileId);
  }
  return true;
}
export function territorySiteInventory(
  game: Pick<GameType, "facilities"> &
    Partial<Pick<GameType, "commissionedHydroSiteIds">>,
  id: TerritoryId,
  kind: TerritorySiteKind,
): { remaining: number; total: number; maxPeakW: number } {
  const tiles = getTerritoryTiles(game).filter(
    (tile) => tile.territoryId === id && tile.siteKind === kind,
  );
  return {
    total: tiles.length,
    remaining: tiles.filter((tile) => !tileReserved(game, tile)).length,
    maxPeakW: Math.max(0, ...tiles.map((tile) => tile.maxPeakW ?? 0)),
  };
}
