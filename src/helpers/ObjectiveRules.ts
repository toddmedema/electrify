import {
  DifficultyType,
  MeaningfulDecisionType,
  MonthlyHistoryType,
  ScenarioType,
} from "../Types";
import {
  meaningfulDecisionCategoryCount,
  meaningfulDecisionRequirement,
} from "./MeaningfulDecisions";
import { DIFFICULTY_LABELS } from "../Constants";
import {
  bestReachableCustomers,
  CUSTOMER_MARKET_MULTIPLIER,
} from "./Customers";

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
export function hasChronicBlackouts(history: MonthlyHistoryType[]): boolean {
  return (
    history.length >= 3 &&
    history.slice(0, 3).every((month) => month.supplyWh < month.demandWh * 0.9)
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
  const reliabilityObjective = scenario.reliabilityObjective;
  if (!reliabilityObjective) return undefined;
  for (const target of reliabilityMonths(scenario, history)) {
    const served = demandServed(target);
    if (served < reliabilityObjective.minimumDemandServed) {
      // Floored to two decimals rather than rounded: the objective can require exactly 100%,
      // and a month that fell a hair short (99.996%) would round up to a whole "100.00%"
      // sitting right next to "this mission requires 100%" -- an explanation that argues
      // with itself. Two decimals are kept because precision is the point of this sentence.
      return `You served ${(Math.floor(served * 10000) / 100).toFixed(2)}% of demand during the ${reliabilityObjective.label}; this mission requires ${formatRequiredShare(reliabilityObjective.minimumDemandServed)}.`;
    }
  }
  return undefined;
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
 * through years with nothing at stake. Term-end-only rules (the decision gate) are not here.
 */
export function decidedObjectiveFailure(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  progress: ObjectiveProgressType,
): string | undefined {
  const reliability = reliabilityFailure(scenario, history);
  if (reliability) return reliability;
  if (history.length === 0) return undefined;
  const unreachable = retentionUnreachable(
    scenario,
    history[0].customers,
    progress,
  );
  if (unreachable) {
    return `Customer attrition left you with ${Math.round(history[0].customers).toLocaleString("en-US")} customers. Even the fastest possible growth reaches only ${Math.round(unreachable.bestCase).toLocaleString("en-US")} by the end of the term, short of the ${Math.ceil(unreachable.threshold).toLocaleString("en-US")} this mission requires.`;
  }
  return undefined;
}

/** A scenario-specific end gate, kept pure so headless QA and the live game agree exactly. */
export function scenarioObjectiveFailure(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  difficulty?: DifficultyType,
  meaningfulDecisions: MeaningfulDecisionType[] = [],
  decisionGateWaived = false,
  startingCustomers = scenario.startingCustomers,
): string | undefined {
  const reliability = reliabilityFailure(scenario, history);
  if (reliability) return reliability;

  if (
    scenario.minimumCustomerRetention !== undefined &&
    startingCustomers !== undefined &&
    history.length > 0
  ) {
    const retained = history[0].customers / startingCustomers;
    if (retained < scenario.minimumCustomerRetention) {
      return `Customer attrition left you with only ${Math.round(retained * 100)}% of the customers you started with; this mission requires retaining at least ${Math.round(scenario.minimumCustomerRetention * 100)}%.`;
    }
  }
  if (
    scenario.requiresGridInvestment &&
    !meaningfulDecisions.some((d) => d.kind === "asset")
  ) {
    return "Build or upgrade the grid; changing prices alone does not fulfill this mission.";
  }
  const gate = difficulty && meaningfulDecisionRequirement(difficulty);
  if (!scenario.tutorialSteps && !decisionGateWaived && gate) {
    const categories = meaningfulDecisionCategoryCount(meaningfulDecisions);
    if (
      meaningfulDecisions.length < gate.count ||
      categories < gate.categories
    ) {
      if (gate.count === 1) {
        return "Make at least one meaningful decision that changes the grid or its economics.";
      }
      return `You made ${meaningfulDecisions.length} of ${gate.count} meaningful decisions across ${categories} of ${gate.categories} decision ${gate.categories === 1 ? "type" : "types"}; ${DIFFICULTY_LABELS[difficulty!] ?? difficulty} difficulty requires ${gate.categories > 1 ? "a varied" : "an active"} operating plan.`;
    }
  }
  return undefined;
}
