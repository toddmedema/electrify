import {
  FacilityOperatingType,
  MonthlyHistoryType,
  StoryPeriodSnapshotType,
  StorySnapshotType,
  WorldEventEffectsType,
  isStorage,
} from "../Types";
import { WEATHER_DEPENDENT_FUELS } from "../Constants";
import { summarizeHistory } from "./DateTime";
import { facilityAgeYears } from "./Financials";

/**
 * The share of rated output that active story effects leave a facility: its fuel's derate times
 * any derate aimed at it by id. A multiplier of 0 is a full outage, so a missing entry, and only a
 * missing one, means no limit. The simulation and the fleet list both read this, so they cannot
 * disagree about what a plant can produce.
 */
export function storyOutputMultiplier(
  facility: Pick<FacilityOperatingType, "id" | "fuel">,
  effects: WorldEventEffectsType,
): number {
  const fuel = facility.fuel;
  const byFuel = fuel
    ? (effects.facilityOutputMultipliersByFuel?.[fuel] ?? 1)
    : 1;
  return (
    byFuel * (effects.facilityOutputMultipliersById?.[String(facility.id)] ?? 1)
  );
}

export function buildStoryPeriodSnapshot(
  monthlyHistory: MonthlyHistoryType[],
  months: number,
): StoryPeriodSnapshotType {
  const summary = summarizeHistory(monthlyHistory.slice(0, months));
  const expenses =
    summary.expensesFuel +
    summary.expensesOM +
    summary.expensesCarbonFee +
    summary.expensesInterest +
    (summary.expensesPolicy || 0);
  return {
    deliveredWhByFuel: { ...summary.deliveredWhByFuel },
    demandWh: summary.demandWh,
    unservedWh: Math.max(0, summary.demandWh - summary.supplyWh),
    netIncome: summary.revenue - expenses,
    peakDemandW: summary.peakDemandW,
  };
}

/**
 * Derives the story-facing state from authoritative simulation history and the current fleet.
 * No narrative labels are persisted, so changing checkpoint copy cannot make an existing save
 * disagree with the simulation facts that produced it.
 */
export function buildStorySnapshot(
  monthlyHistory: MonthlyHistoryType[],
  facilities: FacilityOperatingType[],
  currentMinute: number,
): StorySnapshotType {
  const prior12Months = summarizeHistory(monthlyHistory.slice(0, 12));
  const fleet = facilities.map((facility) => {
    const generatorFuel = isStorage(facility) ? undefined : facility.fuel;
    return {
      id: facility.id,
      name: facility.name,
      fuel: generatorFuel,
      ageYears: facilityAgeYears(facility, currentMinute),
      peakW: facility.peakW,
      operational: facility.yearsToBuildLeft <= 0 && !facility.paused,
    };
  });
  let firmPeakW = 0;
  let storagePeakW = 0;
  let storagePeakWh = 0;
  facilities.forEach((facility, index) => {
    if (!fleet[index].operational) {
      return;
    }
    if (isStorage(facility)) {
      storagePeakW += facility.peakW;
      storagePeakWh += facility.peakWh;
    } else if (!WEATHER_DEPENDENT_FUELS.includes(facility.fuel)) {
      firmPeakW += facility.peakW;
    }
  });
  const expenses =
    prior12Months.expensesFuel +
    prior12Months.expensesOM +
    prior12Months.expensesCarbonFee +
    prior12Months.expensesInterest +
    (prior12Months.expensesPolicy || 0);
  return {
    deliveredWhByFuel12m: { ...prior12Months.deliveredWhByFuel },
    demandWh12m: prior12Months.demandWh,
    unservedWh12m: Math.max(0, prior12Months.demandWh - prior12Months.supplyWh),
    netIncome12m: prior12Months.revenue - expenses,
    peakDemandW12m: prior12Months.peakDemandW,
    firmPeakW,
    storagePeakW,
    storagePeakWh,
    // A fleet can be reordered for dispatch without changing a checkpoint's input identity.
    facilities: fleet.sort((a, b) => a.id - b.id),
  };
}
