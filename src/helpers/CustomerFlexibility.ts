import type { GameType, PolicyId } from "../Types";
import { getInflationIndex } from "../data/Economy";
import {
  MANAGED_CHARGING,
  managedChargingAvailable,
  managedChargingAnnualCost,
} from "../data/ElectricVehicles";
import {
  CUSTOMER_BATTERIES,
  homeBatteryProgramAvailable,
} from "../data/CustomerBatteries";
import {
  customerBatteryFleet,
  batteryMonthlyCompensation,
} from "./CustomerBatteries";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { programCustomers } from "./ProgramCustomers";

export type FlexibilityPolicyId = "evCharging" | "battery";
export const FLEXIBILITY_IDS: FlexibilityPolicyId[] = ["evCharging", "battery"];
export const isFlexibilityPolicy = (id: PolicyId): id is FlexibilityPolicyId =>
  id === "evCharging" || id === "battery";
export const flexibilityMonths = (id: FlexibilityPolicyId) =>
  id === "battery"
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
  return id === "evCharging"
    ? managedChargingAvailable(year, game.location)
    : homeBatteryProgramAvailable(year);
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
    id === "evCharging"
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
