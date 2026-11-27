import { ScenarioType } from "../Types";
import { getStartingFacilityAge } from "../data/StartingFacilityAges";
import { forecastCustomGameTimeline } from "./CustomGameForecast";
import {
  createDataCenterScenario,
  DATA_CENTER_DIFFICULTY,
  DATA_CENTER_SEED,
  withoutDataCenterGrowth,
} from "./DataCenterScenario";
import { DataCenterSetupRequest } from "./DataCenterSetup";
import { sizeStartingFleet } from "./StartingFleetSizing";

export const DATA_CENTER_RESERVE_LABEL = "Modeled balancing reserve";

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
  scenario = {
    ...scenario,
    facilities: sizeStartingFleet(
      withoutDataCenterGrowth(scenario),
      forecast,
      // Physical hydro sites and regional imports cannot always be represented.
      // Make the missing firm supply explicit rather than inventing local hydro.
      (shortfallW) => ({
        name: "Natural Gas CC",
        fuel: "Natural Gas",
        peakW: Math.ceil(shortfallW),
        label: DATA_CENTER_RESERVE_LABEL,
        initialAgeYears: getStartingFacilityAge(
          location,
          "Natural Gas",
          startingYear,
          "Natural Gas CC",
        ).ageYears,
      }),
    ),
  };
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
