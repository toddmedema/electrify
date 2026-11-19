import type { FuelNameType, TerritoryTileId } from "../Types";
import { territoryCoordinateHash } from "./Territories";
import {
  getAuthoredTerritoryTile,
  type TerritoryTileDefinition,
} from "./TerritoryTiles";

const suffixes = [
  "Electric",
  "Power",
  "Light & Power",
  "Electric Cooperative",
  "Municipal Light",
  "Power Authority",
  "Energy",
] as const;

interface MunicipalPlant {
  tileId: TerritoryTileId;
  facility: {
    name: string;
    fuel: FuelNameType;
    peakW: number;
    yearsToBuildLeft: 0;
  };
}

interface MunicipalUtility {
  name: string;
  city: TerritoryTileDefinition;
  plant?: MunicipalPlant;
}

const plantSpecs = [
  [
    "parcel-1:city",
    "parcel-0:site-1",
    "Natural Gas",
    "Natural Gas Peaker",
    55e6,
  ],
  ["parcel-5:city", "parcel-4:site-1", "Oil", "Oil", 30e6],
  [
    "parcel-9:city",
    "parcel-10:site-0",
    "Natural Gas",
    "Natural Gas Peaker",
    55e6,
  ],
  ["parcel-11:city", "parcel-12:site-0", "Oil", "Oil", 30e6],
] as const;

function utilityName(city: TerritoryTileDefinition) {
  const suffix =
    suffixes[
      territoryCoordinateHash(city.q, city.r, "municipal-utility") %
        suffixes.length
    ];
  return `${city.city?.name ?? "Township"} ${suffix}`;
}

const municipalUtilities = plantSpecs.map(
  ([cityId, tileId, fuel, name, peakW]): MunicipalUtility => {
    const city = getAuthoredTerritoryTile(cityId)!;
    return {
      city,
      name: utilityName(city),
      plant: { tileId, facility: { name, fuel, peakW, yearsToBuildLeft: 0 } },
    };
  },
);
const byCity = new Map(
  municipalUtilities.map((utility) => [utility.city.id, utility]),
);
export const municipalPlantAt = new Map(
  municipalUtilities.map((utility) => [utility.plant!.tileId, utility]),
);

export function municipalUtilityAt(
  tile: TerritoryTileDefinition,
): MunicipalUtility | undefined {
  if (tile.city && tile.territoryId.startsWith("frontier:"))
    return { city: tile, name: utilityName(tile) };
  return byCity.get(tile.id) ?? municipalPlantAt.get(tile.id);
}
