import type {
  CompiledRuleChoice,
  CompiledRuleLoad,
  CompiledRuleOption,
  CompiledScenarioRules,
  RuleLoadReference,
} from "../data/ScenarioRules";
import type {
  ActiveWorldEventType,
  GameType,
  ScenarioLoadAdditionType,
  ScenarioType,
} from "../Types";
import { ruleChoices } from "./ScenarioRuleDependencies";
import { ruleLoadKey, ruleConditionMet } from "./ScenarioRuleRuntime";

/** Load arrays are unordered in the snapshot identity; runtime summation uses canonical IDs. */
export function scenarioRuleLoadOrder(
  loads: readonly ScenarioLoadAdditionType[],
): ScenarioLoadAdditionType[] {
  return [...loads].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function scenarioRuleLoadTargetKey(
  rules: CompiledScenarioRules,
  reference: RuleLoadReference,
): string {
  if (reference.arc !== undefined)
    return rules.namespace.kind === "mod"
      ? `custom-${reference.arc}-${reference.loadId}`
      : reference.loadId;
  return ruleLoadKey(rules, reference.loadId);
}

export function scenarioRuleReplacementLoads(
  rules: CompiledScenarioRules,
  choice: CompiledRuleChoice,
  loads: readonly CompiledRuleLoad[],
): ScenarioLoadAdditionType[] {
  return [...loads]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(
      ({
        eventId: _eventId,
        startMonth: _startMonth,
        requiresChoice: _requiresChoice,
        ...load
      }) => {
        if (
          choice.source &&
          rules.namespace.kind === "official" &&
          load.startsMonth === 1
        )
          delete load.startsMonth;
        return {
          ...load,
          id: choice.source
            ? rules.namespace.kind === "mod"
              ? `custom-${choice.source.scenarioId}-${load.id}`
              : load.id
            : ruleLoadKey(rules, load.id),
        };
      },
    );
}

export function scenarioRuleReplacedLoadIds(
  rules: CompiledScenarioRules,
  occurrences: readonly ActiveWorldEventType[],
): Set<string> {
  const choices = ruleChoices(rules);
  return new Set(
    occurrences.flatMap((event) => {
      const choice = choices.find((choice) => choice.key === event.key);
      const replacement = choice?.options.find(
        (option) => option.id === event.attributes.choice,
      )?.replaceLoad;
      return replacement ? [scenarioRuleLoadTargetKey(rules, replacement)] : [];
    }),
  );
}

/** Validate the complete new schedule before the transition books money or records an answer. */
export function scenarioRuleChoiceLoadPlan(
  game: GameType,
  rules: CompiledScenarioRules,
  choice: CompiledRuleChoice,
  option: CompiledRuleOption,
): ScenarioLoadAdditionType[] | undefined {
  const replacement = option.replaceLoad;
  if (!replacement) return game.loadAdditions;
  const targetId = scenarioRuleLoadTargetKey(rules, replacement);
  if (
    scenarioRuleReplacedLoadIds(rules, game.worldEvents.occurrences).has(
      targetId,
    )
  )
    return undefined;
  const target = game.loadAdditions.find((load) => load.id === targetId);
  const authoredTarget =
    replacement.arc === undefined
      ? rules.loads.find((load) => load.id === replacement.loadId)
      : undefined;
  const targetMonth = target
    ? (target.startsYear - rules.startingYear) * 12 +
      (target.startsMonth ?? 1) -
      1
    : authoredTarget?.startMonth;
  if (
    targetMonth === undefined ||
    targetMonth <= game.date.monthsElapsed ||
    replacement.with.some((load) => load.startMonth < game.date.monthsElapsed)
  )
    return undefined;
  const additions = scenarioRuleReplacementLoads(
    rules,
    choice,
    replacement.with,
  );
  if (
    additions.some((load) =>
      game.loadAdditions.some(
        (existing) => existing.id === load.id && existing.id !== targetId,
      ),
    )
  )
    return undefined;
  return scenarioRuleLoadOrder([
    ...game.loadAdditions.filter((load) => load.id !== targetId),
    ...additions,
  ]);
}

/** Reconstruct only authored schedules from frozen setup plus validated responses, never UI logs. */
export function scenarioRuleExpectedLoads(
  scenario: ScenarioType,
  rules: CompiledScenarioRules,
  occurrences: readonly ActiveWorldEventType[],
): ScenarioLoadAdditionType[] {
  let loads = [...(scenario.loadAdditions ?? [])];
  const replaced = scenarioRuleReplacedLoadIds(rules, occurrences);
  for (const load of rules.loads) {
    const id = ruleLoadKey(rules, load.id);
    if (
      replaced.has(id) ||
      !ruleConditionMet(load.requiresChoice, rules, occurrences) ||
      loads.some((existing) => existing.id === id)
    )
      continue;
    const {
      eventId: _eventId,
      startMonth: _startMonth,
      requiresChoice: _requiresChoice,
      ...addition
    } = load;
    loads.push({ ...addition, id });
  }
  const choices = ruleChoices(rules);
  for (const event of occurrences) {
    const choice = choices.find((choice) => choice.key === event.key);
    const replacement = choice?.options.find(
      (option) => option.id === event.attributes.choice,
    )?.replaceLoad;
    if (!choice || !replacement) continue;
    const id = scenarioRuleLoadTargetKey(rules, replacement);
    loads = [
      ...loads.filter((load) => load.id !== id),
      ...scenarioRuleReplacementLoads(rules, choice, replacement.with),
    ];
  }
  return scenarioRuleLoadOrder(loads);
}
