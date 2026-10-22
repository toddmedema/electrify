import compatibilityManifest from "../data/RunCompatibility.json";
import { validGameObjectiveProgress } from "../helpers/ObjectiveRules";
import { normalizedInputs } from "../helpers/RunIdentity";
import type {
  FacilityOperatingType,
  GameType,
  RunIdentity,
  ScenarioFacilityType,
  ScenarioType,
} from "../Types";

// #605 gives these original assets stable catalog identities. Upstream #602 predates those
// four metadata fields; every other facility field remains in the independent physical hash.
const originals = [
  {
    id: 1,
    assetId: "scenario-111-natural-gas-cc",
    name: "Natural Gas CC",
    fuel: "Natural Gas",
  },
  { id: 2, assetId: "scenario-111-sun", name: "Solar", fuel: "Sun" },
  { id: 3, assetId: "scenario-111-wind", name: "Wind", fuel: "Wind" },
  { id: 4, assetId: "scenario-111-battery", name: "Battery", fuel: undefined },
] as const;

export function projectUpstreamWildfireFacilities(
  facilities: readonly FacilityOperatingType[],
): FacilityOperatingType[] {
  return facilities.map((facility) => {
    const original = originals.find((item) => item.id === facility.id);
    if (!original || facility.minuteCreated !== 0) return facility;
    if (facility.name !== original.name || facility.fuel !== original.fuel)
      throw new Error(
        `Unexpected upstream111 original facility ${facility.id}`,
      );
    if (facility.startingAssetId !== original.assetId)
      throw new Error(
        `Upstream111 original ${facility.id} must carry ${original.assetId}`,
      );
    const { startingAssetId: _addedIdentity, ...physical } = facility;
    return physical;
  });
}

function projectBlueprint(
  facilities: readonly ScenarioFacilityType[],
): ScenarioFacilityType[] {
  if (facilities.length !== originals.length)
    throw new Error(
      "Upstream111 must retain its four original authored assets",
    );
  return facilities.map((facility, index) => {
    const original = originals[index];
    if (
      facility.assetId !== original.assetId ||
      facility.fuel !== original.fuel
    )
      throw new Error(`Unexpected upstream111 authored identity at ${index}`);
    const { assetId: _addedIdentity, ...physical } = facility;
    return physical;
  });
}

export function projectUpstreamWildfireScenario(
  scenario: ScenarioType,
): ScenarioType {
  if (scenario.id !== 111)
    throw new Error("This projection is only for upstream111");
  return { ...scenario, facilities: projectBlueprint(scenario.facilities) };
}

export function projectUpstreamWildfireIdentity(
  identity: RunIdentity | undefined,
  originalCompatibilityId: string,
): RunIdentity | undefined {
  if (!identity) return undefined;
  if (
    identity.scenarioId !== 111 ||
    identity.compatibilityId !== compatibilityManifest.compatibilityId
  )
    throw new Error(
      "Unexpected upstream111 current run identity or rules fingerprint",
    );
  const scenario: ScenarioType = JSON.parse(identity.inputs.scenario);
  return {
    ...identity,
    compatibilityId: originalCompatibilityId,
    inputs: {
      ...identity.inputs,
      facilities: projectBlueprint(identity.inputs.facilities),
      scenario: normalizedInputs(projectUpstreamWildfireScenario(scenario)),
    },
  };
}

export function projectUpstreamWildfireGame(
  game: GameType,
  originalCompatibilityId?: string,
): Omit<GameType, "objectiveProgress"> {
  if (
    game.scenarioId !== 111 ||
    !game.objectiveProgress ||
    !validGameObjectiveProgress(game)
  )
    throw new Error(
      "Upstream111 comparison requires a valid current objective ledger",
    );
  const { objectiveProgress: _newLedger, ...original } = game;
  if (game.runIdentity && originalCompatibilityId === undefined)
    throw new Error("The original upstream fingerprint must be explicit");
  return {
    ...original,
    facilities: projectUpstreamWildfireFacilities(game.facilities),
    runIdentity: projectUpstreamWildfireIdentity(
      game.runIdentity,
      originalCompatibilityId ?? "",
    ),
  };
}
