import type { FacilityShoppingType, TerrainType } from "../Types";

type LandTerrain = Exclude<TerrainType, "river" | "lake" | "ocean">;
type CapacityClass = "solar" | "wind" | "compact";

/** Fictional per-tile siting allowances, in watts; see docs/territories.md for their basis. */
const LAND_POWER_LIMITS: Readonly<
  Record<LandTerrain, Readonly<Record<CapacityClass, number>>>
> = {
  plains: { solar: 150e6, wind: 300e6, compact: 1000e6 },
  forest: { solar: 75e6, wind: 200e6, compact: 600e6 },
  hills: { solar: 100e6, wind: 450e6, compact: 750e6 },
  mountain: { solar: 25e6, wind: 450e6, compact: 400e6 },
};

/** The omitted technology reports physical inventory, before a project has been selected. */
export function terrainBuildingPowerLimit(
  terrain: TerrainType,
  facility?: Pick<FacilityShoppingType, "fuel" | "peakWh">,
): number {
  if (terrain === "river" || terrain === "lake" || terrain === "ocean")
    return 0;
  const limits = LAND_POWER_LIMITS[terrain];
  if (!facility) return Math.max(...Object.values(limits));
  const kind =
    facility.fuel === "Sun"
      ? "solar"
      : facility.fuel === "Wind" || facility.fuel === "Airborne Wind"
        ? "wind"
        : "compact";
  return limits[kind];
}
