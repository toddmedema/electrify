import { purchaseTerms } from "./Financials";
import { FacilityShoppingType, isStorage } from "../Types";
import {
  formatMoneyConcise,
  formatWattHours,
  formatWatts,
  formatBuildMonths,
} from "./Format";

export function buildConsequenceMessage(
  facility: FacilityShoppingType,
  financed: boolean,
): string {
  // The rate only prices the monthly payment, which this message does not quote
  const committed = purchaseTerms(facility.buildCost, financed, 0).amountDue;
  const contribution = isStorage(facility)
    ? `${formatWatts(facility.peakW)} output / ${formatWattHours(facility.peakWh)} storage`
    : `${formatWatts(facility.peakW * facility.capacityFactor)} typical supply`;
  return `${formatMoneyConcise(committed)} ${
    financed ? "down payment" : "committed"
  } → ${facility.name} online in ${formatBuildMonths(facility.yearsToBuild)} → +${contribution}`;
}

/** A short event-feed title for the commitment itself; the snackbar carries the full forecast. */
export function buildStartedMessage(facility: FacilityShoppingType): string {
  if (isStorage(facility)) {
    const duration = Math.round((facility.peakWh / facility.peakW) * 10) / 10;
    return `Started construction on ${duration}hr ${formatWatts(facility.peakW)} ${facility.name}`;
  }
  return `Started construction on ${formatWatts(facility.peakW)} ${facility.name}`;
}
