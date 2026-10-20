import { parseMod, ModPackage } from "../data/ModSchema";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  SCENARIOS,
} from "../data/Scenarios";
import {
  prepareCustomScenario,
  validCustomEventScenario,
} from "../helpers/CustomScenarioEvents";
import manifest from "../data/RunCompatibility.json";
import type { ScenarioType } from "../Types";

export function modScenario(input: ModPackage): ScenarioType {
  const pack = parseMod(JSON.stringify(input));
  if (pack.rules !== manifest.compatibilityId)
    throw new Error(
      "This mod requires different game rules. Ask its creator for an updated package.",
    );
  const base =
    pack.baseScenarioId === CUSTOM_SCENARIO_ID
      ? DEFAULT_CUSTOM_SCENARIO
      : SCENARIOS.find((s) => s.id === pack.baseScenarioId && !s.tutorialSteps);
  if (!base) throw new Error("Unknown base scenario.");
  const scenario: ScenarioType = {
    ...JSON.parse(JSON.stringify(base)),
    ...pack.scenario,
    id: CUSTOM_SCENARIO_ID,
    name: pack.title,
    seed: pack.seed,
    eventScenarioIds:
      pack.scenario?.eventScenarioIds ??
      (pack.baseScenarioId === CUSTOM_SCENARIO_ID ? [] : [pack.baseScenarioId]),
    modPackage: pack,
  };
  if (!validCustomEventScenario(scenario))
    throw new Error("Unsupported scenario year or events.");
  const prepared = prepareCustomScenario(scenario);
  return {
    ...prepared,
    reliabilityObjective: base.reliabilityObjective
      ? {
          ...base.reliabilityObjective,
          year:
            base.reliabilityObjective.year +
            scenario.startingYear -
            base.startingYear,
        }
      : undefined,
    // A base scenario can also contain existing industrial demand at launch.
    // Event preparation adds only future loads, so preserve that starting demand.
    loadAdditions: [
      ...(base.loadAdditions || [])
        .filter(
          (load) =>
            load.startsYear < base.startingYear ||
            (load.startsYear === base.startingYear &&
              (load.startsMonth || 1) === 1),
        )
        .map((load) => ({
          ...load,
          startsYear:
            load.startsYear + scenario.startingYear - base.startingYear,
        })),
      ...(prepared.loadAdditions || []),
    ],
    // Author-selected prices and duration are part of the package contract.
    dollarsPerkWh: scenario.dollarsPerkWh,
    durationMonths: scenario.durationMonths,
  };
}
