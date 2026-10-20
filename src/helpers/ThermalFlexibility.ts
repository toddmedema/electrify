import type {
  DeferredResidentialLoad,
  LocationType,
  PolicyProgramType,
} from "../Types";
import { TICK_MINUTES } from "../Constants";
import {
  THERMAL_FLEXIBILITY,
  smartHeatingAvailability,
  thermalEquipmentProfile,
  waterControlAvailability,
} from "../data/ThermalFlexibility";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

const boundedShare = (share: number) => Math.max(0, Math.min(1, share));

function equipmentAt(location: LocationType, year: number) {
  const profile = thermalEquipmentProfile(location);
  const enrollment = THERMAL_FLEXIBILITY.enrollment;
  const water = waterControlAvailability(year) * enrollment;
  const heating = smartHeatingAvailability(year) * enrollment;
  return {
    hotWaterLoadShare: profile.hotWaterLoadShare * water,
    weatherControlShare: profile.electricHeatingShare * heating,
    waterCustomers: profile.hotWaterCustomerShare * water,
    heatingCustomers: profile.electricHeatingShare * heating,
  };
}

/** Cohorts retain the equipment available at installation. A relay installed in 1980 never
 * acquires a connected thermostat merely because the game reaches 2025. Monthly rewards cover
 * maintaining the installed controls; they do not upgrade the technology in old cohorts. */
export function thermalFleet(
  location: LocationType,
  program: PolicyProgramType,
  startingYear: number,
) {
  const fleet = {
    hotWaterLoadShare: 0,
    weatherControlShare: 0,
    waterCustomers: 0,
    heatingCustomers: 0,
    controlledCustomerShare: 0,
  };
  const cohorts = program.installs ?? [[0, program.adoption]];
  for (const [month, share] of cohorts) {
    const year = getDateFromMinute(
      month * MINUTES_PER_MONTH,
      startingYear,
    ).year;
    const equipment = equipmentAt(location, year);
    fleet.hotWaterLoadShare += equipment.hotWaterLoadShare * share;
    fleet.weatherControlShare += equipment.weatherControlShare * share;
    fleet.waterCustomers += equipment.waterCustomers * share;
    fleet.heatingCustomers += equipment.heatingCustomers * share;
  }
  // A household with both controls is paid for both services. This is a count of controlled
  // equipment subscriptions rather than a claim about unique households.
  fleet.controlledCustomerShare = fleet.waterCustomers + fleet.heatingCustomers;
  return fleet;
}

/** Full rollout's controller rebates per starting utility customer, before game inflation. */
export function thermalCapitalCostPerCustomer(
  location: LocationType,
  year: number,
): number {
  const equipment = equipmentAt(location, year);
  return (
    equipment.waterCustomers * THERMAL_FLEXIBILITY.waterControllerCost +
    equipment.heatingCustomers * THERMAL_FLEXIBILITY.heatingControllerCost
  );
}

/** Recurring participation/maintenance payments per utility customer per calendar month. */
export function thermalMonthlyRewardPerCustomer(
  location: LocationType,
  program: PolicyProgramType,
  startingYear: number,
): number {
  if (program.tier === "Off") return 0;
  const fleet = thermalFleet(location, program, startingYear);
  return (
    (fleet.waterCustomers * THERMAL_FLEXIBILITY.annualWaterReward +
      fleet.heatingCustomers * THERMAL_FLEXIBILITY.annualHeatingReward) /
    12
  );
}

export function validDeferredThermal(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry: DeferredResidentialLoad) =>
      entry &&
      Number.isFinite(entry.energyWh) &&
      entry.energyWh >= 0 &&
      Number.isInteger(entry.recoveryStartMinute) &&
      entry.recoveryStartMinute >= 0 &&
      entry.recoveryEndMinute ===
        entry.recoveryStartMinute + THERMAL_FLEXIBILITY.recoveryMinutes,
  );
}

export interface ThermalDemandInput {
  minute: number;
  /** Remaining native load after efficiency and TOU; exclude recovered/deferred energy. */
  residentialW: number;
  weatherShare: number;
  temperatureC: number;
  location: LocationType;
  startingYear: number;
  program: PolicyProgramType;
  deferred?: readonly DeferredResidentialLoad[];
  stepMinutes?: number;
}

/** Throttle a bounded part of eligible heat through the chosen four-hour window, then repay all
 * deferred Wh over three hours. The queue is independent of the current tier/window/month.
 * Partial overlap is integrated so 15- and 60-minute forecasts conserve the same energy. */
export function shiftThermalDemand({
  minute,
  residentialW,
  weatherShare,
  temperatureC,
  location,
  startingYear,
  program,
  deferred = [],
  stepMinutes = TICK_MINUTES,
}: ThermalDemandInput) {
  if (!Number.isFinite(stepMinutes) || stepMinutes <= 0)
    throw new Error("Thermal demand needs a positive finite step length");
  const queue = deferred.map((entry) => ({ ...entry }));
  const fleet = thermalFleet(location, program, startingYear);
  const weather = boundedShare(weatherShare);
  const eligibleFraction = boundedShare(
    (1 - weather) * fleet.hotWaterLoadShare +
      (temperatureC < 18 ? weather * fleet.weatherControlShare : 0),
  );
  const load = Math.max(0, residentialW);
  const endMinute = minute + stepMinutes;
  let shiftedWh = 0;
  if (program.tier === "On" && eligibleFraction > 0) {
    const start = (program.startHour ?? 17) * 60;
    const firstDay = Math.floor((minute - start) / MINUTES_PER_MONTH);
    const lastDay = Math.floor((endMinute - start) / MINUTES_PER_MONTH);
    for (let day = firstDay; day <= lastDay; day++) {
      const peakStart = day * MINUTES_PER_MONTH + start;
      const recoveryStartMinute = peakStart + THERMAL_FLEXIBILITY.peakMinutes;
      const duration = Math.max(
        0,
        Math.min(endMinute, recoveryStartMinute) - Math.max(minute, peakStart),
      );
      const energyWh =
        (load *
          eligibleFraction *
          THERMAL_FLEXIBILITY.dispatchFraction *
          THERMAL_FLEXIBILITY.availability *
          duration) /
        60;
      if (energyWh === 0) continue;
      let batch = queue.find(
        (entry) => entry.recoveryStartMinute === recoveryStartMinute,
      );
      if (!batch) {
        batch = {
          energyWh: 0,
          recoveryStartMinute,
          recoveryEndMinute:
            recoveryStartMinute + THERMAL_FLEXIBILITY.recoveryMinutes,
        };
        queue.push(batch);
      }
      batch.energyWh += energyWh;
      shiftedWh += energyWh;
    }
  }
  let recoveredWh = 0;
  for (const batch of queue) {
    // A trimmed forecast should start from the matching saved queue. If a valid old batch is
    // nevertheless overdue, repay it now instead of silently deleting the energy obligation.
    if (batch.recoveryEndMinute <= minute) {
      recoveredWh += batch.energyWh;
      batch.energyWh = 0;
      continue;
    }
    const start = Math.max(minute, batch.recoveryStartMinute);
    const duration = Math.max(
      0,
      Math.min(endMinute, batch.recoveryEndMinute) - start,
    );
    if (duration === 0) continue;
    const energyWh =
      (batch.energyWh * duration) / (batch.recoveryEndMinute - start);
    recoveredWh += energyWh;
    batch.energyWh = Math.max(0, batch.energyWh - energyWh);
  }
  const shiftedW = (shiftedWh * 60) / stepMinutes;
  const recoveredW = (recoveredWh * 60) / stepMinutes;
  return {
    residentialW: load - shiftedW + recoveredW,
    deferred: queue.filter((entry) => entry.energyWh > 0),
    shiftedW,
    recoveredW,
    eligibleFraction,
  };
}
