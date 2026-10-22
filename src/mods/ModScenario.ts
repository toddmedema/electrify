import {
  MOD_API_VERSION,
  ModPackage,
  ModDiagnostic,
  ModValidationError,
  validateMod,
} from "./ModSchema";
import { DIFFICULTY_IDS } from "../Constants";
import { getDateFromMinute } from "../helpers/DateTime";
import { getScenarioLocation } from "../helpers/Locations";
import { absoluteMonth } from "../helpers/ObjectiveRules";
import {
  getHydroInventoryKey,
  resolveStartingHydroSites,
} from "../data/HydroSites";
import { startingFacilityQuote } from "../helpers/StartingFacilities";
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
import type {
  DifficultyType,
  GameType,
  ScenarioModType,
  ScenarioType,
} from "../Types";

/** Why a package cannot start in this build, or undefined when it can. */
export function modIssue(pack: ModPackage): string | undefined {
  try {
    const errors = modValidationDiagnostics(pack).filter(
      (d) => d.severity === "error",
    );
    return errors.length ? errors.map((d) => d.message).join("\n") : undefined;
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
  difficulty?: DifficultyType,
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
  const resolved: ScenarioType = {
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
  const diagnostics = resolvedScenarioDiagnostics(
    resolved,
    pack.baseScenarioId,
    difficulty ? [difficulty] : DIFFICULTY_IDS,
  );
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length) throw new ModValidationError(diagnostics);
  return resolved;
}

/** Catalog checks live here, shared by import/details, Play, Publish and author tooling. */
export function modValidationDiagnostics(input: unknown): ModDiagnostic[] {
  try {
    const pack = validateMod(input);
    const scenario = modScenario(pack);
    return resolvedScenarioDiagnostics(
      scenario,
      pack.baseScenarioId,
      DIFFICULTY_IDS,
    );
  } catch (error) {
    return error instanceof ModValidationError
      ? error.diagnostics
      : [
          {
            code: "scenario-resolution",
            path: "scenario",
            severity: "error",
            message:
              error instanceof Error ? error.message : "This mod can't start.",
          },
        ];
  }
}

function resolvedScenarioDiagnostics(
  scenario: ScenarioType,
  baseId: number,
  difficulties: readonly DifficultyType[],
): ModDiagnostic[] {
  const diagnostics: ModDiagnostic[] = [];
  const add = (
    code: string,
    path: string,
    message: string,
    severity: "error" | "warning" = "error",
  ) => diagnostics.push({ code, path, severity, message });
  const objective = scenario.reliabilityObjective;
  const duration = scenario.durationMonths || 240;
  if (objective) {
    const first =
      absoluteMonth(objective.year, objective.month) -
      absoluteMonth(scenario.startingYear, 1) +
      1;
    const last = first + (objective.durationMonths || 1) - 1;
    if (first < 1 || last > duration)
      add(
        "objective-outside-term",
        "scenario.reliabilityObjective",
        `Inherited reliability objective from base ${baseId} requires months ${first}–${last}, but this run ends at month ${duration}. Extend scenario.durationMonths to at least ${last}.`,
      );
  }
  scenario.mod?.notifications?.forEach((notice, index) => {
    if (notice.month > duration)
      add(
        "notice-outside-term",
        `notifications[${index}].month`,
        `notifications[${index}].month is after the scenario ends (month ${duration}).`,
      );
  });
  const location = getScenarioLocation(scenario);
  if (!location) {
    add(
      "missing-location",
      "scenario.location",
      "The resolved base scenario has no bundled location. Choose another base scenario.",
    );
    return diagnostics;
  }
  const missing = new Map<number, DifficultyType[]>();
  let annualOperatingCost = 0;
  for (const difficulty of difficulties) {
    const state = {
      date: getDateFromMinute(0, scenario.startingYear),
      startingYear: scenario.startingYear,
      difficulty,
      feePerKgCO2e: scenario.feePerKgCO2e,
      seed: scenario.seed || 0,
      facilities: [],
      commissionedHydroSiteIds: [],
      scenarioId: scenario.id,
      customScenario: scenario,
      location,
    } as unknown as GameType;
    try {
      resolveStartingHydroSites(
        state.location,
        scenario.facilities,
        getHydroInventoryKey(state),
      );
    } catch (error) {
      if (!diagnostics.some((d) => d.code === "starting-hydro-site"))
        add(
          "starting-hydro-site",
          "scenario.facilities",
          error instanceof Error
            ? error.message
            : "Starting Hydro sites are unavailable. Choose a compatible base location.",
        );
    }
    let cost = 0;
    scenario.facilities.forEach((asset, index) => {
      const quote = startingFacilityQuote(state, asset);
      if (!quote)
        missing.set(index, [...(missing.get(index) || []), difficulty]);
      else cost += quote.annualOperatingCost;
    });
    annualOperatingCost = Math.max(annualOperatingCost, cost);
  }
  missing.forEach((atDifficulties, index) => {
    const asset = scenario.facilities[index];
    add(
      "starting-asset-unavailable",
      `scenario.facilities[${index}]`,
      `Starting asset ${index + 1} (${[asset.label, asset.name || (asset.fuel === "Sun" ? "Solar" : asset.fuel === "Uranium" ? "Nuclear" : asset.fuel)].filter(Boolean).join(" · ") || "facility"}) is unavailable in ${scenario.startingYear} at ${location.name} on ${atDifficulties.join(", ")}. Choose a compatible startingYear or base scenario; assets cannot be removed or substituted.`,
    );
  });
  if (duration < 12)
    add(
      "short-opening",
      "scenario.durationMonths",
      "This run is shorter than one year; review the opening cash and objectives.",
      "warning",
    );
  if (annualOperatingCost / 4 > scenario.cash)
    add(
      "expensive-opening",
      "scenario.cash",
      "Starting cash covers less than three months of the fleet's fixed operating costs at some difficulties; review the opening budget.",
      "warning",
    );
  return diagnostics;
}
