import type { FrozenStartingIntertieAccessType, ScenarioType } from "../Types";
import { getLocation, getScenarioLocation } from "./Locations";
import { canonicalRuleJson } from "./RuleIdentity";

/** Researched source facts frozen by the first-release contract. */
const WILDFIRE_ACCESS_V1: FrozenStartingIntertieAccessType = {
  version: 1,
  sourceScenarioId: 111,
  locationId: "LA",
  allocations: [
    {
      corridorId: "california-north",
      capacityW: 40e6,
      availableSupplyW: 40e6,
      importAccessWByTier: [40e6, 45e6, 50e6, 55e6],
      availableDemandW: 5e6,
    },
    {
      corridorId: "california-south",
      capacityW: 15e6,
      availableSupplyW: 15e6,
      importAccessWByTier: [15e6, 17e6, 19e6, 21e6],
      availableDemandW: 7.5e6,
    },
  ],
};

export function frozenWildfireStartingIntertieAccess(): FrozenStartingIntertieAccessType {
  return JSON.parse(JSON.stringify(WILDFIRE_ACCESS_V1));
}

/** Exact versioned source facts prevent a forged snapshot claiming a free regional-scale line. */
export function validFrozenStartingIntertieAccess(
  value: unknown,
): value is FrozenStartingIntertieAccessType {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as FrozenStartingIntertieAccessType;
  if (
    Object.keys(candidate).length !== 4 ||
    Object.keys(candidate).some(
      (key) =>
        !["version", "sourceScenarioId", "locationId", "allocations"].includes(
          key,
        ),
    ) ||
    !Array.isArray(candidate.allocations) ||
    candidate.allocations.length !== 2 ||
    candidate.allocations.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).length !== 5 ||
        Object.keys(row).some(
          (key) =>
            ![
              "corridorId",
              "capacityW",
              "availableSupplyW",
              "importAccessWByTier",
              "availableDemandW",
            ].includes(key),
        ) ||
        typeof row.corridorId !== "string",
    )
  )
    return false;
  try {
    return (
      canonicalRuleJson({
        ...candidate,
        allocations: [...candidate.allocations].sort((a, b) =>
          a.corridorId < b.corridorId
            ? -1
            : a.corridorId > b.corridorId
              ? 1
              : 0,
        ),
      }) === canonicalRuleJson(WILDFIRE_ACCESS_V1)
    );
  } catch {
    return false;
  }
}

/** Only a digest-bound base-111 setup inherits these source connections and import rights. */
export function validFrozenStartingIntertieScenario(
  scenario: ScenarioType,
  baseScenarioId = scenario.mod?.parameters?.baseScenarioId,
): boolean {
  const location = getScenarioLocation(scenario);
  const sourceLocation = getLocation("LA");
  return (
    scenario.id === 999 &&
    baseScenarioId === 111 &&
    scenario.locationId === "LA" &&
    !!location &&
    !!sourceLocation &&
    location.id === "LA" &&
    location.lat === sourceLocation.lat &&
    location.long === sourceLocation.long &&
    location.timeZone === sourceLocation.timeZone &&
    scenario.intertiesEnabled === true &&
    Array.isArray(scenario.startingInterties) &&
    scenario.startingInterties.length === 1 &&
    scenario.startingInterties[0] === "california-north" &&
    validFrozenStartingIntertieAccess(scenario.startingIntertieAccess)
  );
}
