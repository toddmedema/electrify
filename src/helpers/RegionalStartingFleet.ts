import type {
  FuelNameType,
  LocationType,
  ScenarioFacilityType,
  ScenarioType,
} from "../Types";
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

/** Scale reported capacity into an illustrative fleet, using only playable local resources. */
export function regionalStartingFleet(
  location: LocationType,
  startingYear: number,
  capacityW: number,
): ScenarioFacilityType[] {
  const { shares } = getDataCenterPowerMix(location, startingYear);
  const facilities: Array<ScenarioFacilityType & { fuel: FuelNameType }> = [];
  for (const [fuelName, share] of Object.entries(shares)) {
    const fuel = fuelName as FuelNameType;
    // The earliest observation is a proxy for earlier custom starts. Respect the catalog era.
    if (fuel === "Sun" && startingYear <= 1982) continue;
    // Hawaii's reported geothermal capacity is on Hawaii Island, beyond Oahu's catchment.
    if (
      fuel === "Geothermal" &&
      (location.id === "HNL" || !hasGeothermalResource(location))
    )
      continue;
    const peakW = Math.max(1, Math.round(capacityW * share));
    if (fuel === "Hydro") {
      const inventory = resolveHydroInventory(location);
      let remaining = peakW;
      if (
        location.resources?.hydro !== false &&
        inventory?.status === "researched"
      ) {
        for (const id of offeredHydroSiteIds(inventory)) {
          if (!remaining) break;
          const capacity = Math.min(remaining, HYDRO_SITES[id].maxPeakW);
          facilities.push({
            name: "Hydro",
            fuel,
            peakW: capacity,
            hydroSiteId: id,
          });
          remaining -= capacity;
        }
      }
    } else if (fuel === "Natural Gas") {
      if (startingYear >= 1990) {
        facilities.push({
          name: "Natural Gas CC",
          fuel,
          peakW: Math.max(1, Math.round(peakW * 0.8)),
        });
      }
      facilities.push({
        name: "Natural Gas Peaker",
        fuel,
        peakW:
          startingYear < 1990 ? peakW : Math.max(1, Math.round(peakW * 0.2)),
      });
    } else {
      facilities.push({ name: technologyForFuel[fuel], fuel, peakW });
    }
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
    ),
  };
}
