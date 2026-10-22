import type {
  CompiledRuleEvent,
  CompiledRuleLoad,
  CompiledRuleObjective,
  CompiledScenarioRules,
  RuleCondition,
  RuleDiagnostic,
  RuleLoad,
  RuleNumber,
  RuleObjective,
  RuleReport,
  ScenarioRuleDefinitions,
} from "../data/ScenarioRules";
import type {
  DifficultyType,
  ScenarioType,
  WorldEventEffectsType,
} from "../Types";
import {
  ruleDiagnostics,
  RULE_LIMITS,
  isRuleJson,
  RULE_DIFFICULTIES,
  ID_PATTERN,
} from "./ScenarioRulesSchema";
import { canonicalRuleJson, utf8Bytes } from "./RuleIdentity";
import { randomAt, RANDOM_STREAM } from "./Math";
import { scenarioRuleCompositionDiagnostics } from "./ScenarioRuleComposition";
import { validOfficialArcMetadata } from "./ScenarioRuleArcs";
import { validOfficialArcChoiceMetadata } from "./ScenarioRuleChoices";
import { scenarioRuleDependencyDiagnostics } from "./ScenarioRuleDependencies";

export class RuleCompilationError extends Error {
  constructor(public diagnostics: RuleDiagnostic[]) {
    super(diagnostics.map((d) => d.message).join("\n"));
    this.name = "RuleCompilationError";
  }
}
export interface RuleCompileParameters {
  namespace: CompiledScenarioRules["namespace"];
  difficulty: DifficultyType;
  seed: number;
  startingYear: number;
  durationMonths: number;
  startingPeakW: number;
  startingAssetIds: string[];
  inheritedObjectiveIds?: string[];
  diagnostics?: RuleDiagnostic[];
}
export const ruleNumber = (
  value: RuleNumber,
  difficulty: DifficultyType,
): number =>
  typeof value === "number" ? value : value.byDifficulty[difficulty];
export function scenarioRules(
  scenario?: ScenarioType,
): CompiledScenarioRules | undefined {
  if (!scenario) return undefined;
  if (scenario.id === 999) return scenario.mod?.rules;
  return scenario.rules?.namespace.kind === "official" &&
    scenario.rules.namespace.scenarioId === scenario.id
    ? scenario.rules
    : undefined;
}
const sorted = <T extends { id: string }>(values: readonly T[]): T[] =>
  [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
/** Effect operations commute. Canonical order gives targeting/receipts stable internal addresses. */
const sortedOperations = <T>(values: T[]): T[] =>
  values.sort((a, b) =>
    canonicalRuleJson(a) < canonicalRuleJson(b)
      ? -1
      : canonicalRuleJson(a) > canonicalRuleJson(b)
        ? 1
        : 0,
  );
const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function hashAddress(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}
function keyOf(
  namespace: CompiledScenarioRules["namespace"],
  id: string,
): string {
  return namespace.kind === "mod"
    ? `mod:${namespace.id}:${id}`
    : `story:${namespace.scenarioId}:${namespace.arcId}:${id}`;
}
function normalizeReport(report: RuleReport): RuleReport {
  return "fromMonth" in report
    ? {
        ...report,
        fromMonth: report.fromMonth - 1,
        throughMonth: report.throughMonth - 1,
      }
    : { ...report };
}
function normalizedObjective(
  objective: RuleObjective,
  inherited: boolean,
): CompiledRuleObjective {
  const base = {
    ...objective,
    required: objective.required ?? true,
    ...(inherited ? { inherited: true } : {}),
  };
  if ("deadlineMonth" in base)
    return { ...base, deadlineMonth: base.deadlineMonth - 1 };
  const window = {
    fromMonth: base.fromMonth - 1,
    throughMonth: base.throughMonth - 1,
  };
  if (base.metric === "emissionsBudget") {
    const { budgetTonnesCO2e, ...rest } = base;
    return { ...rest, ...window, budgetKgCO2e: budgetTonnesCO2e * 1000 };
  }
  if (base.metric === "monthEndDebt") {
    const { maxDebtDollars, ...rest } = base;
    return { ...rest, ...window, maxDebt: maxDebtDollars };
  }
  return { ...base, ...window };
}
/** Compile data only. Official identity belongs to the caller's trusted catalog, never the rules. */
export function compileScenarioRules(
  definitions: ScenarioRuleDefinitions,
  params: RuleCompileParameters,
): CompiledScenarioRules {
  const diagnostics = ruleDiagnostics(definitions);
  const add = (
    code: string,
    path: string,
    message: string,
    severity: RuleDiagnostic["severity"] = "error",
  ) => diagnostics.push({ code, path, severity, message });
  if (!isRuleJson(definitions))
    add(
      "invalid-json",
      "rules",
      "Rules must contain plain finite JSON data only.",
    );
  if (
    !RULE_DIFFICULTIES.includes(params.difficulty) ||
    !Number.isInteger(params.seed) ||
    params.seed < 0 ||
    params.seed > 4294967295 ||
    !Number.isInteger(params.startingYear) ||
    params.startingYear < 1980 ||
    params.startingYear > 2100 ||
    !Number.isInteger(params.durationMonths) ||
    params.durationMonths < 1 ||
    params.durationMonths > 1200 ||
    !Number.isFinite(params.startingPeakW) ||
    params.startingPeakW < 0 ||
    params.startingPeakW > 1e15
  )
    add(
      "invalid-parameters",
      "rules",
      "Resolved difficulty, seed, year, duration and peak demand must be valid bounded values.",
    );
  if (diagnostics.some((d) => d.severity === "error"))
    throw new RuleCompilationError(diagnostics);
  const namespace = params.namespace;
  const namespaceKeys =
    namespace?.kind === "mod"
      ? ["kind", "id"]
      : ["kind", "scenarioId", "arcId"];
  if (
    !namespace ||
    Object.keys(namespace).some((key) => !namespaceKeys.includes(key)) ||
    (namespace.kind === "mod"
      ? !ID_PATTERN.test(namespace.id)
      : namespace.kind !== "official" ||
        !Number.isInteger(namespace.scenarioId) ||
        namespace.scenarioId < 100 ||
        namespace.scenarioId > 998 ||
        !ID_PATTERN.test(namespace.arcId)) ||
    !Array.isArray(params.startingAssetIds) ||
    params.startingAssetIds.length > 40 ||
    new Set(params.startingAssetIds).size !== params.startingAssetIds.length ||
    params.startingAssetIds.some(
      (id) => typeof id !== "string" || !ID_PATTERN.test(id),
    )
  )
    add(
      "invalid-namespace",
      "rules.namespace",
      "Only a bounded mod namespace or trusted official catalog namespace and unique catalog asset IDs are supported.",
    );
  const ids = new Map<string, string>();
  const register = (id: string, path: string) => {
    if (ids.has(id))
      add(
        "duplicate-id",
        path,
        `${path} repeats ${id}, already used at ${ids.get(id)}. Events, choices, objectives, reports and loads share one namespace.`,
      );
    else ids.set(id, path);
  };
  const within = (month: number, path: string) => {
    if (month > params.durationMonths)
      add(
        "outside-term",
        path,
        `${path} is month ${month}, after this run ends in month ${params.durationMonths}. Extend the term or move it earlier.`,
      );
  };
  const choices = definitions.choices ?? [],
    events = definitions.events ?? [];
  const checkReport = (report: RuleReport | undefined, path: string) => {
    if (!report) return;
    register(report.id, `${path}.id`);
    if ("fromMonth" in report) {
      within(report.fromMonth, `${path}.fromMonth`);
      within(report.throughMonth, `${path}.throughMonth`);
      if (
        report.kind === "deepFreeze" &&
        report.throughMonth - report.fromMonth !== 2
      )
        add(
          "invalid-report-window",
          path,
          "A deep-freeze report needs exactly three completed months: before, impact and recovery.",
        );
    }
  };
  const checkLoad = (load: RuleLoad, path: string) => {
    register(load.id, `${path}.id`);
    within(load.startMonth, `${path}.startMonth`);
    if (load.peakShareOfStartingPeak !== undefined && params.startingPeakW <= 0)
      add(
        "missing-starting-peak",
        `${path}.peakShareOfStartingPeak`,
        "Resolve the real starting grid's peak demand before compiling a capacity-share load.",
      );
  };
  events.forEach((event, i) => {
    register(event.id, `events[${i}].id`);
    const last =
      typeof event.startMonth === "number"
        ? event.startMonth
        : event.startMonth.to;
    within(last, `events[${i}].startMonth`);
    checkReport(event.report, `events[${i}].report`);
    checkReport(event.endReport, `events[${i}].endReport`);
    event.loads?.forEach((load, j) =>
      checkLoad(load, `events[${i}].loads[${j}]`),
    );
    event.effects?.outputMultipliersBySelector?.forEach((target, j) => {
      if (
        target.target.selector === "startingAsset" &&
        !params.startingAssetIds.includes(target.target.assetId)
      )
        add(
          "unknown-starting-asset",
          `events[${i}].effects.outputMultipliersBySelector[${j}].target.assetId`,
          `${target.target.assetId} is not supplied by this base scenario. Use an available starting-asset ID.`,
        );
    });
  });
  choices.forEach((choice, i) => {
    register(choice.id, `choices[${i}].id`);
    within(choice.dueMonth, `choices[${i}].dueMonth`);
    const options = new Set<string>();
    choice.options.forEach((o, j) => {
      if (options.has(o.id))
        add(
          "duplicate-option",
          `choices[${i}].options[${j}].id`,
          "Option IDs must be unique within their choice.",
        );
      options.add(o.id);
      o.replaceLoad?.with.forEach((load, k) =>
        checkLoad(load, `choices[${i}].options[${j}].replaceLoad.with[${k}]`),
      );
    });
    if (
      !choice.options.some(
        (o) =>
          o.costDollars === undefined ||
          ruleNumber(o.costDollars, params.difficulty) === 0,
      )
    )
      add(
        "missing-free-option",
        `choices[${i}].options`,
        "Every choice needs an unconditional free option at every difficulty.",
      );
  });
  definitions.objectives.forEach((o, i) => {
    register(o.id, `objectives[${i}].id`);
    if ("deadlineMonth" in o)
      within(o.deadlineMonth, `objectives[${i}].deadlineMonth`);
    else {
      within(o.fromMonth, `objectives[${i}].fromMonth`);
      within(o.throughMonth, `objectives[${i}].throughMonth`);
    }
  });
  definitions.debriefReports?.forEach((report, i) =>
    checkReport(report, `debriefReports[${i}]`),
  );
  const choiceById = new Map(choices.map((c) => [c.id, c]));
  const checkCondition = (
    condition: RuleCondition | undefined,
    month: number,
    path: string,
  ) => {
    if (!condition) return;
    if (condition.arc !== undefined) {
      if (
        !definitions.officialArcs?.some((a) => a.scenarioId === condition.arc)
      )
        add(
          "unknown-arc-reference",
          path,
          "The referenced arc must be included in officialArcs.",
        );
      return;
    }
    const choice = choiceById.get(condition.choiceId);
    if (!choice) {
      add(
        "unknown-choice",
        `${path}.choiceId`,
        `${condition.choiceId} is not a defined choice.`,
      );
      return;
    }
    if (choice.dueMonth > month)
      add(
        "later-decision",
        path,
        `The dependency is due in month ${choice.dueMonth}, after month ${month}.`,
      );
    const options = new Set(choice.options.map((o) => o.id));
    condition.optionIds.forEach((id) => {
      if (!options.has(id))
        add(
          "unknown-option",
          `${path}.optionIds`,
          `${id} is not an option of ${choice.id}.`,
        );
    });
    if (
      condition.optionIds.length === options.size &&
      condition.optionIds.every((id) => options.has(id))
    )
      add(
        "unnecessary-condition",
        path,
        "This names every option. Remove requiresChoice instead.",
      );
  };
  choices.forEach((c, i) =>
    checkCondition(
      c.requiresChoice,
      c.dueMonth,
      `choices[${i}].requiresChoice`,
    ),
  );
  events.forEach((e, i) =>
    checkCondition(
      e.requiresChoice,
      typeof e.startMonth === "number" ? e.startMonth : e.startMonth.from,
      `events[${i}].requiresChoice`,
    ),
  );
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      add("choice-cycle", "choices", `Choice dependency cycle includes ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const parent = choiceById.get(id)?.requiresChoice;
    if (parent?.arc === undefined && parent?.choiceId) visit(parent.choiceId);
    visiting.delete(id);
    visited.add(id);
  };
  choices.forEach((c) => visit(c.id));
  const loadById = new Map(
    events.flatMap((e) => (e.loads ?? []).map((l) => [l.id, l] as const)),
  );
  choices.forEach((choice, i) =>
    choice.options.forEach((option, j) => {
      const replacement = option.replaceLoad;
      if (replacement && !replacement.arc) {
        const load = loadById.get(replacement.loadId);
        if (!load)
          add(
            "unknown-load",
            `choices[${i}].options[${j}].replaceLoad.loadId`,
            "replaceLoad must name an authored load, or use an arc-scoped reference.",
          );
        else if (load.startMonth <= choice.dueMonth)
          add(
            "load-already-started",
            `choices[${i}].options[${j}].replaceLoad`,
            "A choice can replace a load only before its start month.",
          );
      }
      option.eventIds?.forEach((id) => {
        const event = events.find((e) => e.id === id);
        if (
          !event ||
          event.requiresChoice?.choiceId !== choice.id ||
          !event.requiresChoice.optionIds.includes(option.id)
        )
          add(
            "invalid-event-link",
            `choices[${i}].options[${j}].eventIds`,
            `${id} must name an event conditioned on this choice and option.`,
          );
      });
    }),
  );
  for (const [i, report] of (definitions.debriefReports ?? []).entries())
    if (
      report.kind === "affectedFacilities" &&
      !events.some((e) => e.id === report.eventId)
    )
      add(
        "unknown-event",
        `debriefReports[${i}].eventId`,
        "The affected-facilities report must name a defined event.",
      );
  if (diagnostics.some((d) => d.severity === "error"))
    throw new RuleCompilationError(diagnostics);
  const load = (
    definition: RuleLoad,
    eventId: string,
    condition?: RuleCondition,
  ): CompiledRuleLoad => ({
    id: definition.id,
    eventId,
    startMonth: definition.startMonth - 1,
    label: definition.demandType,
    demandType: definition.demandType,
    startsYear:
      params.startingYear + Math.floor((definition.startMonth - 1) / 12),
    startsMonth: ((definition.startMonth - 1) % 12) + 1,
    peakW:
      definition.peakMW !== undefined
        ? definition.peakMW * 1e6
        : definition.peakShareOfStartingPeak! * params.startingPeakW,
    loadFactor: definition.loadFactor,
    ...(definition.supplementsBackground === undefined
      ? {}
      : { supplementsBackground: definition.supplementsBackground }),
    ...(condition ? { requiresChoice: condition } : {}),
  });
  const compiledEvents = sorted(events).map((event): CompiledRuleEvent => {
    const first =
        typeof event.startMonth === "number"
          ? event.startMonth
          : event.startMonth.from,
      last =
        typeof event.startMonth === "number"
          ? event.startMonth
          : event.startMonth.to;
    const key = keyOf(params.namespace, event.id);
    const startMonth =
      first -
      1 +
      Math.floor(
        randomAt(
          params.seed,
          RANDOM_STREAM.worldEvents,
          hashAddress(`${key}|schedule`),
        ) *
          (last - first + 1),
      );
    const durationMonths =
      event.durationMonths === "untilEnd"
        ? params.durationMonths - startMonth
        : event.durationMonths === undefined
          ? 0
          : ruleNumber(event.durationMonths, params.difficulty);
    if (
      event.durationMonths !== "untilEnd" &&
      last - 1 + durationMonths > params.durationMonths
    )
      add(
        "truncated-event",
        `events.${event.id}.durationMonths`,
        `${event.title} may continue beyond the term; only months inside the run are observed.`,
        "warning",
      );
    const effects: WorldEventEffectsType = {},
      source = event.effects ?? {};
    for (const [author, engine] of [
      ["fuelPriceMultipliers", "fuelPriceMultipliers"],
      ["outputMultipliersByFuel", "facilityOutputMultipliersByFuel"],
      ["constructionCostMultipliersByFuel", "buildCostMultipliersByFuel"],
      ["operatingCostMultipliersByFuel", "operatingCostMultipliersByFuel"],
    ] as const)
      if (source[author])
        effects[engine] = Object.fromEntries(
          Object.entries(source[author]!).map(([fuel, value]) => [
            fuel,
            ruleNumber(value!, params.difficulty),
          ]),
        );
    if (source.demandMultiplier !== undefined)
      effects.demandMultiplier = ruleNumber(
        source.demandMultiplier,
        params.difficulty,
      );
    if (source.temperatureOffsetC !== undefined)
      effects.temperatureOffsetC = ruleNumber(
        source.temperatureOffsetC,
        params.difficulty,
      );
    if (source.hydroInflowMultiplier !== undefined)
      effects.hydroRunoffMultiplier = ruleNumber(
        source.hydroInflowMultiplier,
        params.difficulty,
      );
    if (source.operatingExpenseDollarsPerMonth !== undefined)
      effects.operatingExpensePerMonth = ruleNumber(
        source.operatingExpenseDollarsPerMonth,
        params.difficulty,
      );
    if (source.carbonFeeDollarsPerTonneCO2e !== undefined)
      effects.carbonFeePerKgCO2e =
        ruleNumber(source.carbonFeeDollarsPerTonneCO2e, params.difficulty) /
        1000;
    return {
      id: event.id,
      key,
      title: event.title,
      message: event.message,
      startMonth,
      possibleStartMonths: { from: first - 1, to: last - 1 },
      durationMonths,
      ...(event.durationMonths === "untilEnd"
        ? { durationUntilEnd: true as const }
        : {}),
      visibility: event.visibility ?? "forecast",
      ...(event.preview ? { preview: event.preview } : {}),
      ...(event.endMessage ? { endMessage: event.endMessage } : {}),
      ...(event.requiresChoice ? { requiresChoice: event.requiresChoice } : {}),
      effects,
      targets: sortedOperations(
        (source.outputMultipliersBySelector ?? []).map((t) => ({
          target:
            t.target.selector === "seededOperatingCapacityShare"
              ? {
                  ...t.target,
                  targetCapacityShare: ruleNumber(
                    t.target.targetCapacityShare,
                    params.difficulty,
                  ),
                }
              : t.target,
          outputMultiplier: ruleNumber(t.outputMultiplier, params.difficulty),
        })),
      ),
      transactions: sortedOperations(
        (source.transactions ?? []).map((t) => ({
          kind: t.kind,
          amount: ruleNumber(t.amountDollars, params.difficulty),
        })),
      ),
      ...(event.report ? { report: normalizeReport(event.report) } : {}),
      ...(event.endReport
        ? { endReport: normalizeReport(event.endReport) }
        : {}),
    };
  });
  const result: CompiledScenarioRules = {
    runtimeVersion: 1,
    namespace: params.namespace,
    difficulty: params.difficulty,
    seed: params.seed,
    startingYear: params.startingYear,
    durationMonths: params.durationMonths,
    startingPeakW: params.startingPeakW,
    startingAssetIds: [...params.startingAssetIds].sort(),
    officialArcs: [...(definitions.officialArcs ?? [])].sort(
      (a, b) => a.scenarioId - b.scenarioId,
    ),
    events: compiledEvents,
    choices: sorted(choices).map((c) => ({
      id: c.id,
      key: keyOf(params.namespace, c.id),
      title: c.title,
      prompt: c.prompt,
      dueMonth: c.dueMonth - 1,
      ...(c.requiresChoice ? { requiresChoice: c.requiresChoice } : {}),
      freeOptionId: sorted(c.options).find(
        (o) =>
          o.costDollars === undefined ||
          ruleNumber(o.costDollars, params.difficulty) === 0,
      )!.id,
      options: sorted(c.options).map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        message: o.message,
        cost:
          o.costDollars === undefined
            ? 0
            : ruleNumber(o.costDollars, params.difficulty),
        grant:
          o.grantDollars === undefined
            ? 0
            : ruleNumber(o.grantDollars, params.difficulty),
        ...(o.replaceLoad
          ? {
              replaceLoad: {
                ...o.replaceLoad,
                with: sorted(o.replaceLoad.with).map((l) =>
                  load(l, c.id, c.requiresChoice),
                ),
              },
            }
          : {}),
        ...(o.eventIds ? { eventIds: [...o.eventIds].sort() } : {}),
      })),
    })),
    objectives: sorted(definitions.objectives).map((o) =>
      normalizedObjective(
        o,
        params.inheritedObjectiveIds?.includes(o.id) ?? false,
      ),
    ),
    loads: sorted(
      events.flatMap((e) =>
        (e.loads ?? []).map((l) => load(l, e.id, e.requiresChoice)),
      ),
    ),
    debriefReports: sorted(definitions.debriefReports ?? []).map(
      normalizeReport,
    ),
  };
  const dependencyDiagnostics = scenarioRuleDependencyDiagnostics(result, {
    allowUnresolvedArcChoices: true,
  });
  diagnostics.push(
    ...dependencyDiagnostics.filter((d) => d.severity === "warning"),
  );
  const composition = scenarioRuleCompositionDiagnostics(result, [], {
    allowUnresolvedArcChoices: true,
  });
  if (composition.length) throw new RuleCompilationError(composition);
  if (utf8Bytes(canonicalRuleJson(result)).length > RULE_LIMITS.compiledBytes)
    throw new RuleCompilationError([
      {
        code: "compiled-bytes",
        path: "rules",
        severity: "error",
        message:
          "Compiled rules, including imported content, exceed the 512 KiB snapshot limit.",
      },
    ]);
  params.diagnostics?.push(...diagnostics);
  return detached(result);
}

function authoredReport(report: RuleReport): RuleReport {
  return "fromMonth" in report
    ? {
        ...report,
        fromMonth: report.fromMonth + 1,
        throughMonth: report.throughMonth + 1,
      }
    : { ...report };
}
function authoredObjective(objective: CompiledRuleObjective): RuleObjective {
  const { inherited: _inherited, ...base } = objective;
  if ("deadlineMonth" in base)
    return { ...base, deadlineMonth: base.deadlineMonth + 1 };
  const window = {
    fromMonth: base.fromMonth + 1,
    throughMonth: base.throughMonth + 1,
  };
  if (base.metric === "emissionsBudget") {
    const { budgetKgCO2e, ...rest } = base;
    return { ...rest, ...window, budgetTonnesCO2e: budgetKgCO2e / 1000 };
  }
  if (base.metric === "monthEndDebt") {
    const { maxDebt, ...rest } = base;
    return { ...rest, ...window, maxDebtDollars: maxDebt };
  }
  return { ...base, ...window };
}
/** Used only for validating normalized data; it does not recover the installed authoring package. */
export function ruleDefinitionsFromSnapshot(
  rules: CompiledScenarioRules,
): ScenarioRuleDefinitions {
  const load = (l: CompiledRuleLoad): RuleLoad => ({
    id: l.id,
    startMonth: l.startMonth + 1,
    demandType: l.demandType as "Data Centers" | "Mining",
    loadFactor: l.loadFactor,
    peakMW: l.peakW / 1e6,
    ...(l.supplementsBackground === undefined
      ? {}
      : { supplementsBackground: l.supplementsBackground }),
  });
  return {
    officialArcs: rules.officialArcs,
    events: rules.events.map((e) => {
      const effects: NonNullable<
        import("../data/ScenarioRules").RuleEvent["effects"]
      > = {};
      for (const [engine, author] of [
        ["fuelPriceMultipliers", "fuelPriceMultipliers"],
        ["facilityOutputMultipliersByFuel", "outputMultipliersByFuel"],
        ["buildCostMultipliersByFuel", "constructionCostMultipliersByFuel"],
        ["operatingCostMultipliersByFuel", "operatingCostMultipliersByFuel"],
      ] as const)
        if (e.effects[engine]) effects[author] = e.effects[engine];
      if (e.effects.demandMultiplier !== undefined)
        effects.demandMultiplier = e.effects.demandMultiplier;
      if (e.effects.temperatureOffsetC !== undefined)
        effects.temperatureOffsetC = e.effects.temperatureOffsetC;
      if (e.effects.hydroRunoffMultiplier !== undefined)
        effects.hydroInflowMultiplier = e.effects.hydroRunoffMultiplier;
      if (e.effects.operatingExpensePerMonth !== undefined)
        effects.operatingExpenseDollarsPerMonth =
          e.effects.operatingExpensePerMonth;
      if (e.effects.carbonFeePerKgCO2e !== undefined)
        effects.carbonFeeDollarsPerTonneCO2e =
          e.effects.carbonFeePerKgCO2e * 1000;
      if (e.targets.length) effects.outputMultipliersBySelector = e.targets;
      if (e.transactions.length)
        effects.transactions = e.transactions.map((t) => ({
          kind: t.kind,
          amountDollars: t.amount,
        }));
      const loads = rules.loads.filter((l) => l.eventId === e.id).map(load);
      return {
        id: e.id,
        title: e.title,
        message: e.message,
        startMonth:
          e.possibleStartMonths.from === e.possibleStartMonths.to
            ? e.possibleStartMonths.from + 1
            : {
                from: e.possibleStartMonths.from + 1,
                to: e.possibleStartMonths.to + 1,
              },
        ...(e.durationUntilEnd
          ? { durationMonths: "untilEnd" as const }
          : e.durationMonths
            ? { durationMonths: e.durationMonths }
            : {}),
        visibility: e.visibility,
        ...(e.preview ? { preview: e.preview } : {}),
        ...(e.endMessage ? { endMessage: e.endMessage } : {}),
        ...(e.requiresChoice ? { requiresChoice: e.requiresChoice } : {}),
        ...(Object.keys(effects).length ? { effects } : {}),
        ...(loads.length ? { loads } : {}),
        ...(e.report ? { report: authoredReport(e.report) } : {}),
        ...(e.endReport ? { endReport: authoredReport(e.endReport) } : {}),
      };
    }),
    choices: rules.choices.map((c) => ({
      id: c.id,
      dueMonth: c.dueMonth + 1,
      title: c.title,
      prompt: c.prompt,
      ...(c.requiresChoice ? { requiresChoice: c.requiresChoice } : {}),
      options: c.options.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        message: o.message,
        ...(o.grant ? { grantDollars: o.grant } : { costDollars: o.cost }),
        ...(o.replaceLoad
          ? {
              replaceLoad: {
                ...o.replaceLoad,
                with: o.replaceLoad.with.map(load),
              },
            }
          : {}),
        ...(o.eventIds ? { eventIds: o.eventIds } : {}),
      })),
    })),
    objectives: rules.objectives.map(authoredObjective),
    debriefReports: rules.debriefReports.map(authoredReport),
  };
}
function comparableNumbers(value: unknown): unknown {
  if (typeof value === "number") return Number(value.toPrecision(14));
  if (Array.isArray(value)) return value.map(comparableNumbers);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, comparableNumbers(v)]),
    );
  return value;
}
/** One normalized-rules validator for save import, host transfers and multiplayer saves. */
export function validCompiledScenarioRules(
  value: unknown,
): value is CompiledScenarioRules {
  try {
    if (
      !isRuleJson(value) ||
      utf8Bytes(JSON.stringify(value)).length > RULE_LIMITS.compiledBytes
    )
      return false;
    const rules = value as CompiledScenarioRules;
    if (rules.runtimeVersion !== 1) return false;
    const definitions = ruleDefinitionsFromSnapshot(rules);
    const normalized = compileScenarioRules(definitions, {
      namespace: rules.namespace,
      difficulty: rules.difficulty,
      seed: rules.seed,
      startingYear: rules.startingYear,
      durationMonths: rules.durationMonths,
      startingPeakW: rules.startingPeakW,
      startingAssetIds: rules.startingAssetIds,
      inheritedObjectiveIds: rules.objectives
        .filter((o) => o.inherited)
        .map((o) => o.id),
    });
    if (rules.arcChoices !== undefined) {
      if (!Array.isArray(rules.arcChoices) || rules.arcChoices.length > 200)
        return false;
      const seen = new Set<string>();
      for (const choice of rules.arcChoices) {
        if (
          !validOfficialArcChoiceMetadata(choice) ||
          !choice.source ||
          !rules.officialArcs.some(
            (arc) =>
              arc.scenarioId === choice.source!.scenarioId &&
              !!choice.automatic === !arc.includeChoices,
          ) ||
          seen.has(choice.key)
        )
          return false;
        seen.add(choice.key);
        const expectedKey =
          rules.namespace.kind === "mod"
            ? `mod:${rules.namespace.id}:arc:${choice.source.scenarioId}:choice:${choice.source.choiceId}`
            : `story:${choice.source.scenarioId}:${choice.source.arcId}:${choice.source.choiceId}`;
        if (choice.key !== expectedKey) return false;
        const {
          source: _source,
          automatic: _automatic,
          ...plainChoice
        } = choice;
        const meaningful = plainChoice.options.map(
          ({ meaningful, ...option }) => ({ option, meaningful }),
        );
        const genericChoice = {
          ...plainChoice,
          options: meaningful.map((entry) => entry.option),
        };
        const probe = {
          ...rules,
          choices: [genericChoice],
          events: [],
          loads: [],
          objectives: [],
          debriefReports: [],
        };
        delete probe.arcEvents;
        delete probe.arcChoices;
        const definitions = ruleDefinitionsFromSnapshot(probe);
        const checked = compileScenarioRules(definitions, {
          namespace: rules.namespace,
          difficulty: rules.difficulty,
          seed: rules.seed,
          startingYear: rules.startingYear,
          durationMonths: rules.durationMonths,
          startingPeakW: rules.startingPeakW,
          startingAssetIds: rules.startingAssetIds,
        });
        const canonicalChoice = { ...checked.choices[0], key: choice.key };
        if (
          canonicalRuleJson(comparableNumbers(canonicalChoice)) !==
          canonicalRuleJson(comparableNumbers(genericChoice))
        )
          return false;
      }
      normalized.arcChoices = rules.arcChoices;
    }
    if (rules.arcEvents !== undefined) {
      if (!Array.isArray(rules.arcEvents) || rules.arcEvents.length > 200)
        return false;
      const seen = new Set<string>();
      for (const event of rules.arcEvents) {
        if (
          !validOfficialArcMetadata(event) ||
          !event.source ||
          !rules.officialArcs.some(
            (arc) => arc.scenarioId === event.source!.scenarioId,
          ) ||
          seen.has(event.key)
        )
          return false;
        seen.add(event.key);
        const expectedKey =
          rules.namespace.kind === "mod"
            ? `mod:${rules.namespace.id}:arc:${event.source.scenarioId}:${event.source.arcId}:${event.source.phaseId}`
            : `story:${event.source.scenarioId}:${event.source.arcId}:${event.source.phaseId}`;
        if (
          event.key !== expectedKey ||
          !Number.isInteger(event.startMonth) ||
          event.startMonth < 0 ||
          event.startMonth >= rules.durationMonths ||
          !event.possibleStartMonths ||
          !Number.isInteger(event.possibleStartMonths.from) ||
          !Number.isInteger(event.possibleStartMonths.to) ||
          event.possibleStartMonths.from < 0 ||
          event.possibleStartMonths.from > event.startMonth ||
          event.possibleStartMonths.to < event.startMonth ||
          event.possibleStartMonths.to >= rules.durationMonths
        )
          return false;
        const {
          source: _source,
          protection: _protection,
          reports: _reports,
          ...plainEvent
        } = event;
        const probe = {
          ...rules,
          officialArcs: [],
          events: [
            {
              ...plainEvent,
              possibleStartMonths: {
                from: event.startMonth,
                to: event.startMonth,
              },
            },
          ],
          choices: [],
          objectives: [],
          loads: [],
          debriefReports: event.reports ?? [],
        };
        delete probe.arcEvents;
        const eventDefinitions = ruleDefinitionsFromSnapshot(probe);
        eventDefinitions.events![0].startMonth = event.startMonth + 1;
        eventDefinitions.events![0].preview ??= "This event will occur.";
        for (const report of event.reports ?? []) {
          if (
            report.kind === "affectedFacilities" &&
            !eventDefinitions.events!.some(
              (definition) => definition.id === report.eventId,
            )
          )
            eventDefinitions.events!.push({
              id: report.eventId,
              title: "Observed event",
              message: "Observed event.",
              preview: "This event will occur.",
              startMonth: 1,
            });
        }
        const checked = compileScenarioRules(eventDefinitions, {
          namespace: rules.namespace,
          difficulty: rules.difficulty,
          seed: rules.seed,
          startingYear: rules.startingYear,
          durationMonths: rules.durationMonths,
          startingPeakW: rules.startingPeakW,
          startingAssetIds: rules.startingAssetIds,
        });
        const canonicalEvent = {
          ...checked.events.find((definition) => definition.id === event.id)!,
          key: event.key,
          possibleStartMonths: event.possibleStartMonths,
        };
        if (event.preview === undefined) delete canonicalEvent.preview;
        if (
          canonicalRuleJson(comparableNumbers(canonicalEvent)) !==
            canonicalRuleJson(comparableNumbers(plainEvent)) ||
          canonicalRuleJson(checked.debriefReports) !==
            canonicalRuleJson(event.reports ?? [])
        )
          return false;
      }
      normalized.arcEvents = rules.arcEvents;
    }
    if (scenarioRuleCompositionDiagnostics(normalized).length) return false;
    // Unit conversion can change the last binary digit on a round trip. Structural keys and all
    // bounds are checked first; this comparison permits only that insignificant numeric drift.
    return (
      canonicalRuleJson(comparableNumbers(normalized)) ===
      canonicalRuleJson(comparableNumbers(rules))
    );
  } catch {
    return false;
  }
}
