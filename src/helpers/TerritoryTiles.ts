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
  isLandTerritoryId,
  type TerritorySiteKind,
} from "../data/Territories";
import {
  TERRITORY_TILES,
  getAuthoredTerritoryTile,
  type TerritoryTileDefinition,
} from "../data/TerritoryTiles";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { isUtilityExpansionGame } from "./ExpansionContext";

export function hasTerritoryNetwork(
  game: Pick<GameType, "scenarioId" | "customScenario" | "territoryNetwork">,
): boolean {
  return isUtilityExpansionGame(game) && game.territoryNetwork?.version === 3;
}
export function ownedTerritories(game: GameType): TerritoryId[] {
  if (!hasTerritoryNetwork(game)) return ["champlain"];
  return TERRITORIES.filter(
    ({ id }) =>
      id === "champlain" ||
      (isLandTerritoryId(id)
        ? game.territoryNetwork?.landPurchases.some(
            (receipt) => receipt.territoryId === id,
          )
        : game.utilityExpansion?.acquisitions.some(
            ({ targetId }) => targetId === id,
          )),
  ).map(({ id }) => id);
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
/** Legacy over-budget fleets get separate cells, never stacks or deleted assets. */
export function getTerritoryTiles(
  game?: Pick<GameType, "facilities">,
): readonly TerritoryTileDefinition[] {
  if (!game) return TERRITORY_TILES;
  const overflow = game.facilities
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
  return overflow.length ? [...TERRITORY_TILES, ...overflow] : TERRITORY_TILES;
}
export function getTerritoryTile(
  id: unknown,
  game?: Pick<GameType, "facilities">,
): TerritoryTileDefinition | undefined {
  return (
    getAuthoredTerritoryTile(id) ??
    (typeof id === "string"
      ? getTerritoryTiles(game).find((tile) => tile.id === id)
      : undefined)
  );
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
export function availableTerritoryTiles(
  game: GameType,
  facility: FacilityShoppingType,
  id: TerritoryId,
): readonly TerritoryTileDefinition[] {
  if (!ownedTerritories(game).includes(id)) return [];
  return TERRITORY_TILES.filter(
    (tile) =>
      tile.territoryId === id &&
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
    const candidates = TERRITORY_TILES.filter(
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
  const tiles = TERRITORY_TILES.filter(
    (tile) => tile.territoryId === id && tile.siteKind === kind,
  );
  return {
    total: tiles.length,
    remaining: tiles.filter((tile) => !tileReserved(game, tile)).length,
    maxPeakW: Math.max(0, ...tiles.map((tile) => tile.maxPeakW ?? 0)),
  };
}
