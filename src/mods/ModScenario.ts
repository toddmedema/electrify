import { MOD_API_VERSION, ModPackage, validateMod } from "./ModSchema";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  SCENARIOS,
} from "../data/Scenarios";
import { inEraMoney } from "../data/FuelPrices";
import { inEraRate } from "../data/RetailRates";
import {
  prepareCustomScenario,
  validCustomEventScenario,
} from "../helpers/CustomScenarioEvents";
import type { ScenarioModType, ScenarioType } from "../Types";

/** Why a package cannot start in this build, or undefined when it can. */
export function modIssue(pack: ModPackage): string | undefined {
  try {
    modScenario(pack);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "This mod can't start.";
  }
}

/**
 * Resolves a package into the custom scenario a run starts from. The run keeps only the resolved
 * scenario and its small `mod` effects, never the authoring package itself.
 */
export function modScenario(
  input: ModPackage,
  workshopId?: string,
): ScenarioType {
  const pack = validateMod(input);
  if (pack.gameApi !== MOD_API_VERSION)
    throw new Error(
      `Made for a different game version. Ask ${pack.creator} for an update.`,
    );
  const base =
    pack.baseScenarioId === CUSTOM_SCENARIO_ID
      ? DEFAULT_CUSTOM_SCENARIO
      : SCENARIOS.find((s) => s.id === pack.baseScenarioId && !s.tutorialSteps);
  if (!base) throw new Error("Unknown base scenario.");
  const overrides = pack.scenario || {};
  const startingYear = overrides.startingYear ?? base.startingYear;
  const mod: ScenarioModType = {
    source: {
      id: pack.id,
      title: pack.title,
      creator: pack.creator,
      version: pack.version,
      ...(workshopId ? { workshopId } : {}),
    },
    ...(pack.facilities ? { facilities: pack.facilities } : {}),
    ...(pack.programs ? { programs: pack.programs } : {}),
    ...(pack.notifications ? { notifications: pack.notifications } : {}),
  };
  const scenario: ScenarioType = {
    ...JSON.parse(JSON.stringify(base)),
    ...overrides,
    // Money the author did not set follows the chosen era, as on the custom game screen.
    cash:
      overrides.cash ?? inEraMoney(base.cash, startingYear, base.startingYear),
    feePerKgCO2e:
      overrides.feePerKgCO2e ??
      inEraMoney(base.feePerKgCO2e, startingYear, base.startingYear),
    id: CUSTOM_SCENARIO_ID,
    name: pack.title,
    seed: pack.seed,
    eventScenarioIds:
      overrides.eventScenarioIds ??
      (pack.baseScenarioId === CUSTOM_SCENARIO_ID ? [] : [pack.baseScenarioId]),
    mod,
  };
  if (!validCustomEventScenario(scenario))
    throw new Error("Unsupported scenario year or events.");
  const prepared = prepareCustomScenario(scenario);
  const durationMonths = overrides.durationMonths ?? prepared.durationMonths;
  const late = pack.notifications?.findIndex((n) => n.month > durationMonths);
  if (late !== undefined && late >= 0)
    throw new Error(
      `notifications[${late}].month is after the scenario ends (month ${durationMonths}).`,
    );
  return {
    ...prepared,
    reliabilityObjective: base.reliabilityObjective
      ? {
          ...base.reliabilityObjective,
          year:
            base.reliabilityObjective.year + startingYear - base.startingYear,
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
          startsYear: load.startsYear + startingYear - base.startingYear,
        })),
      ...(prepared.loadAdditions || []),
    ],
    // An author's explicit price and duration are part of the package contract. Otherwise an
    // authored base keeps its own tariff carried into the chosen era; a custom base uses the
    // standard regional tariff the custom game screen would.
    dollarsPerkWh:
      overrides.dollarsPerkWh ??
      (pack.baseScenarioId === CUSTOM_SCENARIO_ID
        ? prepared.dollarsPerkWh
        : inEraRate(base.dollarsPerkWh, startingYear, base.startingYear)),
    durationMonths,
  };
}
