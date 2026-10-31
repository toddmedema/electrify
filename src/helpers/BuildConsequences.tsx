import { FacilityShoppingType, isStorage } from "../Types";
import { formatWatts, formatBuildMonths } from "./Format";

export function buildConsequenceMessage(
  facility: FacilityShoppingType,
): string {
  const plant = `${facility.name.toLowerCase()}${isStorage(facility) ? "" : " plant"}`;
  return `Construction started: ${plant} online in ${formatBuildMonths(facility.yearsToBuild, "long")}`;
}

/** The confirmation for a newly approved intertie, shared by every place that can buy one. */
export function intertieApprovedMessage(yearsToBuild: number): string {
  return `Intertie approved. Online in ${formatBuildMonths(yearsToBuild, "long")}.`;
}

export const INTERTIE_UPGRADE_APPROVED =
  "Upgrade approved. Line stays in service.";

/** A short event-feed title for the commitment itself. */
export function buildStartedMessage(facility: FacilityShoppingType): string {
  if (isStorage(facility)) {
    const duration = Math.round((facility.peakWh / facility.peakW) * 10) / 10;
    return `Started construction on ${duration}hr ${formatWatts(facility.peakW)} ${facility.name}`;
  }
  return `Started construction on ${formatWatts(facility.peakW)} ${facility.name}`;
}
