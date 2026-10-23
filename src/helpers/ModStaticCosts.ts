import { FACILITY_FUELS } from "../data/FacilityFuels";
import type { ModFacilityNameType, ScenarioModType } from "../Types";

/** Read the owning catalog, including technologies unavailable at the opening date.
 * Storage has no fuel-targeted timed cost factors. Frozen rules and authoring share this map. */
export function modStaticCostFactors(
  facilities: ScenarioModType["facilities"],
) {
  return Object.entries(facilities ?? {}).flatMap(([name, factors]) => {
    const fuel = FACILITY_FUELS[name as ModFacilityNameType];
    return fuel ? [{ fuel, facility: name, ...factors }] : [];
  });
}
