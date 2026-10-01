import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../data/Scenarios";
import {
  getStartingCustomers,
  hasGeothermalResource,
} from "../data/LocationProfiles";
import { inEraMoney } from "../data/FuelPrices";
import { LocationType, ScenarioFacilityType, ScenarioType } from "../Types";
import { prepareCustomScenario } from "./CustomScenarioEvents";

export const DATA_CENTER_SEED = 1062026;
export const DATA_CENTER_DIFFICULTY = "CEO" as const;

/** Illustrative regional supply, not an inventory of the selected utility's plants. */
export function createDataCenterScenario(
  location: LocationType,
  startingYear: number,
): ScenarioType {
  const researched = SCENARIOS.find(
    (scenario) =>
      !scenario.tutorialSteps &&
      scenario.locationId === location.id &&
      scenario.startingDemandScale,
  );
  const startingCustomers =
    researched?.startingCustomers || getStartingCustomers(location);
  const startingDemandScale = researched?.startingDemandScale || 1;
  const scale = startingCustomers * startingDemandScale;
  // These watts per scaled account are example portfolios, not measured generation shares.
  // Latitude weights solar/wind; broad regions weight coal; known resources permit geothermal.
  // The worker then checks actual hourly demand and adds firm capacity where required.
  const coalRegion = [
    "East Asia",
    "South Asia",
    "Central Asia",
    "Africa",
  ].includes(location.region || "");
  const facilities: ScenarioFacilityType[] = [
    {
      name: "Natural Gas CC",
      fuel: "Natural Gas",
      peakW: Math.round(scale * (coalRegion ? 250 : 450)),
    },
    {
      name: "Natural Gas Peaker",
      fuel: "Natural Gas",
      peakW: Math.round(scale * 200),
    },
    {
      fuel: "Sun",
      peakW: Math.round(scale * (Math.abs(location.lat) < 35 ? 250 : 150)),
    },
    {
      fuel: "Wind",
      peakW: Math.round(scale * (Math.abs(location.lat) >= 35 ? 250 : 150)),
    },
  ];
  if (coalRegion)
    facilities.push({ fuel: "Coal", peakW: Math.round(scale * 200) });
  if (hasGeothermalResource(location))
    facilities.push({ fuel: "Geothermal", peakW: Math.round(scale * 100) });
  return prepareCustomScenario({
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
    eventScenarioIds: [106],
  });
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
