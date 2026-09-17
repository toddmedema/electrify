import {
  DifficultyType,
  MeaningfulDecisionType,
  MonthlyHistoryType,
  ScenarioType,
} from "../Types";
import {
  CEO_MEANINGFUL_CATEGORIES_REQUIRED,
  CEO_MEANINGFUL_DECISIONS_REQUIRED,
  INTERN_MEANINGFUL_DECISIONS_REQUIRED,
  meaningfulDecisionCategoryCount,
} from "./MeaningfulDecisions";

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

/** A scenario-specific end gate, kept pure so headless QA and the live game agree exactly. */
export function scenarioObjectiveFailure(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  difficulty?: DifficultyType,
  meaningfulDecisions: MeaningfulDecisionType[] = [],
  decisionGateWaived = false,
): string | undefined {
  const reliabilityObjective = scenario.reliabilityObjective;
  if (reliabilityObjective) {
    const targets = reliabilityMonths(scenario, history);
    for (const target of targets) {
      const served = demandServed(target);
      if (served < reliabilityObjective.minimumDemandServed) {
        return `You served ${(served * 100).toFixed(2)}% of demand during the ${reliabilityObjective.label}; this mission requires ${Math.round(reliabilityObjective.minimumDemandServed * 100)}%.`;
      }
    }
  }

  if (
    scenario.minimumCustomerRetention !== undefined &&
    scenario.startingCustomers !== undefined &&
    history.length > 0
  ) {
    const retained = history[0].customers / scenario.startingCustomers;
    if (retained < scenario.minimumCustomerRetention) {
      return `Customer attrition left you with only ${Math.round(retained * 100)}% of the community you started with; this mission requires retaining at least ${Math.round(scenario.minimumCustomerRetention * 100)}%.`;
    }
  }
  if (!scenario.tutorialSteps && !decisionGateWaived) {
    if (
      difficulty === "Intern" &&
      meaningfulDecisions.length < INTERN_MEANINGFUL_DECISIONS_REQUIRED
    ) {
      return "Make at least one meaningful decision that changes the grid or its economics.";
    }
    if (
      difficulty === "CEO" &&
      (meaningfulDecisions.length < CEO_MEANINGFUL_DECISIONS_REQUIRED ||
        meaningfulDecisionCategoryCount(meaningfulDecisions) <
          CEO_MEANINGFUL_CATEGORIES_REQUIRED)
    ) {
      return `You made ${meaningfulDecisions.length} of ${CEO_MEANINGFUL_DECISIONS_REQUIRED} meaningful decisions across ${meaningfulDecisionCategoryCount(meaningfulDecisions)} of ${CEO_MEANINGFUL_CATEGORIES_REQUIRED} decision types; CEO difficulty requires a varied operating plan.`;
    }
  }
  return undefined;
}
