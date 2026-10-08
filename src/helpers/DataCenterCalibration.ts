import { ScenarioType } from "../Types";
import { HYDRO_SITES } from "../data/HydroSites";
import {
  forecastCustomGameTimeline,
  summarizeYearOneOutlook,
} from "./CustomGameForecast";
import {
  createDataCenterScenario,
  DATA_CENTER_DIFFICULTY,
  DATA_CENTER_SEED,
  withoutDataCenterGrowth,
} from "./DataCenterScenario";
import { DataCenterSetupRequest } from "./DataCenterSetup";

export const DATA_CENTER_RESERVE_LABEL = "Modeled balancing reserve";
/** A model allowance, not a claim about a utility's contracted reserve margin. */
export const DATA_CENTER_SUPPLY_MARGIN = 0.05;

const forecast = (scenario: ScenarioType) =>
  forecastCustomGameTimeline(
    scenario,
    DATA_CENTER_DIFFICULTY,
    DATA_CENTER_SEED,
  );

/** Runs only after simulation data is loaded, normally inside the setup worker. */
export function calibrateDataCenterScenario({
  location,
  startingYear,
  customerProfile: profile,
  startingCustomers = profile.customers,
}: Omit<DataCenterSetupRequest, "requestId">): ScenarioType {
  let scenario = createDataCenterScenario(
    location,
    startingYear,
    startingCustomers,
  );
  if (profile.annualMWh) {
    if (profile.observedPeakW) {
      const targetRatio =
        profile.observedPeakW / ((profile.annualMWh * 1000000) / 8760);
      let lowShape = 0.1;
      let highShape = 8;
      // Fit the weather/day shape to the observed peak-to-average ratio. The
      // complete demand calculation stays in the reducer, including sector growth.
      for (let attempt = 0; attempt < 10; attempt++) {
        const exponent = (lowShape + highShape) / 2;
        const timeline = forecast({
          ...withoutDataCenterGrowth(scenario),
          demandShapeExponent: exponent,
        });
        const mean =
          timeline.reduce((sum, tick) => sum + tick.demandW, 0) /
          timeline.length;
        const ratio = Math.max(...timeline.map((tick) => tick.demandW)) / mean;
        if (ratio < targetRatio) lowShape = exponent;
        else highShape = exponent;
      }
      scenario = {
        ...scenario,
        demandShapeExponent: (lowShape + highShape) / 2,
      };
    }
    // Published sales already contain existing data centers. Scale the complete
    // background forecast, including its sector split, rather than adding them twice.
    const timeline = forecast(withoutDataCenterGrowth(scenario));
    const modeledWh =
      (timeline.reduce((sum, tick) => sum + tick.demandW, 0) /
        timeline.length) *
      8760;
    const targetWh =
      (profile.annualMWh * 1000000 * scenario.startingCustomers!) /
      profile.customers;
    scenario = {
      ...scenario,
      startingDemandScale:
        (scenario.startingDemandScale! * targetWh) / modeledWh,
    };
  }

  // Find the smallest supplied opening portfolio in the real weather/dispatch
  // model. Calibrate only background demand; never absorb the selected new campus.
  const baseFacilities = [...scenario.facilities];
  const sized = (factor: number): ScenarioType => ({
    ...withoutDataCenterGrowth(scenario),
    startingDemandScale:
      scenario.startingDemandScale! * (1 + DATA_CENTER_SUPPLY_MARGIN),
    facilities: baseFacilities.map((facility) => ({
      ...facility,
      peakW: Math.max(
        1,
        Math.min(
          Math.ceil((facility.peakW || 0) * factor),
          facility.hydroSiteId
            ? HYDRO_SITES[facility.hydroSiteId].maxPeakW
            : Infinity,
        ),
      ),
    })),
  });
  let low = 0;
  let high = 1;
  let candidate = sized(high);
  for (let attempt = 0; attempt < 8; attempt++) {
    const outlook = summarizeYearOneOutlook(forecast(candidate));
    if (outlook.worstShortfallW === 0) break;
    low = high;
    high *= 2;
    if (attempt === 3) {
      // Physical hydro sites and regional imports cannot always be represented.
      // Make the missing firm supply explicit rather than inventing local hydro.
      baseFacilities.push({
        name: "Natural Gas CC",
        fuel: "Natural Gas",
        peakW: Math.ceil(outlook.worstShortfallW),
        label: DATA_CENTER_RESERVE_LABEL,
      });
      low = 0;
    }
    candidate = sized(high);
  }
  if (summarizeYearOneOutlook(forecast(candidate)).worstShortfallW > 0) {
    throw new Error(
      "We couldn't prepare a reliable starting grid for this location.",
    );
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const mid = (low + high) / 2;
    const trial = sized(mid);
    if (summarizeYearOneOutlook(forecast(trial)).worstShortfallW === 0) {
      high = mid;
      candidate = trial;
    } else low = mid;
  }
  scenario = { ...scenario, facilities: candidate.facilities };
  const timeline = forecast(withoutDataCenterGrowth(scenario));
  // Leave a full opening budget after the worst projected first-year drawdown.
  const lowestCash = Math.min(
    scenario.cash,
    ...timeline.map((tick) => tick.cash),
  );
  return {
    ...scenario,
    cash: scenario.cash + Math.max(0, scenario.cash - lowestCash),
  };
}
