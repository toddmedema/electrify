import { GENERATORS, STORAGE } from "../data/Facilities";
import { roundToSignificantDigits } from "./Math";
import type {
  FacilityShoppingType,
  GameType,
  ScenarioFacilityType,
} from "../Types";

/** Authored ages/labels are metadata; nameplate rounding matches the initialized asset. */
export function startingFacilitySearch(
  search: ScenarioFacilityType,
): Partial<FacilityShoppingType> {
  const {
    assetId: _assetId,
    hydroSiteId: _site,
    initialAgeYears: _age,
    initialReservoirFraction: _reservoir,
    label: _label,
    ...technology
  } = search;
  if (
    technology.peakW !== undefined &&
    technology.name !== "Hydro" &&
    technology.fuel !== "Hydro"
  )
    technology.peakW = roundToSignificantDigits(technology.peakW, 2);
  if (technology.peakWh !== undefined)
    technology.peakWh = roundToSignificantDigits(technology.peakWh, 2);
  return technology;
}

export function matchesStartingFacility(
  candidate: FacilityShoppingType,
  search: Partial<FacilityShoppingType>,
): boolean {
  return (
    candidate.viableLocationsRemaining !== 0 &&
    (Object.keys(search) as Array<keyof FacilityShoppingType>).every(
      (property) => candidate[property] === search[property],
    )
  );
}

/** Use the catalog's real availability filters, including location and difficulty. */
export function startingFacilityQuote(
  state: GameType,
  search: ScenarioFacilityType,
): FacilityShoppingType | undefined {
  const technology = startingFacilitySearch(search);
  return (
    GENERATORS(state, technology.peakW || 1000000, [], []).find((candidate) =>
      matchesStartingFacility(candidate, technology),
    ) ??
    STORAGE(state, technology.peakWh || 1000000).find((candidate) =>
      matchesStartingFacility(candidate, technology),
    )
  );
}
