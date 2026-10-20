import type { GameType, PolicyId } from "../Types";
import { getInflationIndex } from "../data/Economy";
import {
  MANAGED_CHARGING,
  electricVehicleEligibility,
  managedChargingAnnualCost,
} from "../data/ElectricVehicles";
import {
  CUSTOMER_BATTERIES,
  batteryEligibleHouseholdShare,
  batteryEnrollmentShare,
  batteryRebateCost,
} from "../data/CustomerBatteries";
import { THERMAL_FLEXIBILITY } from "../data/ThermalFlexibility";
import {
  thermalCapitalCostPerCustomer,
  thermalMonthlyRewardPerCustomer,
} from "./ThermalFlexibility";
import {
  customerBatteryFleet,
  batteryMonthlyCompensation,
} from "./CustomerBatteries";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { programCustomers } from "./ProgramCustomers";

export type FlexibilityPolicyId = "thermal" | "evCharging" | "battery";
export const FLEXIBILITY_IDS: FlexibilityPolicyId[] = [
  "thermal",
  "evCharging",
  "battery",
];
export const isFlexibilityPolicy = (id: PolicyId): id is FlexibilityPolicyId =>
  id === "thermal" || id === "evCharging" || id === "battery";
export const flexibilityMonths = (id: FlexibilityPolicyId) =>
  id === "thermal"
    ? THERMAL_FLEXIBILITY.buildoutMonths
    : id === "battery"
      ? CUSTOMER_BATTERIES.buildoutMonths
      : MANAGED_CHARGING.enrollmentMonths;
const yearAt = (game: GameType, month: number) =>
  game.startingYear + Math.floor(month / 12);
export function flexibilityAvailable(
  game: GameType,
  id: FlexibilityPolicyId,
  month = game.date.monthsElapsed,
): boolean {
  const year = yearAt(game, month);
  if (id === "evCharging")
    return (
      electricVehicleEligibility(year, game.location).smartChargingShare > 0
    );
  if (id === "battery")
    return (
      batteryEligibleHouseholdShare(year, game.location) > 0 &&
      batteryEnrollmentShare(year) > 0
    );
  return thermalCapitalCostPerCustomer(game.location, year) > 0;
}
export function flexibilityCapitalCost(
  game: GameType,
  id: FlexibilityPolicyId,
  month: number,
): number {
  const year = yearAt(game, month);
  const customers = programCustomers(game);
  const cost =
    id === "thermal"
      ? customers * thermalCapitalCostPerCustomer(game.location, year)
      : id === "battery"
        ? batteryRebateCost(customers, 1, year, game.location)
        : 0;
  return (
    cost *
    getInflationIndex(
      getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear),
      game.startingYear,
      game.seed,
    )
  );
}
export function flexibilityMonthlyCost(
  game: GameType,
  id: FlexibilityPolicyId,
  month: number,
  representedTransportationW?: number,
): number {
  const program = game.policies?.programs[id];
  if (!program || program.tier === "Off") return 0;
  const customers = programCustomers(game);
  const cost =
    id === "thermal"
      ? customers *
        thermalMonthlyRewardPerCustomer(
          game.location,
          program,
          game.startingYear,
        )
      : id === "evCharging"
        ? managedChargingAnnualCost(
            customers,
            yearAt(game, month),
            game.location,
            MANAGED_CHARGING.maxEnrollment * program.adoption,
            representedTransportationW ??
              (game.timeline.length
                ? game.timeline.reduce(
                    (sum, tick) => sum + tick.demandByType.Transportation,
                    0,
                  ) / game.timeline.length
                : 0),
          ) / 12
        : batteryMonthlyCompensation(
            customerBatteryFleet(
              program,
              month,
              game.startingYear,
              customers,
              game.location,
            ),
          );
  return (
    cost *
    getInflationIndex(
      getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear),
      game.startingYear,
      game.seed,
    )
  );
}
