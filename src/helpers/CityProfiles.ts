import type { CitySizeType, TerritoryId } from "../Types";
import { getTerritoryDefinition } from "../data/Territories";
import { UTILITY_AREAS, UtilityEnergyShares } from "../data/UtilityExpansion";
import { randomAt, RANDOM_STREAM } from "./Math";

export interface CityProfile {
  id: TerritoryId;
  size: CitySizeType;
  customers: number;
  demandScale: number;
  demandShapeExponent: number;
  energyShares: UtilityEnergyShares;
}

/** Account counts are retained economic identities, including historical purchase receipts. */
export function cityCustomerCount(id: TerritoryId): number {
  return (
    Object.values(UTILITY_AREAS).find((area) => area.id === id)?.customers ??
    getTerritoryDefinition(id)?.customers ??
    0
  );
}
export function citySizeForTerritory(id: TerritoryId): CitySizeType {
  const customers = cityCustomerCount(id);
  return customers < 8000 ? "small" : customers < 50000 ? "medium" : "large";
}

/** One address per city, independent of discovery, purchase order and the weather streams. */
function cityMixIndex(id: TerritoryId): number {
  let hash = 2166136261;
  for (const character of `city-mix-v1:${id}`)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function mixedEnergyShares(
  seed: number,
  id: TerritoryId,
  base: UtilityEnergyShares,
  variation: number,
): UtilityEnergyShares {
  const index = cityMixIndex(id);
  const weight = (value: number, offset: number) =>
    value *
    (1 -
      variation +
      2 * variation * randomAt(seed, RANDOM_STREAM.cityMix, index + offset));
  const residential = weight(base.Residential, 0);
  const commercial = weight(base.Commercial, 1);
  const industrial = weight(base.Industrial, 2);
  const total = residential + commercial + industrial;
  const Residential = residential / total;
  const Commercial = commercial / total;
  return { Residential, Commercial, Industrial: 1 - Residential - Commercial };
}

/** Shared by public inspection and the company demand owner. Utilities retain calibrated totals.
 * Small neutral cities retain fewer, larger service accounts; size is not a sector category.
 */
export function cityProfile(
  seed: number,
  id: TerritoryId,
): CityProfile | undefined {
  const size = citySizeForTerritory(id);
  const utility = Object.values(UTILITY_AREAS).find((area) => area.id === id);
  if (utility) {
    const { customers, demandScale, demandShapeExponent, energyShares } =
      utility;
    return {
      id,
      size,
      customers,
      demandScale,
      demandShapeExponent,
      energyShares: mixedEnergyShares(seed, id, energyShares, 0.1),
    };
  }
  const territory = getTerritoryDefinition(id);
  const customers = cityCustomerCount(id);
  if (!territory || customers <= 0) return undefined;
  return {
    id,
    size,
    customers,
    demandScale:
      UTILITY_AREAS.champlain.demandScale *
      (territory.customerLoadMultiplier ?? 1),
    demandShapeExponent: UTILITY_AREAS.champlain.demandShapeExponent,
    energyShares: mixedEnergyShares(
      seed,
      id,
      { Residential: 0.35, Commercial: 0.4, Industrial: 0.25 },
      0.5,
    ),
  };
}
