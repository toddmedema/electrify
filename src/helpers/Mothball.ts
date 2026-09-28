import { FUELS, GAME_TO_REAL_YEARS } from "../Constants";
import {
  FacilityOperatingType,
  GeneratorOperatingType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";

/**
 * Thermal plants whose minimum stable output exceeds average useful load. This is a prompt to
 * inspect dispatch, not proof of losses: monthly averages cannot establish hourly economics.
 */
export function generatorsAboveDemandFloor(
  facilities: FacilityOperatingType[],
  month: Pick<MonthlyHistoryType, "demandWh"> & {
    chartAverage?: Pick<TickPresentFutureType, "exportedW" | "storageChargeW">;
  },
): GeneratorOperatingType[] {
  // Monthly totals integrate the simulated day and scale it up to a real month
  const averageUsefulLoadW =
    month.demandWh / ((MINUTES_PER_MONTH / 60) * GAME_TO_REAL_YEARS) +
    (month.chartAverage?.exportedW || 0) +
    (month.chartAverage?.storageChargeW || 0);
  return facilities.filter(
    (facility): facility is GeneratorOperatingType =>
      !facility.peakWh &&
      facility.yearsToBuildLeft === 0 &&
      !facility.paused &&
      facility.committed !== false &&
      facility.fuel !== undefined &&
      (FUELS[facility.fuel]?.kgCO2ePerBtu || 0) > 0 &&
      facility.peakW * (facility.minimumStableOutput || 0) > averageUsefulLoadW,
  );
}

export function mothballAdvice(generator: GeneratorOperatingType): string {
  return `${generator.name} has a ${Math.round((generator.minimumStableOutput || 0) * 100)}% minimum output above last month's average customer demand, exports and storage charging. Consider pausing it on the Facilities screen to reduce surplus fuel use, while keeping enough supply for peak demand.`;
}
