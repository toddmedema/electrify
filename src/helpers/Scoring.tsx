import { MonthlyHistoryType, ScenarioType, ScoreBreakdownType } from "../Types";

/**
 * The end-of-run scoring formula, factored out so the reducer and any UI that wants to show a
 * score (final or in-progress) call the same code. This is also described in the manual and in
 * VictoryConditions -- if the algorithm changes, update those too.
 */
export function computeScoreBreakdown(
  scenario: ScenarioType,
  summary: MonthlyHistoryType,
): ScoreBreakdownType {
  const blackoutsTWh =
    Math.max(0, summary.demandWh - summary.supplyWh) / 1000000000000;
  return scenario.ownership === "Investor"
    ? {
        supply: Math.round(summary.supplyWh / 1000000000000),
        netWorth: Math.round((40 * summary.netWorth) / 1000000000),
        customers: Math.round((2 * summary.customers) / 100000),
        emissions: Math.round((-2 * summary.kgco2e) / 1000000000),
        blackouts: Math.round(-8 * blackoutsTWh),
      }
    : {
        rate: Math.round(
          80 *
            100 *
            (scenario.dollarsPerkWh -
              summary.revenue / (summary.supplyWh / 1000)),
        ),
        supply: Math.round((10 * summary.supplyWh) / 1000000000000),
        emissions: Math.round((-5 * summary.kgco2e) / 1000000000),
        blackouts: Math.round(-10 * blackoutsTWh),
      };
}

export function totalScore(breakdown: ScoreBreakdownType): number {
  return Object.values(breakdown).reduce((a, b) => a + b, 0);
}
