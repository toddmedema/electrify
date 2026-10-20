import type { DeferredResidentialLoad, LocationType } from "../Types";
import {
  MANAGED_CHARGING,
  electricVehicleEligibility,
} from "../data/ElectricVehicles";

interface ManagedChargingInput {
  minute: number;
  transportationW: number;
  customers: number;
  year: number;
  location?: LocationType;
  /** Actual share of compatible EVs enrolled, after the policy's enrollment ramp. */
  enrollment: number;
  startHour?: number;
  deferred?: readonly DeferredResidentialLoad[];
  stepMinutes?: number;
}

/** Only existing road-EV charging can move; rail and other transport remain unchanged.
 * Queued energy belongs to the charging session, so cancellation or a month rollover cannot
 * erase it. All accepted charging returns within six hours after the four-hour peak window.
 * The caller owns this queue independently of the residential time-of-use queue. */
export function shiftManagedCharging({
  minute,
  transportationW,
  customers,
  year,
  location,
  enrollment,
  startHour = 17,
  deferred = [],
  stepMinutes = 15,
}: ManagedChargingInput) {
  const queue = deferred.map((entry) => ({ ...entry }));
  const baselineW = Math.max(0, transportationW);
  if (!Number.isFinite(stepMinutes) || stepMinutes <= 0)
    return {
      transportationW: baselineW,
      deferred: queue,
      shiftedW: 0,
      recoveredW: 0,
    };
  const { fleetShare, smartChargingShare, eligibleTransportationShare } =
    electricVehicleEligibility(year, location);
  const dayMinutes = 1440;
  const offset =
    (((minute - startHour * 60) % dayMinutes) + dayMinutes) % dayMinutes;
  const participating = Math.max(
    0,
    Math.min(MANAGED_CHARGING.maxEnrollment, enrollment),
  );
  // A stock-based energy ceiling prevents a tiny 2015 fleet controlling an arbitrarily large
  // transport sector. The separate share ceiling always leaves an inflexible transport floor.
  const fleetChargingW =
    (Math.max(0, customers) *
      MANAGED_CHARGING.vehiclesPerCustomer *
      fleetShare *
      MANAGED_CHARGING.dailyChargingWhPerVehicle) /
    24;
  const movableW =
    Math.min(baselineW * eligibleTransportationShare, fleetChargingW) *
    smartChargingShare *
    participating *
    (1 - MANAGED_CHARGING.overrideShare) *
    MANAGED_CHARGING.incrementalShiftShare;
  let shiftedW = 0;
  for (
    let windowStart = minute - offset;
    windowStart < minute + stepMinutes;
    windowStart += dayMinutes
  ) {
    const windowEnd = windowStart + MANAGED_CHARGING.peakMinutes;
    const overlap = Math.max(
      0,
      Math.min(minute + stepMinutes, windowEnd) - Math.max(minute, windowStart),
    );
    if (movableW <= 0 || overlap === 0) continue;
    shiftedW += (movableW * overlap) / stepMinutes;
    const recoveryStartMinute = windowEnd;
    let batch = queue.find(
      (entry) => entry.recoveryStartMinute === recoveryStartMinute,
    );
    if (!batch) {
      batch = {
        energyWh: 0,
        recoveryStartMinute,
        recoveryEndMinute:
          recoveryStartMinute + MANAGED_CHARGING.recoveryMinutes,
      };
      queue.push(batch);
    }
    batch.energyWh += (movableW * overlap) / 60;
  }
  let recoveredW = 0;
  for (const batch of queue) {
    const start = Math.max(minute, batch.recoveryStartMinute);
    const remainingMinutes = batch.recoveryEndMinute - start;
    // Forecast/restart callers that jump past a deadline must return the obligation, never
    // silently drop it. Ordinary 15-minute simulation ticks drain each batch at its deadline.
    const duration = Math.max(
      0,
      Math.min(minute + stepMinutes, batch.recoveryEndMinute) - start,
    );
    const recoveredWh =
      remainingMinutes <= 0
        ? batch.energyWh
        : (batch.energyWh * duration) / remainingMinutes;
    recoveredW += (recoveredWh * 60) / stepMinutes;
    batch.energyWh = Math.max(0, batch.energyWh - recoveredWh);
  }
  return {
    transportationW: baselineW - shiftedW + recoveredW,
    deferred: queue.filter((entry) => entry.energyWh > 0),
    shiftedW,
    recoveredW,
  };
}
