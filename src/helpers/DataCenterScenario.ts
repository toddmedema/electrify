import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../data/Scenarios";
import { hasGeothermalResource } from "../data/LocationProfiles";
import { inEraMoney } from "../data/FuelPrices";
import {
  FuelNameType,
  LocationType,
  ScenarioFacilityType,
  ScenarioType,
} from "../Types";
import { getDataCenterPowerMix } from "../data/DataCenterPowerMix";
import { HYDRO_SITES, resolveHydroInventory } from "../data/HydroSites";

export const DATA_CENTER_SEED = 1062026;
export const DATA_CENTER_DIFFICULTY = "CEO" as const;
export const MIN_DATA_CENTER_YEAR = 2010;
export const MAX_DATA_CENTER_YEAR = 2050;

/** User-authored loads must not be replaced by the fixed connection-deal story. */
export function configureDataCenterGrowth(
  scenario: ScenarioType,
  peakW: number,
  arrivalYear: number,
): ScenarioType {
  if (
    !Number.isInteger(scenario.startingYear) ||
    scenario.startingYear < MIN_DATA_CENTER_YEAR ||
    scenario.startingYear >= MAX_DATA_CENTER_YEAR ||
    !Number.isInteger(arrivalYear) ||
    arrivalYear <= scenario.startingYear ||
    arrivalYear > MAX_DATA_CENTER_YEAR ||
    !Number.isFinite(peakW) ||
    peakW < 0
  )
    throw new RangeError(
      "Choose valid years and a nonnegative data-center demand.",
    );
  return {
    ...scenario,
    eventScenarioIds: [],
    durationMonths: Math.max(
      16 * 12,
      (arrivalYear - scenario.startingYear + 10) * 12,
    ),
    loadAdditions: [
      {
        id: "community-data-centers",
        label: "New data centers",
        demandType: "Data Centers",
        peakW,
        startsYear: arrivalYear,
        loadFactor: 1,
        supplementsBackground: true,
      },
    ],
  };
}

/** Illustrative regional supply, not an inventory of the selected utility's plants. */
export function createDataCenterScenario(
  location: LocationType,
  startingYear: number,
  startingCustomers: number,
): ScenarioType {
  const researched = SCENARIOS.find(
    (scenario) =>
      !scenario.tutorialSteps &&
      scenario.locationId === location.id &&
      scenario.startingDemandScale,
  );
  if (
    !Number.isInteger(startingCustomers) ||
    startingCustomers < 1 ||
    startingCustomers > 100000000
  ) {
    throw new RangeError("Choose between 1 and 100,000,000 customer accounts.");
  }
  const startingDemandScale = researched?.startingDemandScale || 1;
  const scale = startingCustomers * startingDemandScale;
  const mix = getDataCenterPowerMix(location, startingYear);
  const facilities: ScenarioFacilityType[] = [];
  // Research establishes relative installed capacity, not the local inventory or its size.
  // The same model load sizing and baseline-only calibration apply to every portfolio.
  Object.entries(mix.shares).forEach(([fuel, share]) => {
    // Hawaii's reported geothermal capacity is on Hawaii Island, not Oahu.
    if (fuel === "Geothermal" && location.id === "HNL") return;
    if (fuel === "Geothermal" && !hasGeothermalResource(location)) return;
    const peakW = Math.max(1, Math.round(scale * 2500 * share));
    if (fuel === "Hydro") {
      // Regional hydro may sit outside the playable site's catchment. Use only
      // researched physical sites and never exceed their documented capacities.
      const inventory = resolveHydroInventory(location);
      let remaining = peakW;
      if (inventory?.status === "researched") {
        for (const id of inventory.siteIds) {
          if (!remaining) break;
          const capacity = Math.min(remaining, HYDRO_SITES[id].maxPeakW);
          facilities.push({ fuel: "Hydro", peakW: capacity, hydroSiteId: id });
          remaining -= capacity;
        }
      }
    } else if (fuel === "Natural Gas") {
      facilities.push(
        {
          name: "Natural Gas CC",
          fuel,
          peakW: Math.max(1, Math.round(peakW * 0.8)),
        },
        {
          name: "Natural Gas Peaker",
          fuel,
          peakW: Math.max(1, Math.round(peakW * 0.2)),
        },
      );
    } else {
      facilities.push({ fuel: fuel as FuelNameType, peakW });
    }
  });
  const scenario: ScenarioType = {
    ...DEFAULT_CUSTOM_SCENARIO,
    name: "Data centers & your community",
    summary: "Explore a regional example grid as new data centers connect.",
    locationId: location.id,
    location,
    startingYear,
    seed: DATA_CENTER_SEED,
    startingCustomers,
    startingDemandScale,
    ownership: "Public",
    durationMonths: 16 * 12,
    cash: inEraMoney(scale * 800, startingYear),
    facilities,
    eventScenarioIds: [],
  };
  return configureDataCenterGrowth(
    scenario,
    100000000,
    Math.min(MAX_DATA_CENTER_YEAR, startingYear + 6),
  );
}

/** A zero-load schedule preserves the growth run's ordinary demand before connection. */
export function withoutDataCenterGrowth(scenario: ScenarioType): ScenarioType {
  return {
    ...scenario,
    name: "Your community without added data centers",
    eventScenarioIds: [],
    loadAdditions: scenario.loadAdditions?.map((load) => ({
      ...load,
      peakW: load.demandType === "Data Centers" ? 0 : load.peakW,
    })),
  };
}
