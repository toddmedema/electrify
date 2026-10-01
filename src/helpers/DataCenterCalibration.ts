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

/** Runs only after simulation data is loaded, normally inside the setup worker. */
export function calibrateDataCenterScenario({
  location,
  startingYear,
  startingCustomers,
}: Omit<DataCenterSetupRequest, "requestId">): ScenarioType {
  let scenario = createDataCenterScenario(
    location,
    startingYear,
    startingCustomers,
  );
  for (let attempt = 0; attempt < 8; attempt++) {
    const timeline = forecastCustomGameTimeline(
      withoutDataCenterGrowth(scenario),
      DATA_CENTER_DIFFICULTY,
      DATA_CENTER_SEED,
    );
    const outlook = summarizeYearOneOutlook(timeline);
    if (outlook.worstShortfallW === 0) {
      // Leave a full opening budget after the worst projected first-year cash drawdown.
      const lowestCash = Math.min(
        scenario.cash,
        ...timeline.map((tick) => tick.cash),
      );
      return {
        ...scenario,
        cash: scenario.cash + Math.max(0, scenario.cash - lowestCash),
      };
    }
    // Scale the researched portfolio first, respecting physical hydro ceilings.
    // A hydro-dependent region may have no usable local site in the game. In
    // that case add explicitly labeled model backup, not invented local plants.
    if (attempt >= 3) {
      const extra = Math.ceil(outlook.worstShortfallW * 2);
      const existing = scenario.facilities.filter(
        (facility) => facility.label === DATA_CENTER_RESERVE_LABEL,
      );
      scenario = {
        ...scenario,
        facilities: existing.length
          ? scenario.facilities.map((facility) =>
              facility.label === DATA_CENTER_RESERVE_LABEL
                ? { ...facility, peakW: (facility.peakW || 0) + extra }
                : facility,
            )
          : [
              ...scenario.facilities,
              {
                name: "Natural Gas CC",
                fuel: "Natural Gas",
                peakW: extra,
                label: DATA_CENTER_RESERVE_LABEL,
              },
              {
                name: "Natural Gas Peaker",
                fuel: "Natural Gas",
                peakW: extra,
                label: DATA_CENTER_RESERVE_LABEL,
              },
            ],
      };
      continue;
    }
    // The total fleet size is a model assumption; calibration must never build
    // the user's added campus load away.
    scenario = {
      ...scenario,
      facilities: scenario.facilities.map((facility) => ({
        ...facility,
        peakW: Math.min(
          Math.ceil((facility.peakW || 0) * 1.5),
          facility.hydroSiteId
            ? HYDRO_SITES[facility.hydroSiteId].maxPeakW
            : Infinity,
        ),
      })),
    };
  }
  throw new Error(
    "We couldn't prepare a reliable starting grid for this location.",
  );
}
