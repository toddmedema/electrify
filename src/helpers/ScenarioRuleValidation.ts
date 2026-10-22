import type { GameType } from "../Types";
import { scenarioRules } from "./ScenarioRules";
import { getScenario } from "../data/Scenarios";
import {
  ruleConditionMet,
  officialRuleOccurrence,
  ruleEvents,
  scenarioRuleProtectionFactor,
  scenarioRuleTargetOperations,
} from "./ScenarioRuleRuntime";
import { MINUTES_PER_MONTH } from "./DateTime";
import { canonicalRuleJson } from "./RuleIdentity";
import { ID_PATTERN } from "./ScenarioRulesSchema";
import { ruleChoices } from "./ScenarioRuleDependencies";
import { scenarioRuleExpectedLoads } from "./ScenarioRuleDecisions";

const bounded = (
  value: unknown,
  max: number,
  integer = false,
): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max &&
  (!integer || Number.isInteger(value));
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Stored target identities are plain bounded facts, never selector instructions. */
export function validRuleTargetBindings(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const groups: unknown = JSON.parse(value);
    return (
      Array.isArray(groups) &&
      groups.length <= 10 &&
      groups.every(
        (group: unknown) =>
          Array.isArray(group) &&
          group.every(
            (binding: unknown) =>
              record(binding) &&
              Object.keys(binding).every((key) =>
                [
                  "id",
                  "minuteCreated",
                  "startingAssetId",
                  "name",
                  "peakW",
                ].includes(key),
              ) &&
              typeof binding.id === "number" &&
              Number.isInteger(binding.id) &&
              binding.id >= 0 &&
              typeof binding.minuteCreated === "number" &&
              Number.isFinite(binding.minuteCreated) &&
              typeof binding.peakW === "number" &&
              Number.isFinite(binding.peakW) &&
              binding.peakW >= 0 &&
              typeof binding.name === "string" &&
              (binding.startingAssetId === undefined ||
                (typeof binding.startingAssetId === "string" &&
                  ID_PATTERN.test(binding.startingAssetId))),
          ),
      )
    );
  } catch {
    return false;
  }
}

/** Reject missing/duplicated receipts or edited amounts before the accounting owner sees a save. */
export function validScenarioRuleState(game: GameType): boolean {
  const rules = scenarioRules(
    getScenario(game.scenarioId, game.customScenario),
    game,
  );
  const occurrences = game.worldEvents.occurrences;
  const belongsToRules = (
    event: GameType["worldEvents"]["occurrences"][number],
  ) =>
    event.attributes.ruleEvent === true ||
    (rules?.namespace.kind === "official" &&
      event.key.startsWith(
        `story:${rules.namespace.scenarioId}:${rules.namespace.arcId}:`,
      ) &&
      event.attributes.scenarioChoice !== true &&
      event.attributes.ruleObservation !== true);
  const ruleOccurrences = occurrences.filter(belongsToRules);
  if (!rules)
    return (
      ruleOccurrences.length === 0 &&
      !occurrences.some((event) => event.attributes.ruleChoice === true)
    );
  const choices = ruleChoices(rules);
  const answered = new Set<string>();
  for (const [index, event] of occurrences.entries()) {
    if (
      event.attributes.ruleChoice !== true &&
      !(
        event.attributes.scenarioChoice === true &&
        !event.key.startsWith("wildfire:")
      )
    )
      continue;
    const choice = choices.find((choice) => choice.key === event.key);
    const option = choice?.options.find(
      (option) => option.id === event.attributes.choice,
    );
    if (
      !choice ||
      !option ||
      answered.has(choice.key) ||
      event.attributes.ruleChoice !== true ||
      event.attributes.scenarioChoice !== true ||
      event.startsMinute !== choice.dueMonth * MINUTES_PER_MONTH ||
      event.endsMinute !== event.startsMinute ||
      event.startsMinute > game.date.minute ||
      event.attributes.cost !== option.cost ||
      event.attributes.upfrontGrant !== option.grant ||
      event.attributes.automatic !== !!choice.automatic ||
      (choice.automatic && option.id !== choice.freeOptionId) ||
      !ruleConditionMet(
        choice.requiresChoice,
        rules,
        occurrences.slice(0, index),
      )
    )
      return false;
    answered.add(choice.key);
  }
  for (const choice of choices) {
    if (
      game.storyEffectsDisabled ||
      answered.has(choice.key) ||
      !ruleConditionMet(choice.requiresChoice, rules, occurrences)
    )
      continue;
    const dueMinute = choice.dueMonth * MINUTES_PER_MONTH;
    if (
      game.date.minute > dueMinute ||
      (choice.automatic && game.date.minute === dueMinute)
    )
      return false;
  }
  const byId = (loads: GameType["loadAdditions"]) =>
    [...loads].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (
    canonicalRuleJson(byId(game.loadAdditions)) !==
    canonicalRuleJson(
      byId(
        scenarioRuleExpectedLoads(
          getScenario(game.scenarioId, game.customScenario)!,
          rules,
          occurrences,
        ),
      ),
    )
  )
    return false;
  const definitions = ruleEvents(rules);
  const seen = new Set<string>();
  for (const event of ruleOccurrences) {
    if (seen.has(event.key)) return false;
    seen.add(event.key);
    const definition = definitions.find(
      (definition) => definition.key === event.key,
    );
    if (definition) {
      const official = officialRuleOccurrence(definition, rules);
      if (official) {
        if (
          event.startsMinute > game.date.minute ||
          canonicalRuleJson(official) !== canonicalRuleJson(event)
        )
          return false;
        continue;
      }
    }
    if (
      !definition ||
      !validRuleTargetBindings(event.attributes.ruleTargets) ||
      event.startsMinute !== definition.startMonth * MINUTES_PER_MONTH ||
      event.startsMinute > game.date.minute ||
      !ruleConditionMet(
        definition.requiresChoice,
        rules,
        occurrences.slice(0, occurrences.indexOf(event)),
      ) ||
      event.endsMinute !==
        Math.min(
          rules.durationMonths,
          definition.startMonth + definition.durationMonths,
        ) *
          MINUTES_PER_MONTH
    )
      return false;
    if (
      !bounded(event.attributes.ruleProtectionFactor, 1) ||
      (!definition.protection && event.attributes.ruleProtectionFactor !== 0)
    )
      return false;
    if (
      event.attributes.ruleProtectionFactor !==
      scenarioRuleProtectionFactor(
        definition,
        rules,
        occurrences.slice(0, occurrences.indexOf(event)),
        game.location.id,
      )
    )
      return false;
    const grant = definition.transactions
      .filter((t) => t.kind === "grant")
      .reduce((sum, t) => sum + t.amount, 0);
    const charge = definition.transactions
      .filter((t) => t.kind === "charge")
      .reduce((sum, t) => sum + t.amount, 0);
    if (
      event.attributes.upfrontGrant !== grant ||
      event.attributes.cost !== charge
    )
      return false;
    const groups = JSON.parse(String(event.attributes.ruleTargets)) as Array<
      Array<{ id: number; startingAssetId?: string; name: string }>
    >;
    const operations = scenarioRuleTargetOperations(definition);
    if (
      groups.length !== operations.length ||
      groups.some(
        (group, index) =>
          new Set(group.map((target) => target.id)).size !== group.length ||
          (operations[index].target.selector === "startingAsset" &&
            group.some(
              (target) =>
                target.startingAssetId !==
                (operations[index].target as { assetId: string }).assetId,
            )),
      )
    )
      return false;
    if (
      canonicalRuleJson(
        groups.flatMap((group) => group.map((binding) => binding.name)),
      ) !== canonicalRuleJson(event.attributes.selectedFacilityNames) ||
      canonicalRuleJson(
        groups.flatMap((group) => group.map((binding) => binding.id)),
      ) !== canonicalRuleJson(event.attributes.selectedFacilityIds)
    )
      return false;
  }
  for (const event of definitions) {
    if (
      !game.storyEffectsDisabled &&
      event.startMonth <= game.date.monthsElapsed &&
      ruleConditionMet(event.requiresChoice, rules, occurrences) &&
      !seen.has(event.key)
    )
      return false;
  }
  const activeKeys = new Set<string>();
  for (const active of game.worldEvents.active.filter(belongsToRules)) {
    if (activeKeys.has(active.key)) return false;
    activeKeys.add(active.key);
    const recorded = ruleOccurrences.find((event) => event.key === active.key);
    if (!recorded || canonicalRuleJson(recorded) !== canonicalRuleJson(active))
      return false;
  }
  return true;
}
