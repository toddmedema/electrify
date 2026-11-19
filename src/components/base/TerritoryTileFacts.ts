import { FACILITY_FUELS } from "../../data/FacilityFuels";
import type { TerritoryTileDefinition } from "../../data/TerritoryTiles";
import { tileSupportsFacilityTechnology } from "../../helpers/TerritoryTiles";
import type { CitySizeType } from "../../Types";

export function formatTerrainPercent(factor: number): string {
  return `${factor >= 1 ? "+" : "−"}${Math.round(Math.abs(factor - 1) * 100)}%`;
}

export function citySizeLabel(size: CitySizeType): string {
  return { small: "Small city", medium: "Medium city", large: "Large city" }[
    size
  ];
}

export function tileHasConstructionTechnology(
  tile: TerritoryTileDefinition,
): boolean {
  return Object.values(FACILITY_FUELS).some(
    (fuel) => fuel && tileSupportsFacilityTechnology(tile, { fuel }),
  );
}
