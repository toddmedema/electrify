import type { GameType, ScenarioType } from "../Types";
import {
  EXPANSION_SCENARIO_ID,
  UTILITY_AREAS,
  UTILITY_TARGETS,
} from "../data/UtilityExpansion";

/** The fixed seller epoch, operating areas and inherited inventories are one scenario contract. */
export const UTILITY_EXPANSION_FIXED_SETUP = {
  startingYear: 2005,
  durationMonths: 240,
  startingCustomers: UTILITY_AREAS.champlain.customers,
  startingDemandScale: UTILITY_AREAS.champlain.demandScale,
} as const;

export function isUtilityExpansionScenario(
  scenario: Pick<ScenarioType, "id" | "mod">,
): boolean {
  return (
    scenario.id === EXPANSION_SCENARIO_ID ||
    (scenario.id === 999 &&
      scenario.mod?.parameters.baseScenarioId === EXPANSION_SCENARIO_ID)
  );
}

/** Mod runtime snapshots are validated by their owner before reaching the simulation. */
export function isUtilityExpansionGame(
  game: Pick<GameType, "scenarioId" | "customScenario">,
): boolean {
  return game.customScenario
    ? game.scenarioId === game.customScenario.id &&
        isUtilityExpansionScenario(game.customScenario)
    : game.scenarioId === EXPANSION_SCENARIO_ID;
}

export function validUtilityExpansionParameters(
  value: Record<string, unknown>,
): boolean {
  return Object.entries(UTILITY_EXPANSION_FIXED_SETUP).every(
    ([key, expected]) => value[key] === expected,
  );
}

function sameDefinition(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (
    !value ||
    !expected ||
    typeof value !== "object" ||
    typeof expected !== "object"
  )
    return false;
  if (Array.isArray(value) !== Array.isArray(expected)) return false;
  const actual = value as Record<string, unknown>;
  const reference = expected as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(reference).length &&
    Object.keys(reference).every((key) =>
      sameDefinition(actual[key], reference[key]),
    )
  );
}

/** Immutable live header; customer pools, ownership and equipment remain mutable. */
export function validUtilityExpansionHeader(
  value: Pick<
    ScenarioType,
    "startingYear" | "startingDemandScale" | "demandShapeExponent" | "location"
  >,
): boolean {
  return (
    value.startingYear === UTILITY_EXPANSION_FIXED_SETUP.startingYear &&
    value.startingDemandScale ===
      UTILITY_EXPANSION_FIXED_SETUP.startingDemandScale &&
    value.demandShapeExponent === UTILITY_AREAS.champlain.demandShapeExponent &&
    sameDefinition(value.location, UTILITY_AREAS.champlain.location)
  );
}

export function validUtilityExpansionSetup(scenario: ScenarioType): boolean {
  return (
    validUtilityExpansionParameters({ ...scenario }) &&
    validUtilityExpansionHeader(scenario) &&
    scenario.locationId === UTILITY_AREAS.champlain.location.id &&
    sameDefinition(scenario.location, UTILITY_AREAS.champlain.location) &&
    scenario.demandShapeExponent ===
      UTILITY_AREAS.champlain.demandShapeExponent &&
    sameDefinition(scenario.facilities, UTILITY_AREAS.champlain.facilities)
  );
}

/** Ownership survives independently of the physical connection's current readings. */
export function ownedUtilityConnection(
  game: Pick<GameType, "utilityExpansion">,
  corridorId: string,
): boolean {
  const target = UTILITY_TARGETS.find(
    (target) => target.corridorId === corridorId,
  );
  return (
    !!target &&
    !!game.utilityExpansion?.acquisitions.some(
      (receipt) => receipt.targetId === target.id,
    )
  );
}
