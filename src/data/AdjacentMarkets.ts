import {
  AdjacentMarketDefinitionType,
  LocationType,
  ScenarioType,
  TransmissionCorridorDefinitionType,
  TransmissionStateType,
} from "../Types";
import {
  NO_INTERTIE_LOCATION_IDS,
  TRANSMISSION_PROFILE_DATA,
  TRANSMISSION_PROFILE_LOCATION_IDS,
  TransmissionProfileTuple,
} from "./TransmissionProfiles";

import { importEmissionsAssumption } from "./ImportEmissions";

interface TransmissionProfileDefinition {
  markets: readonly AdjacentMarketDefinitionType[];
  corridors: readonly TransmissionCorridorDefinitionType[];
}

function expandProfile(
  tuple: TransmissionProfileTuple,
): TransmissionProfileDefinition {
  return {
    markets: tuple[0].map(
      ([
        id,
        name,
        description,
        basePricePerMWh,
        availableSupplyW,
        availableDemandW,
      ]) => ({
        id,
        name,
        description,
        basePricePerMWh,
        availableSupplyW,
        availableDemandW,
        ...importEmissionsAssumption(id),
      }),
    ),
    corridors: tuple[1].map(
      ([
        id,
        adjacentMarketId,
        name,
        routeType,
        capacityW,
        buildCost,
        annualOperatingCost,
        yearsToBuild,
        heatDerateStartsC,
        heatDeratePerC,
        solarDerateFraction,
      ]) => ({
        id,
        adjacentMarketId,
        name,
        routeType,
        capacityW,
        buildCost,
        annualOperatingCost,
        yearsToBuild,
        heatDerateStartsC,
        heatDeratePerC,
        solarDerateFraction,
      }),
    ),
  };
}

const TRANSMISSION_PROFILES = Object.fromEntries(
  Object.entries(TRANSMISSION_PROFILE_DATA).map(([id, tuple]) => [
    id,
    expandProfile(tuple),
  ]),
) as Readonly<Record<string, TransmissionProfileDefinition>>;

/** Every authored city is explicitly assigned either a researched profile or no interties. */
export const LOCATION_TRANSMISSION_PROFILE_IDS: Readonly<
  Record<string, string | null>
> = Object.freeze({
  ...Object.fromEntries(NO_INTERTIE_LOCATION_IDS.map((id) => [id, null])),
  ...Object.fromEntries(
    Object.entries(TRANSMISSION_PROFILE_LOCATION_IDS).flatMap(
      ([profileId, ids]) => ids.map((id) => [id, profileId]),
    ),
  ),
});

const uniqueMarkets = new Map<string, AdjacentMarketDefinitionType>();
const uniqueCorridors = new Map<string, TransmissionCorridorDefinitionType>();
for (const profile of Object.values(TRANSMISSION_PROFILES)) {
  for (const market of profile.markets) uniqueMarkets.set(market.id, market);
  for (const corridor of profile.corridors) {
    uniqueCorridors.set(corridor.id, corridor);
  }
}

/** Complete catalog, retained for save/replay validation and built-line price/rating lookups. */
export const ADJACENT_MARKETS = [...uniqueMarkets.values()] as const;
export const TRANSMISSION_CORRIDORS = [...uniqueCorridors.values()] as const;

export function emptyTransmissionState(): TransmissionStateType {
  return { tradingPolicy: "BALANCED", lines: [] };
}

export function transmissionProfileIdForLocation(
  location: Pick<LocationType, "id">,
): string | null {
  return LOCATION_TRANSMISSION_PROFILE_IDS[location.id] ?? null;
}

export function transmissionAvailable(location: Pick<LocationType, "id">) {
  return transmissionProfileIdForLocation(location) !== null;
}

/** Tutorials opt into this extra system deliberately; normal games follow physical availability. */
export function intertiesEnabledForScenario(
  scenario: ScenarioType,
  location: LocationType,
): boolean {
  if (!transmissionAvailable(location)) return false;
  if (scenario.intertiesEnabled !== undefined) {
    return scenario.intertiesEnabled;
  }
  return !scenario.tutorialSteps;
}

export function corridorsForLocation(
  location: Pick<LocationType, "id">,
): readonly TransmissionCorridorDefinitionType[] {
  const profileId = transmissionProfileIdForLocation(location);
  return profileId ? (TRANSMISSION_PROFILES[profileId]?.corridors ?? []) : [];
}

export function adjacentMarketsForLocation(
  location: Pick<LocationType, "id">,
): readonly AdjacentMarketDefinitionType[] {
  const profileId = transmissionProfileIdForLocation(location);
  return profileId ? (TRANSMISSION_PROFILES[profileId]?.markets ?? []) : [];
}

export function adjacentMarketForCorridor(
  corridorId: string,
): AdjacentMarketDefinitionType | undefined {
  const corridor = uniqueCorridors.get(corridorId);
  return corridor ? uniqueMarkets.get(corridor.adjacentMarketId) : undefined;
}
