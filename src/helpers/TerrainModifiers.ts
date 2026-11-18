import type {
  FacilityOperatingType,
  FuelNameType,
  GameType,
  TerritoryTileId,
} from "../Types";
import { getOffshoreWindOutputFactor, getWindOutputFactor } from "./Energy";
import {
  getTerritoryTile,
  hasTerritoryNetwork,
  isRetainedLakeOffshoreFacility,
} from "./TerritoryTiles";

/** Rounded residual siting assumptions, not universal measured terrain averages.
 * The existing wind reference already includes height/siting; see docs/terrain-modifiers.md.
 */
export function getTerrainModifiers(
  game: GameType,
  fuel: FuelNameType | undefined,
  tileId?: TerritoryTileId,
): { onshoreWindSpeed: number; buildCost: number } {
  const terrain = hasTerritoryNetwork(game)
    ? getTerritoryTile(tileId, game)?.terrain
    : undefined;
  const windSpeed =
    terrain === "forest"
      ? 0.95
      : terrain === "hills"
        ? 1.1
        : terrain === "mountain"
          ? 1.15
          : 1;
  const buildCost =
    terrain === "forest"
      ? 1.05
      : terrain === "hills"
        ? 1.1
        : terrain === "mountain"
          ? 1.2
          : 1;
  return {
    onshoreWindSpeed: fuel === "Wind" ? windSpeed : 1,
    buildCost,
  };
}

/** The mapped ocean supplies offshore access even in this otherwise inland scenario. */
export function isOceanWindTile(
  game: GameType,
  tileId?: TerritoryTileId,
): boolean {
  return (
    hasTerritoryNetwork(game) &&
    getTerritoryTile(tileId, game)?.terrain === "ocean"
  );
}

/** Apply local speed before the turbine curve, never to generated watts. */
export function getTerrainWindOutputFactor(
  game: GameType,
  facility: Pick<FacilityOperatingType, "fuel" | "tileId"> &
    Partial<Pick<FacilityOperatingType, "id">>,
  regionalWindKph: number,
  offshoreWindKph?: number,
): number {
  if (facility.fuel === "Offshore Wind") {
    return getOffshoreWindOutputFactor(
      offshoreWindKph ??
        (isOceanWindTile(game, facility.tileId) ||
        isRetainedLakeOffshoreFacility(game, facility)
          ? regionalWindKph
          : 0),
    );
  }
  return getWindOutputFactor(
    regionalWindKph *
      getTerrainModifiers(game, facility.fuel, facility.tileId)
        .onshoreWindSpeed,
  );
}
