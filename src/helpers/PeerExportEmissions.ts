import { FUELS } from "../Constants";
import { isStorage } from "../Types";
import type { FacilityOperatingType, GeneratorOperatingType } from "../Types";

/** Native surplus is pooled; additional generation follows the dispatch order. */
export function pooledPeerExportEmissions(
  exportedW: number,
  availableSurplusW: number,
  nativeSupplyW: number,
  facilities: readonly FacilityOperatingType[],
  headroom: readonly { generator: GeneratorOperatingType; watts: number }[],
): number {
  const intensity = (generator: GeneratorOperatingType) =>
    (generator.btuPerWh || 0) *
    (FUELS[generator.fuel]?.kgCO2ePerBtu || 0) *
    1e6;
  const surplusW = Math.min(exportedW, availableSurplusW);
  const nativeWeight = facilities.reduce(
    (sum, facility) =>
      sum +
      (isStorage(facility) || facility.paused
        ? 0
        : facility.currentW * intensity(facility)),
    0,
  );
  let weighted =
    nativeSupplyW > 0 ? (surplusW * nativeWeight) / nativeSupplyW : 0;
  let extraW = Math.max(0, exportedW - surplusW);
  for (const item of headroom) {
    const deliveredW = Math.min(item.watts, extraW);
    extraW -= deliveredW;
    weighted += deliveredW * intensity(item.generator);
  }
  return exportedW > 0 ? weighted / exportedW : 0;
}
