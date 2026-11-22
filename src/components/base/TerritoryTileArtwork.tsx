import type { TerrainWeather } from "../../helpers/TerritoryDisasters";
import * as React from "react";
import type {
  CitySizeType,
  FacilityOperatingType,
  FuelNameType,
  TerrainType,
} from "../../Types";
import PlainsTerrain from "./territory-art/PlainsTerrain";
import ForestTerrain from "./territory-art/ForestTerrain";
import HillsTerrain from "./territory-art/HillsTerrain";
import MountainTerrain from "./territory-art/MountainTerrain";
import RiverTerrain from "./territory-art/RiverTerrain";
import LakeTerrain from "./territory-art/LakeTerrain";
import OceanTerrain from "./territory-art/OceanTerrain";
import TowerOccupant from "./territory-art/TowerOccupant";
import CityOccupant from "./territory-art/CityOccupant";
import GeneratorOccupant, {
  GeneratorOccupantVariant,
} from "./territory-art/GeneratorOccupant";
import StorageOccupant from "./territory-art/StorageOccupant";

export { TERRAIN_LABELS } from "../../data/TerrainLabels";
const terrainArt: Record<
  Exclude<TerrainType, "forest">,
  React.ComponentType<{ className?: string; frostFill?: string }>
> = {
  plains: PlainsTerrain,
  hills: HillsTerrain,
  mountain: MountainTerrain,
  river: RiverTerrain,
  lake: LakeTerrain,
  ocean: OceanTerrain,
};
export function TerrainArtwork({
  terrain,
  ports,
  className,
  weather,
  frostFill,
}: {
  terrain: TerrainType;
  ports?: readonly number[];
  className?: string;
  weather?: TerrainWeather;
  frostFill?: string;
}) {
  if (terrain === "forest")
    return (
      <ForestTerrain
        className={className}
        weather={weather}
        frostFill={frostFill}
      />
    );
  const Art = terrainArt[terrain];
  return terrain === "river" ? (
    <RiverTerrain ports={ports} className={className} frostFill={frostFill} />
  ) : (
    <Art className={className} frostFill={frostFill} />
  );
}
/** Explicit mapping keeps a new domain fuel from silently becoming a generic power symbol. */
export const GENERATOR_ART: Record<FuelNameType, GeneratorOccupantVariant> = {
  Coal: "thermal",
  Biomass: "biomass",
  Wind: "wind",
  "Offshore Wind": "offshore-wind",
  "Airborne Wind": "airborne-wind",
  Sun: "solar",
  "Natural Gas": "thermal",
  Uranium: "nuclear",
  Oil: "thermal",
  Geothermal: "geothermal",
  Hydro: "hydro",
};
export type MapArtFacility = Pick<
  FacilityOperatingType,
  "fuel" | "name" | "peakWh"
>;
export function FacilityArtwork({
  facility,
  className,
  active = false,
  hailDamaged = false,
}: {
  facility: MapArtFacility;
  className?: string;
  active?: boolean;
  hailDamaged?: boolean;
}) {
  if (facility.peakWh !== undefined)
    return (
      <StorageOccupant
        variant={
          facility.name === "Pumped Hydro"
            ? "pumped-hydro"
            : facility.name === "Iron-Air Battery"
              ? "iron-air"
              : "battery"
        }
        className={className}
        active={active}
      />
    );
  return facility.fuel ? (
    <GeneratorOccupant
      variant={GENERATOR_ART[facility.fuel]}
      className={className}
      active={active}
      hailDamaged={hailDamaged && facility.fuel === "Sun"}
    />
  ) : null;
}
export function TowerArtwork({ className }: { className?: string }) {
  return <TowerOccupant className={className} />;
}
export function CityArtwork({
  size,
  growth,
  className,
}: {
  size: CitySizeType;
  growth?: React.ComponentProps<typeof CityOccupant>["growth"];
  className?: string;
}) {
  return <CityOccupant size={size} growth={growth} className={className} />;
}
