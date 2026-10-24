import type { GameType, ActiveWorldEventType } from "../Types";
import type { StoryPhaseDescriptionType } from "../data/WorldEvents";
import type {
  CompiledRuleEvent,
  CompiledScenarioRules,
} from "../data/ScenarioRules";
import { officialPresentation } from "./ScenarioRulePresentation";
import { isOfficialCatalogRules, scenarioRules } from "./ScenarioRules";
import { getScenario } from "../data/Scenarios";
import {
  ruleConditionMet,
  officialRuleOccurrence,
  ruleEvents,
  scenarioRuleProtectionFactor,
  scenarioRuleTargetOperations,
  scenarioRuleCapacityReportMonths,
  ruleObservationKey,
  interpretScenarioRuleReport,
} from "./ScenarioRuleRuntime";
import { MINUTES_PER_MONTH } from "./DateTime";
import { canonicalRuleJson } from "./RuleIdentity";
import { ID_PATTERN } from "./ScenarioRulesSchema";
import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";
import { ruleChoices } from "./ScenarioRuleDependencies";
import { scenarioRuleExpectedLoads } from "./ScenarioRuleDecisions";
import { validRuleReportReceipt } from "./ScenarioRuleReports";
import type { ScenarioRuleTargetBinding } from "./ScenarioRuleTargets";

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
              Number.isSafeInteger(binding.minuteCreated) &&
              binding.minuteCreated >= 0 &&
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

/** Native receipts retain their published shape. Bind all physical effects to the common
 * definition and the recorded target IDs; presentation observations never authorize an effect. */
function validOfficialOccurrence(
  event: ActiveWorldEventType & Partial<StoryPhaseDescriptionType>,
  definition: CompiledRuleEvent,
  rules: CompiledScenarioRules,
  game: GameType,
): boolean {
  const presentation = officialPresentation(definition);
  if (
    rules.namespace.kind !== "official" ||
    !presentation ||
    !definition.source
  )
    return false;
  const source = definition.source;
  const review = presentation.nativeReview;
  const custom = game.scenarioId === 999 && !game.customScenario?.mod;
  const customNames = event.attributes.selectedFacilityNames as
    string[] | undefined;
  const title =
    custom && review === "nuclearTrip"
      ? customNames?.length
        ? `${customNames[0]} shuts down`
        : "Nuclear shutdown: no operating reactor affected"
      : custom
        ? definition.title.replace(
            /\b(?:19|20)\d{2}\b/g,
            String(rules.startingYear + Math.floor(definition.startMonth / 12)),
          )
        : definition.title;
  if (
    event.definitionId !== `${source.arcId}:${source.phaseId}` ||
    event.startsMinute !== definition.startMonth * MINUTES_PER_MONTH ||
    event.startsMinute > game.date.minute ||
    event.endsMinute !==
      (definition.startMonth + definition.durationMonths) * MINUTES_PER_MONTH ||
    event.forecastable !==
      (definition.visibility === "surprise" ? false : undefined) ||
    event.title !== title ||
    event.kind !== (source.kind ?? "WORLD_EVENT") ||
    event.concept !== source.concept ||
    canonicalRuleJson(event.actionTarget) !==
      canonicalRuleJson(
        custom ? { card: "FACILITIES", view: "FLEET" } : source.actionTarget,
      ) ||
    event.turningPointPriority !== source.turningPointPriority ||
    event.attributes.scheduledMonth !== definition.startMonth
  )
    return false;
  const attrs = event.attributes;
  const fixed = {
    ...presentation.attributes,
    ...presentation.attributesByDifficulty?.[rules.difficulty],
  };
  const measuredFields: Record<string, string[]> = {
    agingWarning: ["selectedFacilityIds", "selectedFacilityNames"],
    agingDerate: ["selectedFacilityIds"],
    hurricaneLandfall: [
      "selectedFacilityIds",
      "selectedFacilityNames",
      "selectedCapacityShare",
    ],
    nuclearTrip: ["selectedFacilityIds", "selectedFacilityNames"],
    shaleNormalization: ["gasShare", "reliability", "reportAvailable"],
    paradiseReview: ["shippedShare", "reliability", "reportAvailable"],
    renewablesReview: [
      "variableShare",
      "reliability",
      "coverage",
      "reportAvailable",
    ],
    coalTransitionReview: [
      "coalShare",
      "reliability",
      "netIncome",
      "legacyCoalW",
      "nonCoalFirmW",
      "reportAvailable",
    ],
    hurricaneRestoration: [
      "demandWh",
      "unservedWh",
      "reliability",
      "reportAvailable",
    ],
  };
  const allowed = new Set([
    "scheduledMonth",
    ...Object.keys(fixed),
    ...(measuredFields[review ?? ""] ?? []),
  ]);
  if (Object.keys(attrs).some((key) => !allowed.has(key))) return false;
  if (
    (attrs.reportAvailable !== undefined && attrs.reportAvailable !== false) ||
    (attrs.selectedFacilityIds !== undefined &&
      (!Array.isArray(attrs.selectedFacilityIds) ||
        attrs.selectedFacilityIds.some(
          (id) => !bounded(id, Number.MAX_SAFE_INTEGER, true),
        ) ||
        new Set<unknown>(attrs.selectedFacilityIds).size !==
          attrs.selectedFacilityIds.length))
  )
    return false;
  if (
    attrs.selectedFacilityNames !== undefined &&
    (!Array.isArray(attrs.selectedFacilityNames) ||
      !attrs.selectedFacilityNames.every((name) => typeof name === "string"))
  )
    return false;
  for (const key of [
    "selectedCapacityShare",
    "reliability",
    "gasShare",
    "shippedShare",
    "variableShare",
    "coalShare",
    "coverage",
  ])
    if (attrs[key] !== undefined && !bounded(attrs[key], 1)) return false;
  for (const [key, value] of Object.entries(fixed)) {
    if (canonicalRuleJson(attrs[key]) !== canonicalRuleJson(value))
      return false;
  }
  const effects = { ...definition.effects };
  const protection = scenarioRuleProtectionFactor(
    definition,
    rules,
    game.worldEvents.occurrences.filter(
      (receipt) => receipt.startsMinute <= event.startsMinute,
    ),
  );
  if (
    definition.protection?.kind === "deepFreezeWinterization" &&
    protection > 0
  )
    effects.facilityOutputMultipliersByFuel = Object.fromEntries(
      Object.entries(effects.facilityOutputMultipliersByFuel ?? {}).map(
        ([fuel, value]) => [fuel, 1 - (1 - value) * (1 - protection)],
      ),
    );
  if (definition.targets.length) {
    const ids = attrs.selectedFacilityIds;
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !bounded(id, Number.MAX_SAFE_INTEGER, true)) ||
      new Set<unknown>(ids).size !== ids.length
    )
      return false;
    const targetEffects: Record<string, number> = {};
    for (const operation of definition.targets) {
      const output = operation.outputMultiplier;
      for (const id of ids)
        targetEffects[String(id)] = (targetEffects[String(id)] ?? 1) * output;
    }
    effects.facilityOutputMultipliersById = targetEffects;
  }
  if (canonicalRuleJson(event.effects) !== canonicalRuleJson(effects))
    return false;
  if (custom) {
    const changes = scenarioEffectsSummary(effects);
    const message =
      review === "nuclearTrip"
        ? customNames?.length
          ? `${customNames[0]} is offline for the rest of this event. Replace its output with generation, storage or imports.`
          : "Your grid has no operating nuclear reactor, so this shutdown causes no loss of supply."
        : `${game.location.name}: ${changes.length ? changes.join("; ") + "." : "Review your supply and reserves before the upcoming scenario event."}`;
    return event.message === message && typeof event.importance === "string";
  }
  if (!review || ["hurricaneOutlook", "nuclearContingency"].includes(review))
    return (
      event.message === definition.message &&
      event.importance === source.importance
    );
  return (
    typeof event.message === "string" &&
    ["ROUTINE", "NOTABLE", "CRITICAL"].includes(event.importance ?? "")
  );
}

/** Reject missing/duplicated receipts or edited amounts before the accounting owner sees a save. */
function validSecondaryRuleReceipts(
  game: GameType,
  rules: CompiledScenarioRules,
): boolean {
  const definitions = ruleEvents(rules);
  const secondary = new Map<string, ActiveWorldEventType>();
  for (const receipt of game.worldEvents.occurrences) {
    const ending = receipt.attributes.ruleEventEnd === true;
    const observation = receipt.attributes.ruleObservation === true;
    if (!ending && !observation) continue;
    if (ending === observation || secondary.has(receipt.key)) return false;
    secondary.set(receipt.key, receipt);
    if (observation) {
      const month = receipt.attributes.month;
      if (
        isOfficialCatalogRules(rules) ||
        !bounded(month, rules.durationMonths - 1, true) ||
        !scenarioRuleCapacityReportMonths(rules).includes(month) ||
        (month + 1) * MINUTES_PER_MONTH > game.date.minute ||
        !["firmPeakW", "storagePeakW", "storagePeakWh"].every((key) =>
          bounded(receipt.attributes[key], Number.MAX_VALUE),
        ) ||
        canonicalRuleJson(receipt) !==
          canonicalRuleJson({
            key: ruleObservationKey(rules, month),
            definitionId: "rule-observation",
            startsMinute: (month + 1) * MINUTES_PER_MONTH,
            endsMinute: (month + 1) * MINUTES_PER_MONTH,
            effects: {},
            attributes: {
              ruleObservation: true,
              month,
              firmPeakW: receipt.attributes.firmPeakW,
              storagePeakW: receipt.attributes.storagePeakW,
              storagePeakWh: receipt.attributes.storagePeakWh,
            },
          })
      )
        return false;
      continue;
    }
    const definition = definitions.find(
      (event) => `${event.key}:end` === receipt.key,
    );
    if (
      !definition ||
      definition.durationMonths <= 0 ||
      (!definition.endMessage && !definition.endReport) ||
      !game.worldEvents.occurrences.some(
        (event) => event.key === definition.key,
      )
    )
      return false;
    const endMinute =
      Math.min(
        rules.durationMonths,
        definition.startMonth + definition.durationMonths,
      ) * MINUTES_PER_MONTH;
    const { attributes, message, importance, turningPointPriority, ...shape } =
      receipt as ActiveWorldEventType & Partial<StoryPhaseDescriptionType>;
    if (
      endMinute > game.date.minute ||
      canonicalRuleJson(shape) !==
        canonicalRuleJson({
          key: `${definition.key}:end`,
          definitionId: `${definition.id}:end`,
          startsMinute: endMinute,
          endsMinute: endMinute,
          effects: {},
          title: definition.title,
          kind: "WORLD_EVENT",
        })
    )
      return false;
    const { ruleEventEnd: _ending, ...facts } = attributes;
    if (definition.endReport) {
      if (
        !validRuleReportReceipt(
          definition.endReport,
          facts,
          importance,
          turningPointPriority,
        ) ||
        typeof message !== "string" ||
        !message.length ||
        (definition.endMessage &&
          !message.startsWith(`${definition.endMessage} `))
      )
        return false;
    } else if (
      Object.keys(facts).length ||
      message !== definition.endMessage ||
      importance !== "NOTABLE" ||
      turningPointPriority !== undefined
    )
      return false;
  }
  const activeKeys = new Set<string>();
  for (const active of game.worldEvents.active) {
    if (
      active.attributes.ruleObservation !== true &&
      active.attributes.ruleEventEnd !== true
    )
      continue;
    if (
      active.attributes.ruleObservation === true ||
      activeKeys.has(active.key) ||
      canonicalRuleJson(secondary.get(active.key)) !== canonicalRuleJson(active)
    )
      return false;
    activeKeys.add(active.key);
  }
  return true;
}

export function validScenarioRuleState(game: GameType): boolean {
  const rules = scenarioRules(
    getScenario(game.scenarioId, game.customScenario),
    game,
  );
  const occurrences = game.worldEvents.occurrences;
  const officialPrefixes =
    rules?.namespace.kind === "official"
      ? [
          ...new Set(
            ruleEvents(rules).flatMap((event) =>
              event.source
                ? [`story:${event.source.scenarioId}:${event.source.arcId}:`]
                : [],
            ),
          ),
        ]
      : [];
  const belongsToRules = (
    event: GameType["worldEvents"]["occurrences"][number],
  ) =>
    event.attributes.ruleEvent === true ||
    (rules &&
      ((rules.namespace.kind === "mod"
        ? event.key.startsWith(`mod:${rules.namespace.id}:`)
        : event.key.startsWith(
            `story:${rules.namespace.scenarioId}:${rules.namespace.arcId}:`,
          )) ||
        officialPrefixes.some((prefix) => event.key.startsWith(prefix))) &&
      event.attributes.scenarioChoice !== true &&
      event.attributes.ruleObservation !== true &&
      event.attributes.ruleEventEnd !== true);
  const ruleOccurrences = occurrences.filter(belongsToRules);
  if (!rules)
    return (
      ruleOccurrences.length === 0 &&
      !occurrences.some(
        (event) =>
          event.attributes.ruleChoice === true ||
          event.attributes.ruleEventEnd === true ||
          event.attributes.ruleObservation === true,
      )
    );
  if (!validSecondaryRuleReceipts(game, rules)) return false;
  const choices = ruleChoices(rules);
  const answered = new Set<string>();
  for (const [index, event] of occurrences.entries()) {
    if (
      event.attributes.ruleChoice !== true &&
      event.attributes.scenarioChoice !== true
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
      (rules.namespace.kind === "mod" || !choice.source
        ? event.attributes.ruleChoice !== true ||
          event.attributes.automatic !== !!choice.automatic
        : event.attributes.ruleChoice !== undefined ||
          event.attributes.automatic !== undefined) ||
      event.attributes.scenarioChoice !== true ||
      event.startsMinute !== choice.dueMonth * MINUTES_PER_MONTH ||
      event.endsMinute !== event.startsMinute ||
      event.startsMinute > game.date.minute ||
      event.attributes.cost !== option.cost ||
      event.attributes.upfrontGrant !== option.grant ||
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
  const ownedFacilities = new Map(
    game.facilities.map((facility) => [facility.id, facility]),
  );
  for (const event of ruleOccurrences) {
    if (seen.has(event.key)) return false;
    seen.add(event.key);
    const definition = definitions.find(
      (definition) => definition.key === event.key,
    );
    if (definition) {
      if (
        rules.namespace.kind === "official" &&
        (officialPresentation(definition)?.nativeReview ||
          rules.namespace.scenarioId === 999)
      ) {
        if (!validOfficialOccurrence(event, definition, rules, game))
          return false;
        continue;
      }
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
    const groups = JSON.parse(
      String(event.attributes.ruleTargets),
    ) as ScenarioRuleTargetBinding[][];
    const operations = scenarioRuleTargetOperations(definition);
    if (
      groups.length !== operations.length ||
      groups.some(
        (group, index) =>
          new Set(group.map((target) => target.id)).size !== group.length ||
          group.some((target) => {
            if (target.minuteCreated > event.startsMinute) return true;
            const owned = ownedFacilities.get(target.id);
            // A unit that predates activation, or retains its original catalog
            // identity, cannot be a later ID-reusing purchase. At the opening
            // itself a sale/rebuild can reuse an ID at the same clock minute.
            if (
              !owned ||
              (owned.minuteCreated >= event.startsMinute &&
                owned.startingAssetId === undefined)
            )
              return false;
            return (
              target.minuteCreated !== owned.minuteCreated ||
              target.startingAssetId !== owned.startingAssetId
            );
          }) ||
          (operations[index].target.selector === "startingAsset" &&
            group.some(
              (target) =>
                target.startingAssetId !==
                (operations[index].target as { assetId: string }).assetId,
            )),
      )
    )
      return false;
    const targetNames = groups.flatMap((group) =>
      group.map((binding) => binding.name),
    );
    // A review can describe an earlier activation while owning no targets itself.
    // Resolve these report facts through the same owner as live reporting. For a
    // self-report, seed its names from the pinned bindings instead of trusting the
    // reported names we are validating.
    let reportNames: unknown = targetNames;
    let affectedCount: unknown;
    for (const report of [definition.report, ...(definition.reports ?? [])]) {
      if (report?.kind !== "affectedFacilities") continue;
      const facts = interpretScenarioRuleReport(report, rules, {
        startingYear: game.startingYear,
        completedMonths: definition.startMonth,
        monthlyHistory: [],
        occurrences: [
          ...occurrences.filter((receipt) => receipt.key !== event.key),
          {
            ...event,
            attributes: { selectedFacilityNames: targetNames },
          },
        ],
      }).attributes;
      if (facts.selectedFacilityNames !== undefined)
        reportNames = facts.selectedFacilityNames;
      if (facts.affectedFacilityCount !== undefined)
        affectedCount = facts.affectedFacilityCount;
    }
    if (
      canonicalRuleJson(reportNames) !==
        canonicalRuleJson(event.attributes.selectedFacilityNames) ||
      affectedCount !== event.attributes.affectedFacilityCount ||
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
      !(
        rules.namespace.kind === "official" &&
        event.startMonth === 0 &&
        !event.targets.length &&
        !event.transactions.length &&
        officialPresentation(event)
      ) &&
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
