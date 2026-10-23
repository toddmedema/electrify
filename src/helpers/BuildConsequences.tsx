import { FacilityShoppingType, isStorage } from "../Types";
import { formatWatts, formatBuildMonths } from "./Format";

export function buildConsequenceMessage(
  facility: FacilityShoppingType,
): string {
  const plant = `${facility.name.toLowerCase()}${isStorage(facility) ? "" : " plant"}`;
  return `Construction started: new ${plant} will be online in ${formatBuildMonths(facility.yearsToBuild, "long")}`;
}

/** A short event-feed title for the commitment itself. */
export function buildStartedMessage(facility: FacilityShoppingType): string {
  if (isStorage(facility)) {
    const duration = Math.round((facility.peakWh / facility.peakW) * 10) / 10;
    return `Started construction on ${duration}hr ${formatWatts(facility.peakW)} ${facility.name}`;
  }
  return `Started construction on ${formatWatts(facility.peakW)} ${facility.name}`;
}
