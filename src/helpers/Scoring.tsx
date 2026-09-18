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
  // A public utility that fails before supplying any electricity still needs a valid final score.
  // Its effective rate is unknowable, so leave that category neutral instead of dividing 0 / 0
  // and sending NaN to the score screen and Firestore.
  const effectiveRate = lifetimeRate(summary, scenario.dollarsPerkWh);
  return scenario.ownership === "Investor"
    ? {
        supply: Math.round(summary.supplyWh / 1000000000000),
        netWorth: Math.round((40 * summary.netWorth) / 1000000000),
        customers: Math.round((2 * summary.customers) / 100000),
        emissions: Math.round((-2 * summary.kgco2e) / 1000000000),
        blackouts: Math.round(-8 * blackoutsTWh),
      }
    : {
        rate: publicRateScore(scenario.dollarsPerkWh, effectiveRate),
        supply: Math.round((10 * summary.supplyWh) / 1000000000000),
        emissions: Math.round((-5 * summary.kgco2e) / 1000000000),
        blackouts: Math.round(-10 * blackoutsTWh),
      };
}

// A public utility earns this many points for each cent per kWh its lifetime average rate sits
// below the scenario's target, and loses the same above it.
export const PUBLIC_RATE_POINTS_PER_CENT = 80;

/** The rate category of a public utility's score, for a lifetime average `rate` in $/kWh. */
export function publicRateScore(targetRate: number, rate: number): number {
  return Math.round(PUBLIC_RATE_POINTS_PER_CENT * 100 * (targetRate - rate));
}

// Revenue per kWh supplied, or the target when nothing has been supplied yet, which leaves the
// rate category neutral instead of dividing 0 / 0
function lifetimeRate(
  totals: Pick<MonthlyHistoryType, "revenue" | "supplyWh">,
  targetRate: number,
): number {
  return totals.supplyWh > 0
    ? totals.revenue / (totals.supplyWh / 1000)
    : targetRate;
}

/**
 * How much a public utility's rate score moves over a stretch of play. The score is judged on the
 * lifetime average rate, so a period's effect depends on how much has already been sold: the
 * same rate moves a young run's score further than an old one's.
 */
export function publicRateScoreChange(
  targetRate: number,
  past: Pick<MonthlyHistoryType, "revenue" | "supplyWh">,
  next: Pick<MonthlyHistoryType, "revenue" | "supplyWh">,
): number {
  const before = publicRateScore(targetRate, lifetimeRate(past, targetRate));
  const after = publicRateScore(
    targetRate,
    lifetimeRate(
      {
        revenue: past.revenue + next.revenue,
        supplyWh: past.supplyWh + next.supplyWh,
      },
      targetRate,
    ),
  );
  return after - before;
}

export function totalScore(breakdown: ScoreBreakdownType): number {
  return Object.values(breakdown).reduce((a, b) => a + b, 0);
}
