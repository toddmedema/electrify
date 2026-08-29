import { DOWNPAYMENT_PERCENT } from "../Constants";
import { FacilityShoppingType, GeneratorShoppingType } from "../Types";
import { formatMoneyConcise, formatWattHours, formatWatts } from "./Format";

export function buildConsequenceMessage(
  facility: FacilityShoppingType,
  financed: boolean,
): string {
  const committed = financed
    ? facility.buildCost * DOWNPAYMENT_PERCENT
    : facility.buildCost;
  const months = Math.round(facility.yearsToBuild * 12);
  const contribution = facility.peakWh
    ? `${formatWatts(facility.peakW)} output / ${formatWattHours(facility.peakWh)} storage`
    : `${formatWatts(
        facility.peakW * (facility as GeneratorShoppingType).capacityFactor,
      )} typical supply`;
  return `${formatMoneyConcise(committed)} ${
    financed ? "down payment" : "committed"
  } → ${facility.name} online in ${months} mo → +${contribution}`;
}
