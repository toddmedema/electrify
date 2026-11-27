import type {
  FuelNameType,
  LocationType,
  ScenarioFacilityType,
  ScenarioType,
} from "../Types";
import { COOP_CUSTOM_FACILITY_LIMIT } from "../Constants";
import { getDataCenterPowerMix } from "../data/DataCenterPowerMix";
import {
  HYDRO_SITES,
  offeredHydroSiteIds,
  resolveHydroInventory,
} from "../data/HydroSites";
import {
  getStartingCustomers,
  hasGeothermalResource,
} from "../data/LocationProfiles";
import { getStartingFacilityAge } from "../data/StartingFacilityAges";
import { getScenarioLocation } from "./Locations";

const technologyForFuel: Record<
  Exclude<FuelNameType, "Natural Gas">,
  string
> = {
  Coal: "Coal",
  Oil: "Oil",
  Uranium: "Nuclear",
  Hydro: "Hydro",
  Sun: "Solar",
  Wind: "Wind",
  "Offshore Wind": "Offshore Wind",
  "Airborne Wind": "Airborne Wind",
  Biomass: "Biomass",
  Geothermal: "Geothermal",
};
type StartingGenerator = ScenarioFacilityType & {
  fuel: FuelNameType;
  peakW: number;
};

function startingHydroFleet(
  location: LocationType,
  capacityW: number,
  slotLimit?: number,
): StartingGenerator[] {
  if (capacityW === 0 || location.resources?.hydro === false) return [];
  const inventory = resolveHydroInventory(location);
  if (inventory?.status !== "researched") return [];
  const offered = offeredHydroSiteIds(inventory);
  const sites =
    slotLimit === undefined
      ? offered
      : [...offered]
          .sort((a, b) => HYDRO_SITES[b].maxPeakW - HYDRO_SITES[a].maxPeakW)
          .slice(0, slotLimit);
  let remainingW = capacityW;
  const facilities: StartingGenerator[] = [];
  for (const id of sites) {
    if (remainingW === 0) break;
    const peakW = Math.min(remainingW, HYDRO_SITES[id].maxPeakW);
    facilities.push({ name: "Hydro", fuel: "Hydro", peakW, hydroSiteId: id });
    remainingW -= peakW;
  }
  return facilities;
}

/** Scale reported capacity into an illustrative fleet, using only playable local resources. */
export function regionalStartingFleet(
  location: LocationType,
  startingYear: number,
  capacityW: number,
  mode: "reported" | "custom" = "reported",
): ScenarioFacilityType[] {
  const { shares } = getDataCenterPowerMix(location, startingYear);
  const playableShares = (
    Object.entries(shares) as [FuelNameType, number][]
  ).filter(([fuel]) => {
    // The earliest observation is a proxy for earlier custom starts. Respect the catalog era.
    if (fuel === "Sun" && startingYear <= 1982) return false;
    // Hawaii's reported geothermal capacity is on Hawaii Island, beyond Oahu's catchment.
    return (
      fuel !== "Geothermal" ||
      (location.id !== "HNL" && hasGeothermalResource(location))
    );
  });
  const nonHydroShares = playableShares.filter(([fuel]) => fuel !== "Hydro");
  const combinedCycle = startingYear >= 1990;
  const otherPlants =
    nonHydroShares.length + Number(combinedCycle && !!shares["Natural Gas"]);
  // A custom fleet must fit the lobby and leave room for a substitute if it has no other fuels.
  const hydroSlots =
    mode === "custom"
      ? COOP_CUSTOM_FACILITY_LIMIT - Math.max(1, otherPlants)
      : undefined;
  const hydroFleet = startingHydroFleet(
    location,
    shares.Hydro ? Math.max(1, Math.round(capacityW * shares.Hydro)) : 0,
    hydroSlots,
  );
  const remainingW = Math.max(
    0,
    Math.round(capacityW) -
      hydroFleet.reduce((sum, { peakW }) => sum + peakW, 0),
  );
  const otherShare = nonHydroShares.reduce((sum, [, share]) => sum + share, 0);
  // Redistribute unmodelled capacity only in Custom. The Data Center calibration sizes its own fleet.
  const nonHydroScale =
    mode === "custom" && otherShare > 0 ? remainingW / otherShare : capacityW;

  const facilities: StartingGenerator[] = [];
  for (const [fuel, share] of playableShares) {
    if (fuel === "Hydro") {
      facilities.push(...hydroFleet);
      continue;
    }
    if (mode === "custom" && remainingW === 0) continue;
    const peakW = Math.max(1, Math.round(nonHydroScale * share));
    if (fuel === "Natural Gas") {
      if (combinedCycle) {
        facilities.push({
          name: "Natural Gas CC",
          fuel,
          peakW: Math.max(1, Math.round(peakW * 0.8)),
        });
      }
      facilities.push({
        name: "Natural Gas Peaker",
        fuel,
        peakW: combinedCycle ? Math.max(1, Math.round(peakW * 0.2)) : peakW,
      });
    } else {
      facilities.push({ name: technologyForFuel[fuel], fuel, peakW });
    }
  }
  if (mode === "custom" && otherShare === 0 && remainingW > 0) {
    facilities.push({
      name: "Natural Gas Peaker",
      fuel: "Natural Gas",
      peakW: remainingW,
    });
  }
  return facilities.map((facility) => ({
    ...facility,
    initialAgeYears: getStartingFacilityAge(
      location,
      facility.fuel,
      startingYear,
      facility.name,
    ).ageYears,
  }));
}

// Keep the default San Francisco setup's opening reserve when its peaker is replaced
// with a portfolio that includes intermittent generation.
const CUSTOM_WATTS_PER_CUSTOMER = 900;

/** Opt into a fleet that follows the editable custom location, year and customer scale. */
export function withRegionalStartingFleet(
  scenario: ScenarioType,
): ScenarioType {
  const location = getScenarioLocation(scenario);
  if (!location) return scenario;
  const capacityW =
    (scenario.startingCustomers ?? getStartingCustomers(location)) *
    (scenario.startingDemandScale ?? 1) *
    CUSTOM_WATTS_PER_CUSTOMER;
  return {
    ...scenario,
    startingFleetSource: "regional",
    facilities: regionalStartingFleet(
      location,
      scenario.startingYear,
      capacityW,
      "custom",
    ),
  };
}
