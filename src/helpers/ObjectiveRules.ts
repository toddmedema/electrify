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
} from "./ScenarioObjectives";
export { objectiveDefinition } from "./ScenarioObjectives";

export const absoluteMonth = (year: number, month: number): number =>
  year * 12 + month - 1;
export const demandServed = (month: MonthlyHistoryType): number =>
  month.demandWh > 0 ? month.supplyWh / month.demandWh : 1;
export function reliabilityMonths(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
): MonthlyHistoryType[] {
  const objective = scenario.reliabilityObjective;
  if (!objective) return [];
  const first = absoluteMonth(objective.year, objective.month);
  return history.filter(
    (month) =>
      absoluteMonth(month.year, month.month) >= first &&
      absoluteMonth(month.year, month.month) <
        first + (objective.durationMonths || 1),
  );
}
/** The same three completed-month firing rule used by the game and headless playtests. */
export const blackoutFiringThreshold = (difficulty: DifficultyType): number =>
  difficulty === "CEO" ? 0.95 : 0.9;

export function hasChronicBlackouts(
  history: MonthlyHistoryType[],
  difficulty: DifficultyType,
): boolean {
  return (
    history.length >= 3 &&
    history
      .slice(0, 3)
      .every(
        (month) =>
          month.supplyWh < month.demandWh * blackoutFiringThreshold(difficulty),
      )
  );
}

/** A required share as a percentage, keeping one decimal only when it has one (99.5%, 100%). */
export function formatRequiredShare(fraction: number): string {
  const percent = Math.round(fraction * 1000) / 10;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/** The reliability objective's verdict on the completed months it has seen so far. */
export function reliabilityFailure(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
): string | undefined {
  const result = historyObjectiveResults(scenario, history, {
    completedMonths: latestCompletedMonth(scenario, history),
  }).find(
    (result) =>
      result.metric === "monthlyReliability" && result.status === "failed",
  );
  return result?.reason;
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
 * A scenario objective that is already decided before the term ends. A reliability month that
 * fell short can never be un-missed, and customers that cannot grow back in the time left will
 * not be there at the end, so the run ends now instead of asking the player to fast-forward
 * through years with nothing at stake. Customer retention is otherwise evaluated at term end.
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
    rules: ReturnType<typeof scenarioRules>;
    reliability: ScenarioType["reliabilityObjective"];
    retention: number | undefined;
    duration: number;
    startingYear: number;
    result: CompiledRuleObjective[];
  }
>();
/** Trusted setup fields and frozen mod rules enter the same objective evaluator. */
export function scenarioObjectiveDefinitions(
  scenario?: ScenarioType,
): CompiledRuleObjective[] {
  if (!scenario || scenario.tutorialSteps) return [];
  const compiled = scenarioRules(scenario);
  if (compiled) return compiled.objectives;
  const cached = definitionsCache.get(scenario);
  if (
    cached &&
    cached.reliability === scenario.reliabilityObjective &&
    cached.retention === scenario.minimumCustomerRetention &&
    cached.duration === scenario.durationMonths &&
    cached.startingYear === scenario.startingYear
  )
    return cached.result;
  const result: CompiledRuleObjective[] = [];
  const reliability = scenario.reliabilityObjective;
  if (reliability) {
    const fromMonth =
      absoluteMonth(reliability.year, reliability.month) -
      absoluteMonth(scenario.startingYear, 1);
    result.push({
      id: "reliability",
      label: reliability.goal ?? `Serve demand during the ${reliability.label}`,
      metric: "monthlyReliability",
      required: true,
      inherited: true,
      fromMonth,
      throughMonth: fromMonth + (reliability.durationMonths || 1) - 1,
      minDemandServedShare: reliability.minimumDemandServed,
    });
  }
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
    rules: compiled,
    reliability: scenario.reliabilityObjective,
    retention: scenario.minimumCustomerRetention,
    duration: scenario.durationMonths,
    startingYear: scenario.startingYear,
    result,
  });
  return result;
}

function latestCompletedMonth(
  scenario: ScenarioType,
  history: readonly MonthlyHistoryType[],
): number {
  return Math.max(
    0,
    ...history.map(
      (row) =>
        absoluteMonth(row.year, row.month) -
        absoluteMonth(scenario.startingYear, 1) +
        1,
    ),
  );
}

const definitionIdentity = new WeakMap<
  ScenarioType,
  { key: string; definitions: CompiledRuleObjective[]; digest: string }
>();
export function objectiveContextForGame(
  game: Pick<GameType, "seed" | "startingYear" | "date" | "customerMarketSize">,
  scenario: ScenarioType,
): ObjectiveContext {
  const definitions = scenarioObjectiveDefinitions(scenario);
  const key = `${game.seed}:${game.startingYear}:${scenario.durationMonths}:${scenario.ownership}`;
  let identity = definitionIdentity.get(scenario);
  if (identity?.key !== key || identity.definitions !== definitions) {
    identity = {
      key,
      definitions,
      digest: ruleDigest({
        objectives: definitions,
        seed: game.seed,
        startingYear: game.startingYear,
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
    durationMonths: scenario.durationMonths,
    ownership: scenario.ownership,
    completedMonths: Math.min(scenario.durationMonths, game.date.monthsElapsed),
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
      absoluteMonth(context.startingYear, 1);
    if (month >= context.completedMonths) continue;
    progress = recordObjectiveMonth(
      progress,
      objectives,
      { month, history: row },
      context,
    );
  }
  return progress;
}

/** Legacy phrasing is presentation of the shared verdict, never a second pass/fail calculation. */
function inheritedResultReasons(
  results: ObjectiveResult[],
  scenario: ScenarioType,
  progress: ObjectiveProgress,
  context: ObjectiveContext,
): ObjectiveResult[] {
  return results.map((result) => {
    if (!result.objective.inherited) return result;
    const objective = scenario.reliabilityObjective;
    if (result.objective.metric === "monthlyReliability" && objective) {
      if (result.status === "failed") {
        const failed = progress.entries
          .find((entry) => entry.id === result.id)
          ?.observations.slice()
          .reverse()
          .find(
            ([, numerator, denominator]) =>
              numerator !== null &&
              denominator !== null &&
              denominator > 0 &&
              numerator / denominator < objective.minimumDemandServed,
          );
        const served =
          failed && failed[1] !== null && failed[2]
            ? failed[1] / failed[2]
            : result.observed;
        if (served !== undefined)
          return {
            ...result,
            reason: `You served ${(Math.floor(served * 10000) / 100).toFixed(2)}% of demand during the ${objective.label}; this mission requires ${formatRequiredShare(objective.minimumDemandServed)}.`,
          };
      }
      if (
        result.status === "unverifiable" &&
        context.completedMonths > result.objective.throughMonth
      ) {
        const required = objective.durationMonths || 1;
        return {
          ...result,
          reason: `The ${objective.label} is unverifiable: exactly one completed record is required for each of its ${required} months (${objective.month}/${objective.year} through ${((objective.month - 1 + required - 1) % 12) + 1}/${objective.year + Math.floor((objective.month - 1 + required - 1) / 12)}).`,
        };
      }
    }
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
        reason: `Customer attrition left you with ${Math.round(customers).toLocaleString("en-US")} customers. Even the fastest possible growth reaches only ${Math.round(bestCase).toLocaleString("en-US")} by the end of the term, short of the ${Math.ceil(progress.retentionBaseline * result.target).toLocaleString("en-US")} this mission requires.`,
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
    seed?: number;
    retentionAtBoundary?: boolean;
  },
): ObjectiveResult[] {
  const objectives = scenarioObjectiveDefinitions(scenario);
  const context: ObjectiveContext = {
    rulesDigest: ruleDigest(objectives),
    startingYear: scenario.startingYear,
    seed: options.seed ?? scenario.seed ?? 0,
    durationMonths: scenario.durationMonths,
    ownership: scenario.ownership,
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

const resultCache = new WeakMap<
  ObjectiveProgress,
  { completedMonths: number; results: ObjectiveResult[] }
>();
export function gameObjectiveResults(game: GameType): ObjectiveResult[] {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) return [];
  const objectives = scenarioObjectiveDefinitions(scenario);
  if (!objectives.length) return [];
  const context = objectiveContextForGame(game, scenario);
  const progress =
    game.objectiveProgress ??
    historyProgress(
      objectives,
      game.monthlyHistory,
      context,
      retentionBaseline(scenario, game.customerMarketSize) ??
        game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER,
    );
  const cached = resultCache.get(progress);
  if (cached?.completedMonths === context.completedMonths)
    return cached.results;
  const results = inheritedResultReasons(
    evaluateScenarioObjectives(objectives, progress, context),
    scenario,
    progress,
    context,
  );
  resultCache.set(progress, {
    completedMonths: context.completedMonths,
    results,
  });
  return results;
}

export function initializeGameObjectiveProgress(game: GameType): void {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  const objectives = scenarioObjectiveDefinitions(scenario);
  game.objectiveProgress =
    scenario && objectives.length
      ? createObjectiveProgress(
          objectives,
          objectiveContextForGame(game, scenario),
          game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER,
        )
      : undefined;
}

export function recordGameObjectiveMonth(
  game: GameType,
  row: MonthlyHistoryType,
): void {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) return;
  const objectives = scenarioObjectiveDefinitions(scenario);
  if (!objectives.length) return;
  const context = objectiveContextForGame(game, scenario);
  const month =
    absoluteMonth(row.year, row.month) - absoluteMonth(game.startingYear, 1);
  const progress =
    game.objectiveProgress ??
    historyProgress(
      objectives,
      game.monthlyHistory.filter((existing) => existing !== row),
      { ...context, completedMonths: month },
      retentionBaseline(scenario, game.customerMarketSize) ??
        game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER,
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
  game.objectiveProgress = recordObjectiveMonth(
    progress,
    objectives,
    {
      month,
      history: row,
      ...(needsDebt
        ? {
            debtPrincipal: getTotalDebt([
              ...game.facilities,
              ...(game.transmission?.lines ?? []),
            ]),
          }
        : {}),
      ...(needsFuels ? { ownedFuels } : {}),
    },
    context,
  );
}

export function validGameObjectiveProgress(game: GameType): boolean {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) return game.objectiveProgress === undefined;
  const objectives = scenarioObjectiveDefinitions(scenario);
  if (!objectives.length) return game.objectiveProgress === undefined;
  if (!game.objectiveProgress) return !scenario.mod;
  const context = objectiveContextForGame(game, scenario);
  const progress = game.objectiveProgress;
  if (
    progress.retentionBaseline !==
      game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER ||
    !validObjectiveProgress(progress, objectives, context)
  )
    return false;
  if (
    scenario.mod &&
    game.customerMarketSize !==
      scenario.mod.parameters.startingCustomers * CUSTOMER_MARKET_MULTIPLIER
  )
    return false;
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
      absoluteMonth(row.year, row.month) - absoluteMonth(game.startingYear, 1);
    if (
      month < 0 ||
      month >= game.date.monthsElapsed ||
      retainedMonths.has(month)
    )
      return false;
    retainedMonths.add(month);
    if (month >= context.completedMonths) continue;
    for (const objective of objectives) {
      // These two facts are deliberately retained separately because older monthly rows do
      // not contain historical ownership or principal. Never infer them from today's fleet.
      if (
        objective.metric === "monthEndDebt" ||
        objective.metric === "fuelRetirement"
      )
        continue;
      const first =
        objective.metric === "customerRetention" ? 0 : objective.fromMonth;
      const last =
        objective.metric === "customerRetention"
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
        | "objectiveProgress"
        | "scenarioId"
        | "customScenario"
        | "monthlyHistory"
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
      seed: game.seed ?? scenario.seed ?? 0,
      startingYear: game.startingYear ?? scenario.startingYear,
      date: game.date,
      customerMarketSize: game.customerMarketSize,
    },
    scenario,
  );
  // The exact current accounting frame only supplies solvency; objectives consume completed facts.
  const objectives = scenarioObjectiveDefinitions(scenario);
  const progress =
    game.objectiveProgress ??
    historyProgress(
      objectives,
      history,
      context,
      retentionBaseline(scenario, game.customerMarketSize) ??
        game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER,
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
          (game.date.monthsElapsed >= termMonths &&
            result.status === "unverifiable")),
    )?.reason;
  if (now.cash < 0) return { outcome: "bankrupt", title: "Bankrupt!" };
  if (hasChronicBlackouts(history, game.difficulty))
    return {
      outcome: "fired",
      title: "Fired!",
      reason:
        "Blackouts continued for 3 months, so the utility board ended your term.",
    };
  if (objectiveFailure)
    return {
      outcome: "fired",
      title: "Mission objective missed",
      reason: objectiveFailure,
    };
  return undefined;
}
