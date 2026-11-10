import { legacyMonthOffset, legacyCompletedMonths } from "./LegacyCampaign";
import { isLegacyCampaignScenario } from "../data/LegacyCampaign";
import {
  isUtilityExpansionGame,
  isUtilityExpansionScenario,
} from "./ExpansionContext";
import { expansionRetentionBaseline } from "./Expansion";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { formatCount, formatNumber } from "./Format";
import {
  DifficultyType,
  GameType,
  MonthlyHistoryType,
  ScenarioType,
  TickPresentFutureType,
} from "../Types";
import {
  bestReachableCustomers,
  CUSTOMER_MARKET_MULTIPLIER,
  customerMarketSizeAt,
} from "./Customers";
import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type {
  ObjectiveContext,
  ObjectiveProgress,
  ObjectiveResult,
} from "../data/ScenarioObjectives";
import { getScenario } from "../data/Scenarios";
import { UTILITY_EXPANSION_OBJECTIVES } from "../data/UtilityExpansionObjectives";
import { scenarioRules } from "./ScenarioRules";
import { ruleDigest, canonicalRuleJson } from "./RuleIdentity";
import { MINUTES_PER_MONTH } from "./DateTime";
import { getTotalDebt } from "./Financials";
import {
  createObjectiveProgress,
  recordObjectiveMonth,
  evaluateScenarioObjectives,
  validObjectiveProgress,
  objectiveMonthObservation,
  rebaseObjectiveRetention,
} from "./ScenarioObjectives";
export { objectiveDefinition } from "./ScenarioObjectives";

export const absoluteMonth = (year: number, month: number): number =>
  year * 12 + month - 1;
export const demandServed = (month: MonthlyHistoryType): number =>
  month.demandWh > 0 ? month.supplyWh / month.demandWh : 1;
/** The same three completed-month firing rule used by the game and headless playtests. */
export const reliabilityThreshold = (difficulty: DifficultyType): number =>
  ({ Intern: 0.9, Employee: 0.95, Manager: 0.97, VP: 0.99, CEO: 0.995 })[
    difficulty
  ];

export const reliabilityRuleText = (
  difficulty: DifficultyType,
  scenario?: Pick<
    ScenarioType,
    "reliabilityFailureDisabled" | "retainCustomersDuringShortages"
  >,
): string =>
  scenario?.reliabilityFailureDisabled
    ? `No minimum reliability requirement. Blackouts reduce your score${scenario.retainCustomersDuringShortages ? "" : " and drive customers away"}, but do not end the run.`
    : `Serving less than ${formatRequiredShare(reliabilityThreshold(difficulty))} of demand for 3 months in a row ends the run.`;

export function hasChronicBlackouts(
  history: MonthlyHistoryType[],
  difficulty: DifficultyType,
): boolean {
  return (
    history.length >= 3 &&
    history
      .slice(0, 3)
      .every(
        (month, index, months) =>
          month.supplyWh < month.demandWh * reliabilityThreshold(difficulty) &&
          (index === 0 ||
            absoluteMonth(months[index - 1].year, months[index - 1].month) ===
              absoluteMonth(month.year, month.month) + 1),
      )
  );
}

/** A required share as a percentage, keeping one decimal only when it has one (99.5%, 100%). */
export function formatRequiredShare(fraction: number): string {
  const percent = Math.round(fraction * 1000) / 10;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/**
 * The customer count a retention objective is measured against. Authored public scenarios name
 * it; otherwise it is the run's own starting base, which initGame stored as half the market.
 */
export function retentionBaseline(
  scenario: ScenarioType,
  customerMarketSize?: number,
): number | undefined {
  if (scenario.minimumCustomerRetention === undefined) return undefined;
  if (scenario.startingCustomers !== undefined)
    return scenario.startingCustomers;
  return customerMarketSize && customerMarketSize > 0
    ? customerMarketSize / CUSTOMER_MARKET_MULTIPLIER
    : undefined;
}

export interface ObjectiveProgressType {
  /** The retention baseline; see retentionBaseline. */
  startingCustomers?: number;
  /** Whole months left in the term after the latest completed month. */
  monthsRemaining: number;
  /** The addressable market now, for an investor's best-case recovery. */
  marketSize?: number;
}

/** Whether the retention objective is out of reach even with the best possible growth. */
export function retentionUnreachable(
  scenario: ScenarioType,
  customers: number,
  progress: ObjectiveProgressType,
): { bestCase: number; threshold: number } | undefined {
  if (
    scenario.minimumCustomerRetention === undefined ||
    progress.startingCustomers === undefined
  )
    return undefined;
  const threshold =
    progress.startingCustomers * scenario.minimumCustomerRetention;
  const bestCase = bestReachableCustomers(
    customers,
    Math.max(0, progress.monthsRemaining),
    scenario.ownership,
    progress.marketSize,
  );
  return bestCase < threshold ? { bestCase, threshold } : undefined;
}

/**
 * An objective that is already decided before term end, such as a customer count that
 * cannot recover in the time left. Customer retention is otherwise evaluated at term end.
 */
export function decidedObjectiveFailure(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  progress: ObjectiveProgressType,
): string | undefined {
  return historyObjectiveResults(scenario, history, {
    completedMonths: Math.max(
      0,
      scenario.durationMonths - progress.monthsRemaining,
    ),
    startingCustomers: progress.startingCustomers,
    marketSize: progress.marketSize,
    retentionAtBoundary: true,
  }).find((result) => result.required && result.status === "failed")?.reason;
}

/** A required end window cannot pass without complete recorded evidence. */
export function scenarioObjectiveFailure(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  startingCustomers = scenario.startingCustomers,
): string | undefined {
  return historyObjectiveResults(scenario, history, {
    completedMonths: scenario.durationMonths,
    startingCustomers,
  }).find(
    (result) =>
      result.required &&
      (result.status === "failed" || result.status === "unverifiable"),
  )?.reason;
}

const definitionsCache = new WeakMap<
  ScenarioType,
  {
    retention: number | undefined;
    duration: number;
    result: CompiledRuleObjective[];
  }
>();
const calendarDefinitions = new WeakMap<
  CompiledRuleObjective[],
  Map<number, CompiledRuleObjective[]>
>();

/** Compiled rules use January calendar offsets; objective evidence counts playable months. */
function playableObjectiveDefinitions(
  definitions: CompiledRuleObjective[],
  openingOffset: number,
): CompiledRuleObjective[] {
  if (!openingOffset) return definitions;
  let offsets = calendarDefinitions.get(definitions);
  if (!offsets) {
    offsets = new Map();
    calendarDefinitions.set(definitions, offsets);
  }
  let playable = offsets.get(openingOffset);
  if (!playable) {
    playable = definitions.map((objective) =>
      "fromMonth" in objective
        ? {
            ...objective,
            fromMonth: objective.fromMonth - openingOffset,
            throughMonth: objective.throughMonth - openingOffset,
          }
        : {
            ...objective,
            deadlineMonth: objective.deadlineMonth - openingOffset,
          },
    );
    offsets.set(openingOffset, playable);
  }
  return playable;
}

/** Trusted setup fields and frozen mod rules enter the same objective evaluator. */
export function scenarioObjectiveDefinitions(
  scenario?: ScenarioType,
  parameters?: Pick<GameType, "difficulty" | "seed"> &
    Partial<Pick<GameType, "campaign" | "customerMarketSize">>,
): CompiledRuleObjective[] {
  if (!scenario || scenario.tutorialSteps) return [];
  if (scenario.id === 116) return UTILITY_EXPANSION_OBJECTIVES;
  const compiled = scenarioRules(scenario, parameters);
  if (compiled && (scenario.id !== 999 || scenario.mod))
    return playableObjectiveDefinitions(
      compiled.objectives,
      (scenario.startingMonth ?? 1) - 1,
    );
  const cached = definitionsCache.get(scenario);
  if (
    cached &&
    cached.retention === scenario.minimumCustomerRetention &&
    cached.duration === scenario.durationMonths
  )
    return cached.result;
  const result: CompiledRuleObjective[] = [];
  if (scenario.minimumCustomerRetention !== undefined)
    result.push({
      id: "retention",
      label: "Retain the community",
      metric: "customerRetention",
      required: true,
      inherited: true,
      deadlineMonth: scenario.durationMonths - 1,
      minRetainedShare: scenario.minimumCustomerRetention,
    });
  definitionsCache.set(scenario, {
    retention: scenario.minimumCustomerRetention,
    duration: scenario.durationMonths,
    result,
  });
  return result;
}

const definitionIdentity = new WeakMap<
  ScenarioType,
  { key: string; definitions: CompiledRuleObjective[]; digest: string }
>();
export function objectiveContextForGame(
  game: Pick<
    GameType,
    "seed" | "startingYear" | "date" | "customerMarketSize"
  > &
    Partial<
      Pick<
        GameType,
        "difficulty" | "utilityExpansion" | "campaign" | "startingMonth"
      >
    >,
  scenario: ScenarioType,
): ObjectiveContext {
  const definitions = scenarioObjectiveDefinitions(scenario, {
    difficulty: game.difficulty ?? "Employee",
    seed: game.seed,
    campaign: game.campaign,
    customerMarketSize: game.customerMarketSize,
  });
  const campaignInputs = game.campaign
    ? [
        game.campaign.generationIndex,
        game.campaign.openingCustomers,
        game.campaign.referenceRate,
        game.campaign.peakMW,
        game.campaign.northCapacityMW,
        game.campaign.debtAllowance,
        game.campaign.goalRateIndex,
        game.campaign.goalCostIndex,
        game.campaign.emissionsBudgetTonnes,
        game.campaign.inheritedDemandMultiplier,
      ]
    : undefined;
  const key = `${game.seed}:${game.startingYear}:${scenario.durationMonths}:${scenario.ownership}:${legacyMonthOffset(game)}:${campaignInputs?.join(",") ?? ""}`;
  let identity = definitionIdentity.get(scenario);
  if (identity?.key !== key || identity.definitions !== definitions) {
    identity = {
      key,
      definitions,
      digest: ruleDigest({
        objectives: definitions,
        seed: game.seed,
        startingYear: game.startingYear,
        ...(isLegacyCampaignScenario(scenario.id)
          ? { moneyBasis: "nominal" }
          : {}),
        ...(game.campaign || legacyMonthOffset(game)
          ? { monthOffset: legacyMonthOffset(game), campaignInputs }
          : {}),
        durationMonths: scenario.durationMonths,
        ownership: scenario.ownership,
      }),
    };
    definitionIdentity.set(scenario, identity);
  }
  return {
    rulesDigest: identity.digest,
    seed: game.seed,
    startingYear: game.startingYear,
    ...(isLegacyCampaignScenario(scenario.id)
      ? { moneyBasis: "nominal" as const }
      : {}),
    ...(game.campaign || legacyMonthOffset(game)
      ? { monthOffset: legacyMonthOffset(game) }
      : {}),
    durationMonths: scenario.durationMonths,
    ownership: scenario.ownership,
    ...(isUtilityExpansionScenario(scenario)
      ? {
          retentionAtDeadlineOnly: true,
          retentionBaselines: Object.fromEntries(
            definitions.flatMap((objective) =>
              objective.metric === "customerRetention"
                ? [
                    [
                      objective.deadlineMonth,
                      expansionRetentionBaseline(
                        game,
                        (objective.deadlineMonth + 1) * MINUTES_PER_MONTH,
                      ),
                    ],
                  ]
                : [],
            ),
          ),
        }
      : {}),
    completedMonths: Math.min(
      scenario.durationMonths,
      legacyCompletedMonths(game),
    ),
    marketSize: customerMarketSizeAt(
      game.customerMarketSize,
      game.date.monthsElapsed * MINUTES_PER_MONTH,
    ),
  };
}

function historyProgress(
  objectives: CompiledRuleObjective[],
  history: readonly MonthlyHistoryType[],
  context: ObjectiveContext,
  startingCustomers: number,
): ObjectiveProgress {
  let progress = createObjectiveProgress(
    objectives,
    context,
    startingCustomers,
  );
  for (const row of [...history].sort(
    (a, b) => absoluteMonth(a.year, a.month) - absoluteMonth(b.year, b.month),
  )) {
    const month =
      absoluteMonth(row.year, row.month) -
      absoluteMonth(context.startingYear, 1) -
      (context.monthOffset ?? 0);
    if (month < 0 || month >= context.completedMonths) continue;
    progress = recordObjectiveMonth(
      progress,
      objectives,
      { month, history: row },
      context,
    );
  }
  return progress;
}

/** Present inherited retention results using the shared verdict. */
function inheritedResultReasons(
  results: ObjectiveResult[],
  scenario: ScenarioType,
  progress: ObjectiveProgress,
  context: ObjectiveContext,
): ObjectiveResult[] {
  return results.map((result) => {
    if (!result.objective.inherited) return result;
    if (
      result.objective.metric === "customerRetention" &&
      result.status === "failed" &&
      result.observed !== undefined
    ) {
      if (context.completedMonths > result.objective.deadlineMonth)
        return {
          ...result,
          reason: `Customer attrition left you with only ${Math.round(result.observed * 100)}% of the customers you started with; this mission requires retaining at least ${Math.round(result.target * 100)}%.`,
        };
      const customers = result.observed * progress.retentionBaseline;
      const bestCase = bestReachableCustomers(
        customers,
        Math.max(
          0,
          result.objective.deadlineMonth + 1 - context.completedMonths,
        ),
        scenario.ownership,
        context.marketSize,
      );
      return {
        ...result,
        reason: `Customer attrition left you with ${formatCount(customers)} customers. Even the fastest possible growth reaches only ${formatCount(bestCase)} by the end of the term, short of the ${formatNumber(Math.ceil(progress.retentionBaseline * result.target))} this mission requires.`,
      };
    }
    return result;
  });
}

function historyObjectiveResults(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  options: {
    completedMonths: number;
    startingCustomers?: number;
    marketSize?: number;
    difficulty?: DifficultyType;
    seed?: number;
    retentionAtBoundary?: boolean;
  },
): ObjectiveResult[] {
  const objectives = scenarioObjectiveDefinitions(scenario, {
    difficulty: options.difficulty ?? "Employee",
    seed: options.seed ?? scenario.seed ?? 0,
  });
  const context: ObjectiveContext = {
    rulesDigest: ruleDigest(objectives),
    startingYear: scenario.startingYear,
    ...((scenario.startingMonth ?? 1) > 1
      ? { monthOffset: (scenario.startingMonth ?? 1) - 1 }
      : {}),
    ...(isLegacyCampaignScenario(scenario.id)
      ? { moneyBasis: "nominal" as const }
      : {}),
    seed: options.seed ?? scenario.seed ?? 0,
    durationMonths: scenario.durationMonths,
    ownership: scenario.ownership,
    ...(isUtilityExpansionScenario(scenario)
      ? { retentionAtDeadlineOnly: true }
      : {}),
    completedMonths: options.completedMonths,
    marketSize: options.marketSize,
  };
  const progress = historyProgress(
    objectives,
    history,
    context,
    options.startingCustomers ?? scenario.startingCustomers ?? 0,
  );
  let results = evaluateScenarioObjectives(objectives, progress, context);
  // This legacy API names the remaining term explicitly. Its latest customer row is the
  // current observation even when a caller supplies a calendar from another test period.
  // Actual game and headless owners always use their persisted, calendar-stamped facts.
  if (
    options.retentionAtBoundary &&
    history.length &&
    context.completedMonths > 0
  ) {
    const retention = objectives.filter(
      (objective) => objective.metric === "customerRetention",
    );
    const month = context.completedMonths - 1;
    const row = {
      ...history[0],
      year: context.startingYear + Math.floor(month / 12),
      month: (month % 12) + 1,
    };
    let current = createObjectiveProgress(
      retention,
      context,
      progress.retentionBaseline,
    );
    current = recordObjectiveMonth(
      current,
      retention,
      { month, history: row },
      context,
    );
    const currentResults = evaluateScenarioObjectives(
      retention,
      current,
      context,
    );
    results = results.map(
      (result) =>
        currentResults.find((current) => current.id === result.id) ?? result,
    );
  }
  return inheritedResultReasons(results, scenario, progress, context);
}

/** The scored term freezes before any optional Keep playing acquisition. */
function objectiveRetentionBaseline(
  game: Pick<GameType, "customerMarketSize"> &
    Partial<Pick<GameType, "utilityExpansion" | "campaign">>,
  scenario: ScenarioType,
): number {
  if (game.campaign) return game.campaign.openingCustomers;
  return isUtilityExpansionScenario(scenario)
    ? expansionRetentionBaseline(
        game,
        scenario.durationMonths * MINUTES_PER_MONTH,
      )
    : (retentionBaseline(scenario, game.customerMarketSize) ??
        game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER);
}

/** Rebase evidence atomically after a purchase; completed-term observations stay final. */
export function rebaseGameRetentionBaseline(
  game: GameType,
  baseline: number,
): void {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (
    !scenario ||
    !game.objectiveProgress ||
    game.date.minute >= scenario.durationMonths * MINUTES_PER_MONTH
  )
    return;
  game.objectiveProgress = rebaseObjectiveRetention(
    game.objectiveProgress,
    scenarioObjectiveDefinitions(scenario, game),
    objectiveContextForGame(game, scenario),
    baseline,
  );
}

const resultCache = new WeakMap<
  ObjectiveProgress,
  {
    completedMonths: number;
    rulesDigest: string;
    acquisitionKey: string;
    results: ObjectiveResult[];
  }
>();
/** Shared recorded evidence; forecast callers extend a copy without changing the live run. */
export function gameObjectiveProgress(
  game: GameType,
): ObjectiveProgress | undefined {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) return undefined;
  return (
    game.objectiveProgress ??
    historyProgress(
      scenarioObjectiveDefinitions(scenario, game),
      game.monthlyHistory,
      objectiveContextForGame(game, scenario),
      objectiveRetentionBaseline(game, scenario),
    )
  );
}

export function gameObjectiveResults(game: GameType): ObjectiveResult[] {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) return [];
  const objectives = scenarioObjectiveDefinitions(scenario, game);
  if (!objectives.length) return [];
  const context = objectiveContextForGame(game, scenario);
  const progress = gameObjectiveProgress(game)!;
  const acquisitionKey =
    game.utilityExpansion?.acquisitions
      .map(({ targetId, minute }) => `${targetId}:${minute}`)
      .join("|") ?? "";
  const cached = resultCache.get(progress);
  if (
    cached?.completedMonths === context.completedMonths &&
    cached.rulesDigest === context.rulesDigest &&
    cached.acquisitionKey === acquisitionKey
  )
    return cached.results;
  const results = inheritedResultReasons(
    evaluateScenarioObjectives(objectives, progress, context),
    scenario,
    progress,
    context,
  ).map((result) => {
    const objective = result.objective;
    // An accepted, irreversible ownership receipt proves this obligation immediately.
    // Month-close observations remain the authoritative deadline evidence.
    if (
      objective.metric !== "utilityOwnership" ||
      context.completedMonths > objective.deadlineMonth
    )
      return result;
    const acquired = game.utilityExpansion?.acquisitions.some(
      (receipt) =>
        objective.targets.includes(receipt.targetId) &&
        receipt.minute < (objective.deadlineMonth + 1) * MINUTES_PER_MONTH,
    );
    if (!acquired) return result;
    const completed: ObjectiveResult = {
      ...result,
      status: "completed",
      observed: 1,
      observedMonths: 1,
    };
    // A proven acquisition clears an earlier explanation. Omit the optional field:
    // own undefined properties are not valid canonical JSON in a saved verdict.
    delete completed.reason;
    return completed;
  });
  // Campaigns lead with their authored historical task, followed by shared safeguards.
  if (game.campaign) {
    const order = new Map(
      objectives.map((objective, index) => [objective.id, index]),
    );
    results.sort((left, right) => order.get(left.id)! - order.get(right.id)!);
  }
  resultCache.set(progress, {
    completedMonths: context.completedMonths,
    rulesDigest: context.rulesDigest,
    acquisitionKey,
    results,
  });
  return results;
}

export function initializeGameObjectiveProgress(game: GameType): void {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  const objectives = scenarioObjectiveDefinitions(scenario, game);
  game.objectiveProgress =
    scenario && objectives.length
      ? createObjectiveProgress(
          objectives,
          objectiveContextForGame(game, scenario),
          isUtilityExpansionGame(game) || game.campaign
            ? objectiveRetentionBaseline(game, scenario)
            : game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER,
        )
      : undefined;
}

/** Paused equipment still belongs to its commissioning cohort; newer replacements do not. */
export function objectiveOwnedVintageFuels(
  game: Pick<GameType, "facilities" | "startingYear">,
  objectives: readonly CompiledRuleObjective[],
): NonNullable<
  import("../data/ScenarioObjectives").ObjectiveMonthFacts["ownedVintageFuels"]
> {
  const seen = new Set<string>();
  return objectives.flatMap((objective) => {
    if (
      objective.metric !== "fuelRetirement" ||
      objective.commissionedBeforeYear === undefined
    )
      return [];
    const key = `${objective.fuel}:${objective.commissionedBeforeYear}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const cutoff =
      (objective.commissionedBeforeYear - game.startingYear) *
      12 *
      MINUTES_PER_MONTH;
    return [
      {
        fuel: objective.fuel,
        commissionedBeforeYear: objective.commissionedBeforeYear,
        count: game.facilities.filter(
          (facility) =>
            facility.fuel === objective.fuel &&
            facility.minuteOperational !== undefined &&
            facility.minuteOperational < cutoff,
        ).length,
      },
    ];
  });
}

export function recordGameObjectiveMonth(
  game: GameType,
  row: MonthlyHistoryType,
): void {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) return;
  const objectives = scenarioObjectiveDefinitions(scenario, game);
  if (!objectives.length) return;
  const context = objectiveContextForGame(game, scenario);
  const month =
    absoluteMonth(row.year, row.month) -
    absoluteMonth(game.startingYear, 1) -
    legacyMonthOffset(game);
  const progress =
    game.objectiveProgress ??
    historyProgress(
      objectives,
      game.monthlyHistory.filter((existing) => existing !== row),
      { ...context, completedMonths: month },
      objectiveRetentionBaseline(game, scenario),
    );
  const needsDebt = objectives.some(
    (objective) => objective.metric === "monthEndDebt",
  );
  const needsFuels = objectives.some(
    (objective) => objective.metric === "fuelRetirement",
  );
  const ownedFuels: Partial<Record<import("../Types").FuelNameType, number>> =
    {};
  if (needsFuels)
    for (const facility of game.facilities)
      if (facility.fuel)
        ownedFuels[facility.fuel] = (ownedFuels[facility.fuel] ?? 0) + 1;
  const ownedVintageFuels = objectiveOwnedVintageFuels(game, objectives);
  game.objectiveProgress = recordObjectiveMonth(
    progress,
    objectives,
    {
      month,
      history: row,
      ...(game.utilityExpansion
        ? {
            ownedUtilities: game.utilityExpansion.acquisitions.map(
              ({ targetId }) => targetId,
            ),
            ownedAssetIds: game.facilities.flatMap((facility) =>
              facility.startingAssetId ? [facility.startingAssetId] : [],
            ),
          }
        : {}),
      ...(needsDebt
        ? {
            debtPrincipal: getTotalDebt([
              ...game.facilities,
              ...(game.transmission?.lines ?? []),
              ...(game.utilityExpansion?.loans ?? []),
            ]),
          }
        : {}),
      ...(needsFuels ? { ownedFuels } : {}),
      ...(ownedVintageFuels.length ? { ownedVintageFuels } : {}),
    },
    context,
  );
}

export function validGameObjectiveProgress(game: GameType): boolean {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) return game.objectiveProgress === undefined;
  const objectives = scenarioObjectiveDefinitions(scenario, game);
  if (!objectives.length) return game.objectiveProgress === undefined;
  if (!game.objectiveProgress) return !scenario.mod && !game.campaign;
  const context = objectiveContextForGame(game, scenario);
  const progress = game.objectiveProgress;
  if (
    progress.retentionBaseline !==
      (isUtilityExpansionGame(game) || game.campaign
        ? objectiveRetentionBaseline(game, scenario)
        : game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER) ||
    !validObjectiveProgress(progress, objectives, context)
  )
    return false;
  if (
    scenario.mod &&
    (isUtilityExpansionGame(game)
      ? game.customerMarketSize -
        (game.utilityExpansion?.acquisitions.reduce(
          (sum, receipt) =>
            sum + UTILITY_AREAS[receipt.targetId].addressablePool,
          0,
        ) ?? 0)
      : game.customerMarketSize) !==
      scenario.mod.parameters.startingCustomers * CUSTOMER_MARKET_MULTIPLIER
  )
    return false;
  if (isUtilityExpansionGame(game)) {
    const expansion = game.utilityExpansion;
    if (!expansion) return false;
    for (const objective of objectives) {
      const evidence = progress.entries.find(
        (entry) => entry.id === objective.id,
      );
      if (objective.metric === "utilityOwnership") {
        for (const [month, numerator, denominator] of evidence?.observations ??
          []) {
          const atClose = expansion.acquisitions.some(
            (acquisition) =>
              objective.targets.includes(acquisition.targetId) &&
              acquisition.minute < (month + 1) * MINUTES_PER_MONTH,
          );
          if (numerator !== Number(atClose) || denominator !== 1) return false;
        }
      }
    }
  }
  const observationsByObjective = new Map(
    progress.entries.map((entry) => [
      entry.id,
      new Map(
        entry.observations.map((observation) => [observation[0], observation]),
      ),
    ]),
  );
  const retainedMonths = new Set<number>();
  for (const row of game.monthlyHistory) {
    const month =
      absoluteMonth(row.year, row.month) -
      absoluteMonth(game.startingYear, 1) -
      legacyMonthOffset(game);
    if (game.campaign && month < 0) continue;
    if (
      month < 0 ||
      month >= legacyCompletedMonths(game) ||
      retainedMonths.has(month)
    )
      return false;
    retainedMonths.add(month);
    if (month >= context.completedMonths) continue;
    for (const objective of objectives) {
      // Monthly rows do not retain historical ownership or principal. These facts have
      // their own recorded observations; never infer them from today's fleet.
      if (
        objective.metric === "monthEndDebt" ||
        objective.metric === "fuelRetirement" ||
        objective.metric === "utilityOwnership" ||
        objective.metric === "assetRetirement"
      )
        continue;
      const first =
        objective.metric === "customerRetention"
          ? context.retentionAtDeadlineOnly
            ? objective.deadlineMonth
            : 0
          : objective.metric === "customerCount"
            ? 0
            : objective.fromMonth;
      const last =
        "deadlineMonth" in objective
          ? objective.deadlineMonth
          : objective.throughMonth;
      if (month < first || month > last) continue;
      const observation = observationsByObjective.get(objective.id)?.get(month);
      if (
        !observation ||
        canonicalRuleJson(observation) !==
          canonicalRuleJson(
            objectiveMonthObservation(
              objective,
              { month, history: row },
              context,
              progress.retentionBaseline,
            ),
          )
      )
        return false;
    }
  }
  return true;
}

export interface RunFailureType {
  outcome: "bankrupt" | "fired";
  title: string;
  reason?: string;
}
/**
 * Whether a company's run ends at this month rollover: out of cash, three months of chronic
 * blackouts, or a missed objective (judged in full at term end, before that only once already
 * decided). Pure, so the co-op host can judge every company without the single-player effects.
 */
export function runFailure(
  game: Pick<GameType, "difficulty" | "customerMarketSize" | "date"> &
    Partial<
      Pick<
        GameType,
        | "seed"
        | "startingYear"
        | "startingMonth"
        | "objectiveProgress"
        | "utilityExpansion"
        | "scenarioId"
        | "customScenario"
        | "monthlyHistory"
        | "campaign"
      >
    >,
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  now: Pick<TickPresentFutureType, "cash" | "minute">,
  isTutorial: boolean,
): RunFailureType | undefined {
  const termMonths = scenario.durationMonths || 12 * 20;
  const context = objectiveContextForGame(
    {
      difficulty: game.difficulty,
      seed: game.seed ?? scenario.seed ?? 0,
      startingYear: game.startingYear ?? scenario.startingYear,
      startingMonth: game.startingMonth ?? scenario.startingMonth,
      date: game.date,
      customerMarketSize: game.customerMarketSize,
      utilityExpansion: game.utilityExpansion,
      campaign: game.campaign,
    },
    scenario,
  );
  // The exact current accounting frame only supplies solvency; objectives consume completed facts.
  const objectives = scenarioObjectiveDefinitions(scenario, {
    difficulty: game.difficulty,
    seed: game.seed ?? scenario.seed ?? 0,
    campaign: game.campaign,
    customerMarketSize: game.customerMarketSize,
  });
  const progress =
    game.objectiveProgress ??
    historyProgress(
      objectives,
      history,
      context,
      objectiveRetentionBaseline(game, scenario),
    );
  const results = inheritedResultReasons(
    evaluateScenarioObjectives(objectives, progress, context),
    scenario,
    progress,
    context,
  );
  const objectiveFailure =
    !isTutorial &&
    results.find(
      (result) =>
        result.required &&
        (result.status === "failed" ||
          (legacyCompletedMonths(game) >= termMonths &&
            result.status === "unverifiable")),
    )?.reason;
  if (now.cash < 0) return { outcome: "bankrupt", title: "Bankrupt!" };
  if (
    !scenario.reliabilityFailureDisabled &&
    hasChronicBlackouts(history, game.difficulty)
  )
    return {
      outcome: "fired",
      title: "Fired!",
      reason: `You served less than ${formatRequiredShare(reliabilityThreshold(game.difficulty))} of demand for 3 months in a row, so the utility board ended your term.`,
    };
  if (objectiveFailure)
    return {
      outcome: "fired",
      title: "Mission objective missed",
      reason: objectiveFailure,
    };
  return undefined;
}

/** Archived CEO verdicts are recomputed, never accepted as claimed completion badges. */
export function validLegacyCampaignEvidence(game: GameType): boolean {
  if (!game.campaign) return true;
  for (const term of game.campaign.completedTerms) {
    const termStartMonth = term.generationIndex * 240;
    const monthsElapsed = termStartMonth + 240;
    const termGame: GameType = {
      ...game,
      scenarioId: term.scenarioId,
      campaign: { ...game.campaign, ...term, termStartMonth },
      date: {
        ...game.date,
        minute: monthsElapsed * MINUTES_PER_MONTH,
        monthsElapsed,
      },
      objectiveProgress: term.objectiveProgress,
      monthlyHistory: [],
    };
    if (
      !validGameObjectiveProgress(termGame) ||
      canonicalRuleJson(gameObjectiveResults(termGame)) !==
        canonicalRuleJson(term.objectiveResults) ||
      canonicalRuleJson(term.debrief.objectiveResults) !==
        canonicalRuleJson(term.objectiveResults)
    )
      return false;
  }
  return true;
}
