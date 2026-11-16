import type { FacilityOperatingType, FuelNameType, GameType } from "../Types";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { isLandTerritoryId } from "../data/Territories";
import type { TerritoryTileDefinition } from "../data/TerritoryTiles";
import {
  facilityOnTile,
  getTerritoryTiles,
  ownsTerritoryTile,
  territoryVisibilityAnchors,
  territoryHexDistance,
} from "./TerritoryTiles";
export interface TileFacilityView {
  name: FacilityOperatingType["name"];
  fuel?: FuelNameType;
  peakW: number;
  peakWh?: number;
  yearsToBuildLeft: number;
}
export interface TerritoryTileView {
  tile: TerritoryTileDefinition;
  ownerKey?: string;
  ownerName: string;
  owned: boolean;
  developed: boolean;
  facility?: TileFacilityView;
  operatingFacility?: FacilityOperatingType;
  visibilityDistance: 0 | 1 | 2 | 3;
}
/** One truthful foreground per cell; peer structures are projected by the shared world. */
export function territoryTileViews(game: GameType): TerritoryTileView[] {
  const anchors = territoryVisibilityAnchors(game);
  const inherited = Object.values(UTILITY_AREAS).flatMap(
    (area) => area.facilities,
  );
  return getTerritoryTiles(game).flatMap((tile) => {
    const distance = Math.min(
      Infinity,
      ...anchors.map((anchor) => territoryHexDistance(anchor, tile)),
    );
    if (distance > 3) return [];
    const isOwned = ownsTerritoryTile(game, tile);
    const claim = isLandTerritoryId(tile.territoryId)
      ? (game.multiplayer?.tileOwners?.[tile.id] ??
        game.multiplayer?.landOwners?.[tile.territoryId])
      : undefined;
    const ownerKey = isOwned
      ? "you"
      : claim
        ? `peer:${claim.seat}`
        : !isLandTerritoryId(tile.territoryId)
          ? tile.territoryId
          : undefined;
    const utility =
      tile.territoryId === "champlain" ||
      tile.territoryId === "valley-electric" ||
      tile.territoryId === "ridge-electric"
        ? UTILITY_AREAS[tile.territoryId]
        : undefined;
    const ownerName = isOwned
      ? "You"
      : (claim?.name ?? utility?.name ?? "Unowned land");
    const operatingFacility = isOwned
      ? facilityOnTile(game, tile.id)
      : undefined;
    const peerFacility =
      !isOwned && claim
        ? game.multiplayer?.tileFacilities?.[tile.id]
        : undefined;
    const asset =
      !isOwned && !claim && tile.startingAssetId
        ? inherited.find((asset) => asset.assetId === tile.startingAssetId)
        : undefined;
    const facility: TileFacilityView | undefined =
      operatingFacility ??
      peerFacility ??
      (asset
        ? {
            name: asset.name ?? asset.fuel ?? "Generator",
            ...(asset.fuel !== undefined ? { fuel: asset.fuel } : {}),
            peakW: asset.peakW ?? 0,
            ...(asset.peakWh !== undefined ? { peakWh: asset.peakWh } : {}),
            yearsToBuildLeft: 0,
          }
        : undefined);
    return [
      {
        tile,
        visibilityDistance: distance as 0 | 1 | 2 | 3,
        ownerKey,
        ownerName,
        owned: isOwned,
        developed: !!ownerKey,
        facility,
        operatingFacility,
      },
    ];
  });
}
