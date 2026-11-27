import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../data/Scenarios";
import { inEraMoney } from "../data/FuelPrices";
import type { LocationType, ScenarioType } from "../Types";
import { regionalStartingFleet } from "./RegionalStartingFleet";

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
    throw new RangeError("Choose between 1 and 100M customer accounts.");
  }
  const startingDemandScale = researched?.startingDemandScale || 1;
  const scale = startingCustomers * startingDemandScale;
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
    facilities: regionalStartingFleet(location, startingYear, scale * 2500),
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
