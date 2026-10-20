import { FuelNameType, LocationType } from "../Types";
import countrySnapshot from "./StartingFacilityAgeCohorts.json";
import stateSnapshot from "./StartingFacilityAgeStates.json";
import renewableSnapshot from "./StartingRenewableAges.json";

interface AgeProfile {
  capacityMW: number;
  knownCapacityMW: number;
  /** Capacity-weighted operating ages, indexed from the snapshot's firstYear. */
  ages: (number | null)[];
}
type AgeProfiles = Partial<
  Record<FuelNameType | "Natural Gas CC" | "Natural Gas Peaker", AgeProfile>
>;
const countries: Record<string, AgeProfiles> = countrySnapshot.countries;
const regions: Record<string, AgeProfiles> = countrySnapshot.regions;
const states: Record<string, AgeProfiles> = stateSnapshot.states;
const world: AgeProfiles = countrySnapshot.global;
const renewableCountries: Record<string, AgeProfiles> =
  renewableSnapshot.countries;
const renewableRegions: Record<string, AgeProfiles> = renewableSnapshot.regions;
const renewableWorld: AgeProfiles = renewableSnapshot.global;

export interface StartingFacilityAge {
  ageYears: number;
  scope: "state" | "country" | "region" | "world";
  geography: string;
  sourceYear: number;
  sourceUrl: string;
  method: "commissioning-years" | "capacity-history";
  knownCapacityShare?: number;
}

/** Representative inherited fleet ages, not commissioning dates of a city's utility.
 * Sparse local observations fall back to the broader regional technology fleet.
 * Future starts keep the latest observed age profile, consistent with the capacity mix;
 * they do not age a frozen inventory for decades without modeling replacements.
 */
export function getStartingFacilityAge(
  location: LocationType,
  fuel: FuelNameType,
  startingYear: number,
  name?: string,
): StartingFacilityAge {
  const country =
    location.admin === "Puerto Rico" ? "Puerto Rico" : location.country || "";
  const state =
    location.country === "United States" ? location.admin || "" : "";
  const stateProfiles = states[state];
  const renewable = fuel === "Sun" || fuel === "Wind";
  const snapshot = renewable ? renewableSnapshot : countrySnapshot;
  const method = renewable
    ? ("capacity-history" as const)
    : ("commissioning-years" as const);
  const stateKey =
    fuel === "Natural Gas" &&
    (name === "Natural Gas CC" || name === "Natural Gas Peaker") &&
    stateProfiles?.[name]
      ? name
      : fuel;
  const candidates = [
    {
      profile: stateProfiles?.[stateKey],
      scope: "state" as const,
      geography: state,
      snapshot: stateSnapshot,
      method: "commissioning-years" as const,
    },
    {
      profile: (renewable ? renewableCountries : countries)[country]?.[fuel],
      scope: "country" as const,
      geography: country,
      snapshot,
      method,
    },
    {
      profile: (renewable ? renewableRegions : regions)[
        location.region || ""
      ]?.[fuel],
      scope: "region" as const,
      geography: location.region || "",
      snapshot,
      method,
    },
    {
      profile: (renewable ? renewableWorld : world)[fuel],
      scope: "world" as const,
      geography: "World",
      snapshot,
      method,
    },
  ];
  for (const { profile, scope, geography, snapshot, method } of candidates) {
    if (!profile || !(profile.capacityMW > 0) || !(profile.knownCapacityMW > 0))
      continue;
    const knownCapacityShare = profile.knownCapacityMW / profile.capacityMW;
    // A handful of dated plants must not stand in for an almost entirely undated fleet.
    if (
      method === "commissioning-years" &&
      scope !== "world" &&
      knownCapacityShare < 0.5
    )
      continue;
    const year = Math.max(
      snapshot.firstYear,
      Math.min(startingYear, snapshot.referenceYear),
    );
    const ageYears = profile.ages[year - snapshot.firstYear];
    if (ageYears === null || ageYears === undefined) continue;
    return {
      ageYears,
      scope,
      geography,
      sourceYear: snapshot.referenceYear,
      sourceUrl: snapshot.source.url,
      method,
      ...(method === "commissioning-years" ? { knownCapacityShare } : {}),
    };
  }
  throw new Error(`No representative starting age for ${fuel}`);
}
