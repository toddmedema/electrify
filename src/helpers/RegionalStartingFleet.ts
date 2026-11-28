import type {
  FuelNameType,
  LocationType,
  ScenarioFacilityType,
  ScenarioType,
} from "../Types";
import { COOP_CUSTOM_FACILITY_LIMIT } from "../Constants";
import { getDataCenterPowerMix } from "../data/DataCenterPowerMix";
import { generatorMaxPeakW } from "../data/FacilityCapacity";
import { getViableLocationCount } from "../data/FacilitySites";
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
import { CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { getDateFromMinute } from "./DateTime";
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
  name: string;
  peakW: number;
};

interface GeneratorAllocation {
  generator: StartingGenerator;
  capacityPerPlant: number;
  siteLimit: number;
  plants: StartingGenerator[];
}

function managedStartingGenerators(
  requested: readonly StartingGenerator[],
  location: LocationType,
  startingYear: number,
): StartingGenerator[] {
  const context = {
    scenarioId: CUSTOM_SCENARIO_ID,
    date: getDateFromMinute(0, startingYear),
  };
  const createAllocation = (
    generator: StartingGenerator,
  ): GeneratorAllocation => ({
    generator,
    capacityPerPlant: generatorMaxPeakW(context, generator.name),
    siteLimit:
      getViableLocationCount(location, generator.name) ??
      COOP_CUSTOM_FACILITY_LIMIT,
    plants: [],
  });
  const byName = new Map(
    requested
      .filter(({ fuel }) => fuel !== "Hydro")
      .map((generator) => [generator.name, createAllocation(generator)]),
  );
  const allocations = [...byName.values()];
  const hydroPlants = requested.filter(({ fuel }) => fuel === "Hydro").length;
  let freeSlots = COOP_CUSTOM_FACILITY_LIMIT - hydroPlants;
  let unallocatedW = allocations.reduce(
    (sum, { generator }) => sum + generator.peakW,
    0,
  );
  const addPlant = (allocation: GeneratorAllocation, peakW: number) => {
    allocation.plants.push({ ...allocation.generator, peakW });
    freeSlots--;
    unallocatedW -= peakW;
  };

  // Preserve a representative plant for each fuel before assigning slots to large shares.
  const extraPlants = allocations.flatMap((allocation) => {
    const { generator, capacityPerPlant, siteLimit } = allocation;
    if (!siteLimit || !capacityPerPlant) return [];
    addPlant(allocation, Math.min(generator.peakW, capacityPerPlant));
    return Array.from(
      {
        length:
          Math.min(siteLimit, Math.ceil(generator.peakW / capacityPerPlant)) -
          1,
      },
      (_, index) => ({
        allocation,
        peakW: Math.min(
          capacityPerPlant,
          generator.peakW - (index + 1) * capacityPerPlant,
        ),
      }),
    );
  });
  extraPlants
    .sort((a, b) => b.peakW - a.peakW)
    .slice(0, freeSlots)
    .forEach(({ allocation, peakW }) => addPlant(allocation, peakW));

  // A small project or scarce site can leave capacity over. Fill headroom in observed fuels
  // before adding projects for the residual so small facilities cannot crowd out the fleet.
  const largestFirst = [...allocations].sort(
    (a, b) => b.capacityPerPlant - a.capacityPerPlant,
  );
  for (const { plants, capacityPerPlant } of largestFirst) {
    for (const plant of plants) {
      const extraW = Math.min(capacityPerPlant - plant.peakW, unallocatedW);
      plant.peakW += extraW;
      unallocatedW -= extraW;
    }
  }
  for (const allocation of largestFirst) {
    while (
      unallocatedW > 0 &&
      freeSlots > 0 &&
      allocation.capacityPerPlant &&
      allocation.plants.length < allocation.siteLimit
    ) {
      addPlant(allocation, Math.min(unallocatedW, allocation.capacityPerPlant));
    }
  }

  // When every observed fuel is at its limit, fill the remaining budget with modeled backup.
  // Replacing the smallest plants only when the fleet is full preserves representation where possible.
  const backupName = "Natural Gas Peaker";
  const backup =
    byName.get(backupName) ??
    createAllocation({ name: backupName, fuel: "Natural Gas", peakW: 0 });
  const replaceable = allocations
    .flatMap((allocation) =>
      allocation === backup
        ? []
        : [...allocation.plants]
            .reverse()
            .map((plant) => ({ allocation, plant })),
    )
    .sort((a, b) => a.plant.peakW - b.plant.peakW);
  while (unallocatedW > 0) {
    if (freeSlots === 0) {
      const smallest = replaceable.shift();
      if (!smallest || smallest.plant.peakW >= backup.capacityPerPlant) break;
      const { allocation, plant } = smallest;
      allocation.plants.splice(allocation.plants.indexOf(plant), 1);
      freeSlots++;
      unallocatedW += plant.peakW;
    }
    addPlant(backup, Math.min(unallocatedW, backup.capacityPerPlant));
  }

  return [
    ...requested.flatMap((generator) =>
      generator.fuel === "Hydro"
        ? [generator]
        : (byName.get(generator.name)?.plants ?? []),
    ),
    ...(byName.has(backupName) ? [] : backup.plants),
  ];
}

/** Fit forecast-sized plants back into the regional inventory and the shared lobby limit. */
export function allocateCalibratedFleet(
  facilities: readonly ScenarioFacilityType[],
  location: LocationType,
  startingYear: number,
): ScenarioFacilityType[] {
  const groups = new Map<string, StartingGenerator>();
  for (const facility of facilities) {
    const { name, fuel, peakW, hydroSiteId } = facility;
    if (!name || !fuel || !peakW)
      throw new Error("Incomplete starting generator");
    const key = hydroSiteId ?? name;
    const existing = groups.get(key);
    if (existing) existing.peakW += peakW;
    else groups.set(key, { ...facility, name, fuel, peakW });
  }
  return managedStartingGenerators(
    [...groups.values()],
    location,
    startingYear,
  );
}

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
  const fleet =
    mode === "custom"
      ? managedStartingGenerators(facilities, location, startingYear)
      : facilities;
  return fleet.map((facility) => ({
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
