import { FacilityOperatingType } from "../../Types";

// Match the fleet row's warning to the rounded percentage the player sees. In particular,
// 19.5% displays as 20% and remains normal; 19.49% displays as 19% and warns.
const RESERVOIR_WARNING_PERCENT = 20;

export function facilityReservoirReading(
  facility: FacilityOperatingType,
): { percent: number; low: boolean } | undefined {
  if (facility.fuel !== "Hydro" || !facility.reservoirCapacityWh)
    return undefined;
  const percent = Math.round(
    ((facility.reservoirWh || 0) / facility.reservoirCapacityWh) * 100,
  );
  return { percent, low: percent < RESERVOIR_WARNING_PERCENT };
}
