import { FacilityShoppingType } from "../Types";
import { ASSUMED_STARTS_PER_YEAR } from "./Financials";

/**
 * Estimated operating history for inherited plants, not starts or expenses incurred in this
 * run. Reuse the quote's duty where supplied (coal and combined-cycle gas); otherwise assume
 * daily peaker cycling, annual nuclear refueling, and occasional baseload maintenance stops.
 * These are deterministic scenario assumptions, not a reconstruction of historical dispatch.
 */
export function startingFacilityStarts(
  facility: FacilityShoppingType,
  ageYears: number,
): number {
  if (!facility.tracksStarts || ageYears <= 0) return 0;
  const annualStarts =
    facility.assumedStartsPerYear ??
    (facility.fuel === "Uranium"
      ? 1
      : facility.fuel === "Geothermal"
        ? 2
        : facility.fuel === "Biomass"
          ? 20
          : ASSUMED_STARTS_PER_YEAR);
  return Math.round(ageYears * annualStarts);
}
