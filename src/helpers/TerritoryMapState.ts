import type {
  FacilityOperatingType,
  FuelNameType,
  GameType,
  TerritoryTileId,
  UtilityAcquisitionId,
} from "../Types";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { isLandTerritoryId } from "../data/Territories";
import type { TerritoryTileDefinition } from "../data/TerritoryTiles";
import {
  facilityTileId,
  scenarioMapTiles,
  createTerritoryTileOwnership,
} from "./TerritoryTiles";
import { municipalUtilityAt } from "../data/MunicipalUtilities";
import {
  pendingTileConnections,
  type TileConnection,
} from "./TerritoryConnections";
import { createTilePurchaseEligibility } from "./Territories";
import {
  readTerritoryDisasters,
  type TileDisaster,
} from "./TerritoryDisasters";
export interface TileFacilityView {
  name: FacilityOperatingType["name"];
  fuel?: FuelNameType;
  peakW: number;
  peakWh?: number;
  yearsToBuild?: number;
  yearsToBuildLeft: number;
}
/** Retained facility IDs are company-local; the map identifies them by physical position. */
export type TerritoryMapTileKey =
  TerritoryTileId | `retained:${number}:${number}`;
export function territoryMapTileKey({
  id,
  q,
  r,
}: Pick<TerritoryTileDefinition, "id" | "q" | "r">): TerritoryMapTileKey {
  return id.includes(":legacy-") ? `retained:${q}:${r}` : id;
}
export interface TerritoryTileView {
  tile: TerritoryTileDefinition;
  ownerKey?: string;
  ownerName: string;
  owned: boolean;
  developed: boolean;
  connection?: TileConnection;
  facility?: TileFacilityView;
  operatingFacility?: FacilityOperatingType;
  connectable?: boolean;
  acquisitionId?: UtilityAcquisitionId;
  reserved?: boolean;
  visibilityDistance: 0 | 1 | 2 | 3;
  disaster?: TileDisaster;
}
/** One truthful foreground per cell; peer structures are projected by the shared world. */
export function territoryTileViews(game: GameType): TerritoryTileView[] {
  const readDisaster = readTerritoryDisasters(game);
  const owns = createTerritoryTileOwnership(game);
  const pending = pendingTileConnections(game);
  const connectable = createTilePurchaseEligibility(game, owns);
  const facilities = new Map<
    TerritoryTileView["tile"]["id"],
    FacilityOperatingType
  >();
  for (const facility of game.facilities) {
    const id = facilityTileId(facility);
    if (id && !facilities.has(id)) facilities.set(id, facility);
  }
  const usedHydroSites = new Set(game.commissionedHydroSiteIds);
  const inherited = Object.values(UTILITY_AREAS).flatMap(
    (area) => area.facilities,
  );
  const retainedClaims = new Map(
    game.multiplayer?.legacyTiles?.map((claim) => [
      `${claim.tile.q},${claim.tile.r}`,
      claim,
    ]),
  );
  return scenarioMapTiles(game).map(({ tile, visibilityDistance }) => {
    const isOwned = owns(tile);
    const retainedClaim = retainedClaims.get(`${tile.q},${tile.r}`);
    const claim =
      retainedClaim ??
      game.multiplayer?.tileOwners?.[tile.id] ??
      (isLandTerritoryId(tile.territoryId)
        ? game.multiplayer?.landOwners?.[tile.territoryId]
        : undefined);
    const connection = isOwned
      ? pending.get(tile.id)
      : !retainedClaim && claim
        ? game.multiplayer?.tileOwners?.[tile.id]?.connection
        : undefined;
    const municipal = !isOwned && !claim ? municipalUtilityAt(tile) : undefined;
    const acquisitionId =
      !isOwned && !claim
        ? municipal?.plant
          ? municipal.id
          : tile.territoryId === "valley-electric" ||
              tile.territoryId === "ridge-electric"
            ? tile.territoryId
            : undefined
        : undefined;
    const ownerKey = isOwned
      ? "you"
      : claim
        ? `peer:${claim.seat}`
        : !isLandTerritoryId(tile.territoryId)
          ? tile.territoryId
          : municipal && `municipal:${municipal.city.id}`;
    const utility =
      tile.territoryId === "champlain" ||
      tile.territoryId === "valley-electric" ||
      tile.territoryId === "ridge-electric"
        ? UTILITY_AREAS[tile.territoryId]
        : undefined;
    const ownerName = isOwned
      ? "You"
      : (claim?.name ?? utility?.name ?? municipal?.name ?? "Unowned land");
    const operatingFacility = isOwned ? facilities.get(tile.id) : undefined;
    const peerFacility =
      !isOwned && claim
        ? retainedClaim
          ? retainedClaim.facility
          : game.multiplayer?.tileFacilities?.[tile.id]
        : undefined;
    const asset =
      !isOwned && !claim && tile.startingAssetId
        ? inherited.find((asset) => asset.assetId === tile.startingAssetId)
        : undefined;
    const facility: TileFacilityView | undefined =
      operatingFacility ??
      peerFacility ??
      (municipal?.plant?.tileId === tile.id
        ? municipal.plant.facility
        : undefined) ??
      (asset
        ? {
            name: asset.name ?? asset.fuel ?? "Generator",
            ...(asset.fuel !== undefined ? { fuel: asset.fuel } : {}),
            peakW: asset.peakW ?? 0,
            ...(asset.peakWh !== undefined ? { peakWh: asset.peakWh } : {}),
            yearsToBuildLeft: 0,
          }
        : undefined);
    return {
      tile,
      visibilityDistance,
      ownerKey,
      ownerName,
      owned: isOwned,
      developed: !!ownerKey && !connection,
      connection,
      facility,
      operatingFacility,
      disaster: readDisaster(tile, operatingFacility),
      connectable: connectable(tile),
      acquisitionId,
      reserved:
        !!operatingFacility ||
        (!!tile.hydroSiteId && usedHydroSites.has(tile.hydroSiteId)),
    };
  });
}
