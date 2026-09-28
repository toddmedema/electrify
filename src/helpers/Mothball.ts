import { FUELS, GAME_TO_REAL_YEARS } from "../Constants";
import {
  FacilityOperatingType,
  GeneratorOperatingType,
  MonthlyHistoryType,
} from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";

/**
 * Thermal plants whose minimum stable output exceeded the month's average demand, so they spent
 * most of it burning fuel for energy the grid could not use. After a customer base shrinks, a
 * must-run coal plant can do this for years (and push reported emissions intensity absurdly
 * high) while nothing tells the player that pausing it would stop the losses.
 */
export function generatorsAboveDemandFloor(
  facilities: FacilityOperatingType[],
  month: Pick<MonthlyHistoryType, "demandWh">,
): GeneratorOperatingType[] {
  // Monthly totals integrate the simulated day and scale it up to a real month
  const averageDemandW =
    month.demandWh / ((MINUTES_PER_MONTH / 60) * GAME_TO_REAL_YEARS);
  return facilities.filter(
    (facility): facility is GeneratorOperatingType =>
      !facility.peakWh &&
      facility.yearsToBuildLeft === 0 &&
      !facility.paused &&
      facility.committed !== false &&
      facility.fuel !== undefined &&
      (FUELS[facility.fuel]?.kgCO2ePerBtu || 0) > 0 &&
      facility.peakW * (facility.minimumStableOutput || 0) > averageDemandW,
  );
}

export function mothballAdvice(generator: GeneratorOperatingType): string {
  return `${generator.name} ran above demand at its ${Math.round((generator.minimumStableOutput || 0) * 100)}% minimum output for most of last month, paying for fuel the grid could not use. Pause it on the Facilities screen to stop the losses.`;
}
