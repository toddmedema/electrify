import * as React from "react";
import type {
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
  TerrainType,
  React.ComponentType<{ className?: string }>
> = {
  plains: PlainsTerrain,
  forest: ForestTerrain,
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
}: {
  terrain: TerrainType;
  ports?: readonly number[];
  className?: string;
}) {
  const Art = terrainArt[terrain];
  return terrain === "river" ? (
    <RiverTerrain ports={ports} className={className} />
  ) : (
    <Art className={className} />
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
}: {
  facility: MapArtFacility;
  className?: string;
  active?: boolean;
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
    />
  ) : null;
}
export function TowerArtwork({ className }: { className?: string }) {
  return <TowerOccupant className={className} />;
}
export function CityArtwork({
  sector,
  className,
}: {
  sector: "residential" | "industrial";
  className?: string;
}) {
  return <CityOccupant variant={sector} className={className} />;
}
