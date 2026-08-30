import {
  FacilityOperatingType,
  FuelNameType,
  MonthlyHistoryType,
  StoryPeriodSnapshotType,
  StorySnapshotType,
} from "../Types";
import { summarizeHistory } from "./DateTime";
import { facilityAgeYears } from "./Financials";

const VARIABLE_FUELS = new Set<FuelNameType>([
  "Sun",
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
]);

export function buildStoryPeriodSnapshot(
  monthlyHistory: MonthlyHistoryType[],
  months: number,
): StoryPeriodSnapshotType {
  const summary = summarizeHistory(monthlyHistory.slice(0, months));
  const expenses =
    summary.expensesFuel +
    summary.expensesOM +
    summary.expensesCarbonFee +
    summary.expensesInterest;
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
    const generatorFuel = facility.peakWh ? undefined : facility.fuel;
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
    if (facility.peakWh) {
      storagePeakW += facility.peakW;
      storagePeakWh += facility.peakWh;
    } else if (!VARIABLE_FUELS.has(facility.fuel)) {
      firmPeakW += facility.peakW;
    }
  });
  const expenses =
    prior12Months.expensesFuel +
    prior12Months.expensesOM +
    prior12Months.expensesCarbonFee +
    prior12Months.expensesInterest;
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
