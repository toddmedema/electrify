import type {
  CompiledRuleEvent,
  CompiledScenarioRules,
  RuleCondition,
  RuleReport,
} from "../data/ScenarioRules";
import type { StoryContextType, ResolvedStoryType } from "../data/WorldEvents";
import type {
  ActiveWorldEventType,
  GameType,
  WorldEventEffectsType,
} from "../Types";
import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";
import { MINUTES_PER_MONTH } from "./DateTime";
import { interpretRuleReport, RuleReportContext } from "./ScenarioRuleReports";
import {
  resolveScenarioRuleTargets,
  survivingScenarioRuleTargets,
  ScenarioRuleTargetBinding,
} from "./ScenarioRuleTargets";
import { wildfirePreparednessEffectiveness } from "./Wildfire";
import { canonicalRuleJson } from "./RuleIdentity";
import {
  resolveScenarioRuleChoice,
  ruleChoices,
} from "./ScenarioRuleDependencies";

type Occurrence = ResolvedStoryType["occurrences"][number];
export const scenarioRuleTargetOperations = (event: CompiledRuleEvent) =>
  [...event.targets].sort((a, b) =>
    canonicalRuleJson(a) < canonicalRuleJson(b)
      ? -1
      : canonicalRuleJson(a) > canonicalRuleJson(b)
        ? 1
        : 0,
  );
export const ruleEvents = (rules: CompiledScenarioRules): CompiledRuleEvent[] =>
  [...rules.events, ...(rules.arcEvents ?? [])].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
export const ruleLoadKey = (rules: CompiledScenarioRules, id: string) =>
  `${rules.namespace.kind === "mod" ? `mod:${rules.namespace.id}` : `story:${rules.namespace.scenarioId}:${rules.namespace.arcId}`}:load:${id}`;

/** Protection is fixed from paid responses recorded before activation, including regional ramp. */
export function scenarioRuleProtectionFactor(
  event: CompiledRuleEvent,
  rules: CompiledScenarioRules,
  occurrences: readonly ActiveWorldEventType[],
  locationId: string,
): number {
  if (!event.protection) return 0;
  const choiceId =
    event.protection.kind === "deepFreezeWinterization"
      ? "winterization"
      : "preparedness";
  const option =
    event.protection.kind === "deepFreezeWinterization"
      ? "winterize"
      : "prepare";
  const source = event.source;
  const prior = occurrences.filter(
    (occurrence) =>
      occurrence.startsMinute <= event.startMonth * MINUTES_PER_MONTH,
  );
  const protectedChoice = prior.some(
    (occurrence) =>
      occurrence.attributes.choice === option &&
      (occurrence.key ===
        `story:${source?.scenarioId}:${source?.arcId}:${choiceId}` ||
        occurrence.key ===
          `mod:${rules.namespace.kind === "mod" ? rules.namespace.id : ""}:arc:${source?.scenarioId}:choice:${choiceId}`),
  );
  const regional =
    event.protection.kind === "wildfirePreparedness"
      ? 0.5 *
        wildfirePreparednessEffectiveness(
          prior,
          locationId,
          event.startMonth * MINUTES_PER_MONTH,
        )
      : 0;
  return 1 - (1 - (protectedChoice ? 0.5 : 0)) * (1 - regional);
}

/** Choice answers, activations and receipts share the existing persisted occurrence owner. */
export function ruleConditionMet(
  condition: RuleCondition | undefined,
  rules: CompiledScenarioRules,
  occurrences: readonly ActiveWorldEventType[] = [],
): boolean {
  if (!condition) return true;
  const key = resolveScenarioRuleChoice(condition, rules)?.key;
  return occurrences.some(
    (event) =>
      event.key === key &&
      condition.optionIds.includes(String(event.attributes.choice)),
  );
}

/** A disabled arc prompt commits to its free branch; forecasts can project that fact purely. */
export function scenarioRuleForecastOccurrences(
  rules: CompiledScenarioRules,
  occurrences: readonly ActiveWorldEventType[],
  throughMonth: number,
): ActiveWorldEventType[] {
  const result = [...occurrences];
  const automatic = ruleChoices(rules).filter(
    (choice) => choice.automatic && choice.dueMonth <= throughMonth,
  );
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const choice of automatic) {
      if (
        result.some((event) => event.key === choice.key) ||
        !ruleConditionMet(choice.requiresChoice, rules, result)
      )
        continue;
      const option = choice.options.find(
        (option) => option.id === choice.freeOptionId,
      )!;
      result.push({
        key: choice.key,
        definitionId: choice.key,
        startsMinute: choice.dueMonth * MINUTES_PER_MONTH,
        endsMinute: choice.dueMonth * MINUTES_PER_MONTH,
        attributes: {
          choice: option.id,
          cost: option.cost,
          upfrontGrant: option.grant,
          scenarioChoice: true,
          ruleChoice: true,
          automatic: true,
        },
        effects: {},
        title: choice.title,
        message: `Resolved automatically: ${option.label}. ${option.message}`,
      });
      progressed = true;
    }
  }
  return result;
}

function bindingsOf(
  event: ActiveWorldEventType,
): ScenarioRuleTargetBinding[][] {
  try {
    return JSON.parse(String(event.attributes.ruleTargets ?? "[]"));
  } catch {
    return [];
  }
}

export function ruleEffectsForOccurrence(
  event: ActiveWorldEventType,
  context: StoryContextType,
): WorldEventEffectsType {
  if (event.attributes.ruleEvent !== true || !context.rules)
    return event.effects;
  const definition = ruleEvents(context.rules).find((e) => e.key === event.key);
  if (!definition) return {};
  const effects: WorldEventEffectsType = { ...definition.effects };
  const protection = Number(event.attributes.ruleProtectionFactor ?? 0);
  if (
    definition.protection?.kind === "deepFreezeWinterization" &&
    protection > 0
  )
    effects.facilityOutputMultipliersByFuel = Object.fromEntries(
      Object.entries(effects.facilityOutputMultipliersByFuel ?? {}).map(
        ([fuel, multiplier]) => [fuel, 1 - (1 - multiplier) * (1 - protection)],
      ),
    );
  if (definition.protection?.kind === "wildfirePreparedness" && protection > 0)
    effects.demandMultiplier =
      1 - (1 - (effects.demandMultiplier ?? 1)) * (1 - protection);
  const byId: Record<string, number> = {};
  const operations = scenarioRuleTargetOperations(definition);
  const facilities = context.snapshot.facilities.map((f) => ({
    ...f,
    minuteCreated: f.minuteCreated ?? 0,
  }));
  bindingsOf(event).forEach((bindings, index) => {
    const multiplier = operations[index]?.outputMultiplier;
    if (multiplier === undefined) return;
    survivingScenarioRuleTargets(bindings, facilities).forEach((target) => {
      const output =
        definition.protection?.kind === "wildfirePreparedness"
          ? 1 - (1 - multiplier) * (1 - protection)
          : multiplier;
      byId[String(target.id)] = (byId[String(target.id)] ?? 1) * output;
    });
  });
  if (Object.keys(byId).length) effects.facilityOutputMultipliersById = byId;
  return effects;
}

export function interpretScenarioRuleReport(
  report: RuleReport,
  rules: CompiledScenarioRules,
  context: RuleReportContext,
) {
  const observation =
    "throughMonth" in report
      ? context.occurrences?.find(
          (event) =>
            event.key === ruleObservationKey(rules, report.throughMonth),
        )
      : undefined;
  const attrs = observation?.attributes;
  return interpretRuleReport(report, {
    ...context,
    eventKeys: Object.fromEntries(ruleEvents(rules).map((e) => [e.id, e.key])),
    ...(attrs
      ? {
          snapshot: {
            firmPeakW: Number(attrs.firmPeakW),
            storagePeakW: Number(attrs.storagePeakW),
            storagePeakWh: Number(attrs.storagePeakWh),
          },
          snapshotMonth: Number(attrs.month),
        }
      : {}),
  });
}

function reportDescription(
  report: RuleReport | undefined,
  context: StoryContextType,
) {
  if (!report || !context.rules) return undefined;
  return interpretScenarioRuleReport(report, context.rules, {
    startingYear: context.rules.startingYear,
    completedMonths: context.completedMonths ?? context.date.monthsElapsed,
    monthlyHistory: context.monthlyHistory ?? [],
    occurrences: context.occurrences,
    startingRateDollarsPerKWh: context.startingRateDollarsPerKWh,
    endingRateDollarsPerKWh: context.endingRateDollarsPerKWh,
  });
}

function resolveEvent(
  event: CompiledRuleEvent,
  context: StoryContextType,
  preview = false,
): Occurrence {
  const prior = context.occurrences?.find((o) => o.key === event.key);
  if (prior && !preview)
    return {
      ...prior,
      message: prior.message ?? event.message,
      kind: event.source?.kind ?? "WORLD_EVENT",
      effects: ruleEffectsForOccurrence(prior, context),
    };
  const facilities = context.snapshot.facilities.map((f) => ({
    ...f,
    minuteCreated: f.minuteCreated ?? 0,
  }));
  const targets = preview
    ? []
    : scenarioRuleTargetOperations(event).map((operation) =>
        resolveScenarioRuleTargets(operation.target, {
          seed: context.seed,
          eventKey: event.key,
          facilities,
          ...(event.source?.drawKey
            ? { officialDrawKey: event.source.drawKey }
            : {}),
        }),
      );
  const noMatch = targets.some((target) => target.noMatch);
  const grant = event.transactions
    .filter((t) => t.kind === "grant")
    .reduce((sum, t) => sum + t.amount, 0);
  const charge = event.transactions
    .filter((t) => t.kind === "charge")
    .reduce((sum, t) => sum + t.amount, 0);
  const protection = scenarioRuleProtectionFactor(
    event,
    context.rules!,
    context.occurrences ?? [],
    context.location.id,
  );
  const reportContext = {
    ...context,
    occurrences: [
      ...(context.occurrences ?? []),
      {
        key: event.key,
        definitionId: event.id,
        startsMinute: event.startMonth * MINUTES_PER_MONTH,
        endsMinute: event.startMonth * MINUTES_PER_MONTH,
        effects: {},
        attributes: {
          selectedFacilityNames: targets.flatMap((target) =>
            target.targets.map((facility) => facility.name),
          ),
        },
      },
    ],
  };
  const reports = preview
    ? []
    : [event.report, ...(event.reports ?? [])]
        .filter((report): report is RuleReport => !!report)
        .map((report) => reportDescription(report, reportContext)!);
  const importanceOrder = { ROUTINE: 0, NOTABLE: 1, CRITICAL: 2 };
  const importance = reports.reduce(
    (value, report) =>
      importanceOrder[report.importance] > importanceOrder[value]
        ? report.importance
        : value,
    event.source?.importance ?? "NOTABLE",
  );
  const occurrence: Occurrence = {
    key: event.key,
    definitionId: event.id,
    startsMinute: event.startMonth * MINUTES_PER_MONTH,
    endsMinute:
      Math.min(
        context.rules!.durationMonths,
        event.startMonth + event.durationMonths,
      ) * MINUTES_PER_MONTH,
    forecastable: event.visibility !== "surprise",
    kind: event.source?.kind ?? "WORLD_EVENT",
    title: event.title,
    message: preview
      ? (event.preview ?? event.message)
      : [
          event.message,
          noMatch
            ? "No eligible owned facility remains; no output effect was applied."
            : "",
          ...reports.map((report) => report.message),
        ]
          .filter(Boolean)
          .join(" "),
    importance: noMatch && importance === "ROUTINE" ? "NOTABLE" : importance,
    ...(event.source?.concept ? { concept: event.source.concept } : {}),
    ...(event.source?.actionTarget
      ? { actionTarget: event.source.actionTarget }
      : {}),
    turningPointPriority: Math.max(
      event.source?.turningPointPriority ?? 0,
      ...reports.map((report) => report.turningPointPriority),
    ),
    attributes: {
      ruleEvent: true,
      scheduledMonth: event.startMonth,
      ruleTargets: JSON.stringify(targets.map((target) => target.targets)),
      selectedFacilityIds: targets.flatMap((t) => t.targets.map((f) => f.id)),
      selectedFacilityNames: targets.flatMap((t) =>
        t.targets.map((f) => f.name),
      ),
      noMatch,
      ruleProtectionFactor: protection,
      cost: charge,
      upfrontGrant: grant,
      ...Object.assign({}, ...reports.map((report) => report.attributes)),
    },
    effects: event.effects,
  };
  occurrence.effects = ruleEffectsForOccurrence(occurrence, context);
  if (
    context.rules!.namespace.kind === "mod" &&
    event.source &&
    (event.protection || event.effects.operatingExpensePerMonth !== undefined)
  ) {
    const summary = scenarioEffectsSummary(occurrence.effects);
    occurrence.message = [
      `${context.location.name}: ${preview ? "Expected conditions: " : ""}${summary.join("; ")}.`,
      noMatch
        ? "No eligible owned facility remains; no output effect was applied."
        : "",
      ...reports.map((report) => report.message),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return occurrence;
}

/** Pure resolution: activation facts are returned to the existing world-event owner to persist. */
export function resolveScenarioRuleEvents(
  context: StoryContextType,
): Pick<ResolvedStoryType, "occurrences" | "active"> {
  if (!context.rules) return { occurrences: [], active: [] };
  const occurrences: Occurrence[] = [],
    active: Occurrence[] = [];
  for (const event of ruleEvents(context.rules)) {
    if (
      !ruleConditionMet(
        event.requiresChoice,
        context.rules,
        context.occurrences,
      )
    )
      continue;
    const month = context.date.monthsElapsed;
    const end = Math.min(
      context.rules.durationMonths,
      event.startMonth + event.durationMonths,
    );
    if (
      month === event.startMonth ||
      (month >= event.startMonth && month < end)
    ) {
      const occurrence = resolveEvent(event, context);
      if (month === event.startMonth) occurrences.push(occurrence);
      if (event.durationMonths > 0 && month < end) active.push(occurrence);
    }
    if (
      event.durationMonths > 0 &&
      month === end &&
      (event.endMessage || event.endReport)
    ) {
      // End reports require an observed onset; a forecast cannot invent its outcome or targets.
      if (!context.occurrences?.some((o) => o.key === event.key)) continue;
      const report = reportDescription(event.endReport, context);
      occurrences.push({
        key: `${event.key}:end`,
        definitionId: `${event.id}:end`,
        startsMinute: end * MINUTES_PER_MONTH,
        endsMinute: end * MINUTES_PER_MONTH,
        attributes: { ruleEventEnd: true, ...(report?.attributes ?? {}) },
        effects: {},
        title: event.title,
        message: [event.endMessage, report?.message].filter(Boolean).join(" "),
        kind: "WORLD_EVENT",
        importance: report?.importance ?? "NOTABLE",
        turningPointPriority: report?.turningPointPriority,
      });
    }
  }
  return { occurrences, active };
}

export function upcomingScenarioRuleEvents(
  context: StoryContextType,
): Occurrence[] {
  return context.rules
    ? ruleEvents(context.rules)
        .filter(
          (event) =>
            event.visibility !== "surprise" &&
            event.preview &&
            event.startMonth > context.date.monthsElapsed &&
            ruleConditionMet(
              event.requiresChoice,
              context.rules!,
              context.occurrences,
            ),
        )
        .map((event) => resolveEvent(event, context, true))
    : [];
}

function ruleObservationKey(rules: CompiledScenarioRules, month: number) {
  return `${rules.namespace.kind === "mod" ? `mod:${rules.namespace.id}` : `story:${rules.namespace.scenarioId}:${rules.namespace.arcId}`}:observation:${month}`;
}

/** Capture only the capacity facts required by reports, at the exact close of their window. */
export function captureRuleReportObservation(
  game: GameType,
  context: StoryContextType,
) {
  const rules = context.rules;
  if (!rules || context.date.monthsElapsed <= 0) return;
  const month = context.date.monthsElapsed - 1;
  const reports = [
    ...rules.debriefReports,
    ...ruleEvents(rules).flatMap((event) =>
      [event.report, event.endReport, ...(event.reports ?? [])].filter(
        (r): r is RuleReport => !!r,
      ),
    ),
  ];
  if (
    !reports.some(
      (report) => "throughMonth" in report && report.throughMonth === month,
    )
  )
    return;
  const key = ruleObservationKey(rules, month);
  if (game.worldEvents.occurrences.some((event) => event.key === key)) return;
  game.worldEvents.occurrences.push({
    key,
    definitionId: "rule-observation",
    startsMinute: context.date.minute,
    endsMinute: context.date.minute,
    effects: {},
    attributes: {
      ruleObservation: true,
      month,
      firmPeakW: context.snapshot.firmPeakW,
      storagePeakW: context.snapshot.storagePeakW,
      storagePeakWh: context.snapshot.storagePeakWh,
    },
  });
}
