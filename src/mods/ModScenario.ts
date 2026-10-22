import {
  ModPackage,
  ModDiagnostic,
  ModValidationError,
  validateMod,
  packageDigest,
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
import { getStartingCustomers } from "../data/LocationProfiles";
import {
  prepareCustomScenario,
  validCustomEventScenario,
} from "../helpers/CustomScenarioEvents";
import {
  compileScenarioRules,
  RuleCompilationError,
} from "../helpers/ScenarioRules";
import { modRuntimeDigest, modSetupDigest } from "../helpers/ScenarioMod";
import { RULE_LIMITS } from "../helpers/ScenarioRulesSchema";
import { utf8Bytes } from "../helpers/RuleIdentity";
import {
  prepareScenarioStartingPeak,
  resolvedScenarioStartingPeak,
} from "../helpers/ScenarioStartingPeak";
import { compileOfficialArcEvents } from "../helpers/ScenarioRuleArcs";
import { compileOfficialArcChoices } from "../helpers/ScenarioRuleChoices";
import { scenarioRuleDependencyDiagnostics } from "../helpers/ScenarioRuleDependencies";
import { scenarioRuleCompositionDiagnostics } from "../helpers/ScenarioRuleComposition";
import compatibilityManifest from "../data/RunCompatibility.json";
import type {
  CompiledScenarioRules,
  RuleObjective,
  ScenarioRuleDefinitions,
} from "../data/ScenarioRules";
import type {
  DifficultyType,
  GameType,
  ScenarioModType,
  ScenarioType,
} from "../Types";

export function modIssue(pack: ModPackage): string | undefined {
  const errors = modValidationDiagnostics(pack).filter(
    (d) => d.severity === "error",
  );
  return errors.length ? errors.map((d) => d.message).join("\n") : undefined;
}
/** Replace-ready inherited objective definitions use the base's fixed offsets, including preparation. */
export function inheritedModObjectives(
  base: ScenarioType,
  startingYear = base.startingYear,
): RuleObjective[] {
  const objectives: RuleObjective[] = [];
  if (base.reliabilityObjective) {
    const o = base.reliabilityObjective;
    const fromMonth =
      absoluteMonth(o.year + startingYear - base.startingYear, o.month) -
      absoluteMonth(startingYear, 1) +
      1;
    objectives.push({
      id: `base-${base.id}-reliability`,
      metric: "monthlyReliability",
      label: o.goal ?? o.label,
      fromMonth,
      throughMonth: fromMonth + (o.durationMonths ?? 1) - 1,
      minDemandServedShare: o.minimumDemandServed,
    });
  }
  if (base.minimumCustomerRetention !== undefined)
    objectives.push({
      id: `base-${base.id}-retention`,
      metric: "customerRetention",
      label: "Retain your starting customers",
      deadlineMonth: base.durationMonths,
      minRetainedShare: base.minimumCustomerRetention,
    });
  return objectives;
}
function resolveModSetup(input: unknown) {
  const pack = validateMod(input);
  const base =
    pack.baseScenarioId === 999
      ? DEFAULT_CUSTOM_SCENARIO
      : SCENARIOS.find(
          (s) => s.id === pack.baseScenarioId && !s.tutorialSteps,
        )!;
  const overrides = pack.scenario ?? {},
    startingYear = overrides.startingYear ?? base.startingYear;
  const arcs =
    pack.officialArcs ??
    (pack.baseScenarioId === 999
      ? []
      : [{ scenarioId: pack.baseScenarioId, includeChoices: true }]);
  const scenario: ScenarioType = {
    ...JSON.parse(JSON.stringify(base)),
    ...overrides,
    id: CUSTOM_SCENARIO_ID,
    name: pack.title,
    seed: pack.seed,
    startingYear,
    eventScenarioIds: arcs.map((a) => a.scenarioId).sort((a, b) => a - b),
    cash:
      overrides.cash ?? inEraMoney(base.cash, startingYear, base.startingYear),
    feePerKgCO2e:
      overrides.feePerKgCO2e ??
      inEraMoney(base.feePerKgCO2e, startingYear, base.startingYear),
  };
  delete scenario.rules;
  if (!validCustomEventScenario(scenario))
    throw new Error("Unsupported scenario year or events.");
  const prepared = prepareCustomScenario(scenario);
  const durationMonths = overrides.durationMonths ?? prepared.durationMonths;
  const resolved: ScenarioType = {
    ...prepared,
    startingCustomers:
      scenario.startingCustomers ??
      getStartingCustomers(getScenarioLocation(scenario)),
    durationMonths,
    dollarsPerkWh:
      overrides.dollarsPerkWh ??
      (pack.baseScenarioId === 999
        ? prepared.dollarsPerkWh
        : inEraRate(base.dollarsPerkWh, startingYear, base.startingYear)),
    loadAdditions: [
      ...(base.loadAdditions ?? [])
        .filter(
          (l) =>
            l.startsYear < base.startingYear ||
            (l.startsYear === base.startingYear && (l.startsMonth ?? 1) === 1),
        )
        .map((l) => ({
          ...l,
          startsYear: l.startsYear + startingYear - base.startingYear,
        })),
      ...(prepared.loadAdditions ?? []),
    ],
  };
  if (pack.objectives.mode !== "inherit") {
    delete resolved.reliabilityObjective;
    delete resolved.minimumCustomerRetention;
  } else if (base.reliabilityObjective)
    resolved.reliabilityObjective = {
      ...base.reliabilityObjective,
      year: base.reliabilityObjective.year + startingYear - base.startingYear,
    };
  return { pack, base, arcs, startingYear, durationMonths, resolved };
}

/** Preparation uses precisely the same resolved baseline as compilation. */
export async function prepareModStartingPeak(input: unknown): Promise<void> {
  await prepareScenarioStartingPeak(resolveModSetup(input).resolved);
}

function resolveMod(
  input: unknown,
  workshopId: string | undefined,
  difficulty: DifficultyType,
  startingPeakW: number,
): { scenario: ScenarioType; diagnostics: ModDiagnostic[] } {
  const { pack, base, arcs, startingYear, durationMonths, resolved } =
    resolveModSetup(input);
  const inherited =
    pack.objectives.mode === "inherit"
      ? inheritedModObjectives(base, startingYear)
      : [];
  const definitions: ScenarioRuleDefinitions = {
    officialArcs: arcs,
    objectives:
      pack.objectives.mode === "replace"
        ? pack.objectives.items
        : [
            ...inherited,
            ...(pack.objectives.mode === "inherit"
              ? (pack.objectives.add ?? [])
              : []),
          ],
    ...(pack.events ? { events: pack.events } : {}),
    ...(pack.choices ? { choices: pack.choices } : {}),
    ...(pack.debriefReports ? { debriefReports: pack.debriefReports } : {}),
  };
  const diagnostics: ModDiagnostic[] = [],
    params = {
      namespace: { kind: "mod" as const, id: pack.id },
      seed: pack.seed,
      startingYear,
      durationMonths,
      startingPeakW,
      startingAssetIds: resolved.facilities.map((f) => f.assetId!),
      inheritedObjectiveIds: inherited.map((o) => o.id),
    };
  let rules: CompiledScenarioRules | undefined;
  const needsStartingPeak =
    !!pack.events?.some((event) =>
      event.loads?.some((load) => load.peakShareOfStartingPeak !== undefined),
    ) ||
    !!pack.choices?.some((choice) =>
      choice.options.some((option) =>
        option.replaceLoad?.with.some(
          (load) => load.peakShareOfStartingPeak !== undefined,
        ),
      ),
    );
  for (const atDifficulty of DIFFICULTY_IDS) {
    try {
      const peak =
        startingPeakW ||
        (needsStartingPeak
          ? resolvedScenarioStartingPeak(resolved, atDifficulty, pack.seed)
          : undefined) ||
        0;
      const compiled = compileScenarioRules(definitions, {
        ...params,
        startingPeakW: peak,
        difficulty: atDifficulty,
        diagnostics,
      });
      if (arcs.length) {
        compiled.arcEvents = compileOfficialArcEvents(
          {
            ...params,
            difficulty: atDifficulty,
            receivingScenario: resolved,
            diagnostics,
          },
          arcs.map((arc) => arc.scenarioId),
        );
        compiled.arcChoices = compileOfficialArcChoices(
          {
            ...params,
            difficulty: atDifficulty,
            receivingScenario: resolved,
            diagnostics,
          },
          arcs,
        );
      }
      diagnostics.push(...scenarioRuleDependencyDiagnostics(compiled));
      for (const [i, choice] of [
        ...compiled.choices,
        ...(compiled.arcChoices ?? []),
      ].entries()) {
        for (const [j, option] of choice.options.entries()) {
          const replacement = option.replaceLoad;
          if (!replacement?.arc) continue;
          const id = `custom-${replacement.arc}-${replacement.loadId}`;
          const target = resolved.loadAdditions?.find((load) => load.id === id);
          const start =
            target &&
            (target.startsYear - startingYear) * 12 +
              (target.startsMonth ?? 1) -
              1;
          if (start === undefined || start <= choice.dueMonth)
            diagnostics.push({
              code:
                start === undefined ? "unknown-load" : "load-already-started",
              path: `choices[${i}].options[${j}].replaceLoad`,
              severity: "error",
              message:
                start === undefined
                  ? `Arc ${replacement.arc} does not supply future load ${replacement.loadId}.`
                  : "A choice can replace a load only before its start month.",
            });
        }
      }
      const quoteState = {
        date: getDateFromMinute(0, startingYear),
        startingYear,
        difficulty: atDifficulty,
        seed: pack.seed,
        feePerKgCO2e: resolved.feePerKgCO2e,
        location: getScenarioLocation(resolved),
        facilities: [],
        commissionedHydroSiteIds: [],
        scenarioId: resolved.id,
        customScenario: resolved,
      } as unknown as GameType;
      const staticCosts = Object.entries(pack.facilities ?? {}).flatMap(
        ([name, factors]) => {
          const quote = startingFacilityQuote(quoteState, { name });
          return quote?.fuel ? [{ fuel: quote.fuel, ...factors }] : [];
        },
      );
      diagnostics.push(
        ...scenarioRuleCompositionDiagnostics(compiled, staticCosts),
      );
      if (atDifficulty === difficulty) rules = compiled;
    } catch (error) {
      if (!(error instanceof RuleCompilationError)) throw error;
      diagnostics.push(...error.diagnostics);
    }
  }
  // A rejected compilation still gets independent starting-fleet diagnostics; it can never launch.
  rules ??= compileScenarioRules({ objectives: [] }, { ...params, difficulty });
  const runtime: Omit<ScenarioModType, "runtimeDigest"> = {
    runtimeVersion: 1,
    gameApi: 1,
    packageDigest: packageDigest(pack),
    setupDigest: modSetupDigest(resolved),
    modRuntimeId: compatibilityManifest.modRuntimeId,
    source: {
      id: pack.id,
      title: pack.title,
      creator: pack.creator,
      version: pack.version,
      description: pack.description,
      ...(workshopId ? { workshopId } : {}),
    },
    parameters: {
      baseScenarioId: pack.baseScenarioId,
      startingYear,
      durationMonths,
      seed: pack.seed,
      difficulty,
      startingCustomers: resolved.startingCustomers!,
      startingDemandScale: resolved.startingDemandScale ?? 1,
    },
    rules,
    ...(pack.facilities ? { facilities: pack.facilities } : {}),
    ...(pack.programs ? { programs: pack.programs } : {}),
  };
  resolved.mod = { ...runtime, runtimeDigest: modRuntimeDigest(runtime) };
  diagnostics.push(
    ...resolvedScenarioDiagnostics(
      resolved,
      pack.baseScenarioId,
      DIFFICULTY_IDS,
    ),
  );
  if (utf8Bytes(JSON.stringify(resolved)).length > RULE_LIMITS.compiledBytes)
    diagnostics.push({
      code: "compiled-bytes",
      path: "rules",
      severity: "error",
      message:
        "Compiled mod snapshot exceeds512KiB including metadata, parameters and imported content.",
    });
  return {
    scenario: resolved,
    diagnostics: diagnostics.filter(
      (d, i, all) =>
        all.findIndex(
          (v) =>
            v.code === d.code && v.path === d.path && v.message === d.message,
        ) === i,
    ),
  };
}
/** One detached runtime snapshot for the selected difficulty. Library changes never enter it. */
export function modScenario(
  input: ModPackage,
  workshopId?: string,
  difficulty: DifficultyType = "Employee",
  startingPeakW = 0,
): ScenarioType {
  const resolved = resolveMod(input, workshopId, difficulty, startingPeakW);
  if (resolved.diagnostics.some((d) => d.severity === "error"))
    throw new ModValidationError(resolved.diagnostics);
  return resolved.scenario;
}
export function modValidationDiagnostics(input: unknown): ModDiagnostic[] {
  try {
    return resolveMod(input, undefined, "Employee", 0).diagnostics;
  } catch (error) {
    return error instanceof ModValidationError ||
      error instanceof RuleCompilationError
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
  const startingFuels = new Set<string>();
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
      else {
        cost += quote.annualOperatingCost;
        if (quote.fuel) startingFuels.add(quote.fuel);
      }
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
  scenario.mod?.rules.objectives.forEach((objective, index) => {
    if (
      objective.metric === "fuelRetirement" &&
      !startingFuels.has(objective.fuel)
    )
      add(
        "trivial-retirement",
        `objectives[${index}]`,
        `${objective.label}: no ${objective.fuel} asset is present in the starting fleet. The retirement goal still applies if you buy one later.`,
        "warning",
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
