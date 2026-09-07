import {
  AdjacentMarketDefinitionType,
  LocationType,
  TransmissionCorridorDefinitionType,
  TransmissionStateType,
} from "../Types";

export const ADJACENT_MARKETS: readonly AdjacentMarketDefinitionType[] = [
  {
    id: "pacific-northwest",
    name: "Pacific Northwest",
    description:
      "Hydropower often makes daytime imports affordable, but supply tightens in dry periods.",
    basePricePerMWh: 48,
    availableSupplyW: 1800000000,
    availableDemandW: 1400000000,
  },
  {
    id: "desert-southwest",
    name: "Desert Southwest",
    description:
      "Solar power is plentiful near midday. Hot evenings raise prices and reduce line capacity.",
    basePricePerMWh: 55,
    availableSupplyW: 1500000000,
    availableDemandW: 1700000000,
  },
] as const;

export const TRANSMISSION_CORRIDORS: readonly TransmissionCorridorDefinitionType[] =
  [
    {
      id: "california-north",
      adjacentMarketId: "pacific-northwest",
      name: "Northern intertie upgrade",
      routeType: "EXISTING",
      capacityW: 500000000,
      buildCost: 180000000,
      annualOperatingCost: 3600000,
      yearsToBuild: 1,
      heatDerateStartsC: 30,
      heatDeratePerC: 0.012,
      solarDerateFraction: 0.04,
    },
    {
      id: "california-south",
      adjacentMarketId: "desert-southwest",
      name: "Desert connection",
      routeType: "NEW",
      capacityW: 750000000,
      buildCost: 420000000,
      annualOperatingCost: 7200000,
      yearsToBuild: 3,
      heatDerateStartsC: 32,
      heatDeratePerC: 0.015,
      solarDerateFraction: 0.06,
    },
  ] as const;

export function emptyTransmissionState(): TransmissionStateType {
  return { tradingPolicy: "BALANCED", lines: [] };
}

/** The first release is deliberately calibrated only for the California market. */
export function transmissionAvailable(location: LocationType): boolean {
  return location.admin === "California" || location.id === "SF";
}

export function corridorsForLocation(
  location: LocationType,
): readonly TransmissionCorridorDefinitionType[] {
  return transmissionAvailable(location) ? TRANSMISSION_CORRIDORS : [];
}

export function adjacentMarketForCorridor(
  corridorId: string,
): AdjacentMarketDefinitionType | undefined {
  const corridor = TRANSMISSION_CORRIDORS.find(({ id }) => id === corridorId);
  return ADJACENT_MARKETS.find(({ id }) => id === corridor?.adjacentMarketId);
}
