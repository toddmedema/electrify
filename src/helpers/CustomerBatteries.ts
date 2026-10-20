import type { LocationType, PolicyProgramType } from "../Types";
import {
  batteryCohortHouseholds,
  CUSTOMER_BATTERIES,
} from "../data/CustomerBatteries";

export interface CustomerBatteryFleet {
  installedHouseholds: number;
  enrolledHouseholds: number;
  installedPowerW: number;
  installedCapacityWh: number;
  powerW: number;
  capacityWh: number;
  reserveWh: number;
}

export const EMPTY_CUSTOMER_BATTERY_FLEET: CustomerBatteryFleet = {
  installedHouseholds: 0,
  enrolledHouseholds: 0,
  installedPowerW: 0,
  installedCapacityWh: 0,
  powerW: 0,
  capacityWh: 0,
  reserveWh: 0,
};

/** Ten-year energy fade approximates a 70%-retention warranty, rather than asserting that
 * every battery lasts forever. Cohort retirement is spread over years 10-15. */
export function batterySurvival(ageMonths: number): number {
  const { fullLifeMonths, endLifeMonths } = CUSTOMER_BATTERIES;
  if (ageMonths <= fullLifeMonths) return 1;
  if (ageMonths >= endLifeMonths) return 0;
  return (endLifeMonths - ageMonths) / (endLifeMonths - fullLifeMonths);
}

export function customerBatteryFleet(
  program: PolicyProgramType,
  month: number,
  startingYear: number,
  customers: number,
  location: Pick<LocationType, "country" | "region">,
): CustomerBatteryFleet {
  let installedHouseholds = 0;
  let equivalentEnergyHouseholds = 0;
  for (const [installed, share] of program.installs ?? []) {
    if (installed > month) continue;
    const age = month - installed;
    const installationYear = startingYear + Math.floor(installed / 12);
    const houses =
      batteryCohortHouseholds(customers, share, installationYear, location) *
      batterySurvival(age);
    installedHouseholds += houses;
    equivalentEnergyHouseholds += houses * (1 - Math.min(120, age) * 0.0025);
  }
  const installedPowerW =
    installedHouseholds * CUSTOMER_BATTERIES.householdPowerW;
  const installedCapacityWh =
    equivalentEnergyHouseholds * CUSTOMER_BATTERIES.householdEnergyWh;
  return {
    installedHouseholds,
    enrolledHouseholds: installedHouseholds,
    installedPowerW,
    installedCapacityWh,
    powerW: installedPowerW,
    capacityWh: installedCapacityWh,
    reserveWh: installedCapacityWh * CUSTOMER_BATTERIES.reserveShare,
  };
}

export function batteryMonthlyCompensation(
  fleet: CustomerBatteryFleet,
): number {
  return (
    (fleet.enrolledHouseholds * CUSTOMER_BATTERIES.annualPaymentPerHousehold) /
    12
  );
}

export interface CustomerBatteryDispatch {
  storedWh: number;
  rooftopChargeW: number;
  gridChargeW: number;
  chargeW: number;
  dischargeW: number;
  lossWh: number;
}

export const EMPTY_CUSTOMER_BATTERY_DISPATCH: CustomerBatteryDispatch = {
  storedWh: 0,
  rooftopChargeW: 0,
  gridChargeW: 0,
  chargeW: 0,
  dischargeW: 0,
  lossWh: 0,
};

/** Charge only from explicitly supplied surplus after household PV self-consumption or
 * actual grid dispatch. Grid charging is not retail consumption. The caller must subtract
 * gridChargeW from spare supply before exports and add dischargeW to supplied load (or
 * remove it from net residential demand). Stored energy is a representative-day quantity,
 * like utility storage; do not multiply it by the game's real-time compression factor.
 *
 * The two dispatch phases may call this with the same fleet, first with peak deficit and
 * then with surplus. Pass the returned storedWh forward; never use the old tick's energy
 * for both phases. Off retains stored energy, but permits neither charge nor discharge. */
export function dispatchCustomerBattery(
  fleet: CustomerBatteryFleet,
  storedWh: number,
  {
    rooftopSurplusW = 0,
    gridSurplusW = 0,
    deficitW = 0,
    stepMinutes = 15,
    enabled = true,
    peak = false,
  }: {
    rooftopSurplusW?: number;
    gridSurplusW?: number;
    deficitW?: number;
    stepMinutes?: number;
    enabled?: boolean;
    peak?: boolean;
  } = {},
): CustomerBatteryDispatch {
  const startWh = Math.max(0, storedWh);
  let energy = Math.min(startWh, Math.max(0, fleet.capacityWh));
  let lossWh = startWh - energy;
  const hours = Math.max(0, stepMinutes) / 60;
  let rooftopChargeW = 0;
  let gridChargeW = 0;
  let dischargeW = 0;
  if (enabled && hours > 0) {
    if (peak && deficitW > 0) {
      dischargeW = Math.max(
        0,
        Math.min(deficitW, fleet.powerW, (energy - fleet.reserveWh) / hours),
      );
      energy -= dischargeW * hours;
    } else {
      const chargeLimit = Math.max(
        0,
        Math.min(
          fleet.powerW,
          (fleet.capacityWh - energy) /
            (hours * CUSTOMER_BATTERIES.chargeEfficiency),
        ),
      );
      rooftopChargeW = Math.min(Math.max(0, rooftopSurplusW), chargeLimit);
      // Peak-window grid energy is left for customer load and reserves. Rooftop surplus
      // can still be recovered because it cannot supply that load in the existing model.
      gridChargeW = peak
        ? 0
        : Math.min(Math.max(0, gridSurplusW), chargeLimit - rooftopChargeW);
      const chargeWh = (rooftopChargeW + gridChargeW) * hours;
      energy += chargeWh * CUSTOMER_BATTERIES.chargeEfficiency;
      lossWh += chargeWh * (1 - CUSTOMER_BATTERIES.chargeEfficiency);
    }
  }
  return {
    storedWh: energy,
    rooftopChargeW,
    gridChargeW,
    chargeW: rooftopChargeW + gridChargeW,
    dischargeW,
    lossWh,
  };
}
