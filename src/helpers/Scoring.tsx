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

/**
 * The points a year of sales at `rate` contributes to a public utility's lifetime rate score.
 *
 * The final score decomposes exactly as a supply-weighted sum over the years played, and this is
 * one term of that sum: `PUBLIC_RATE_POINTS_PER_CENT * 100 * (target - rate) * share`, where
 * `share` is how much of the lifetime energy the coming year makes up. Two properties follow:
 *
 * - The sign is always the sign of `target - rate`. A rate above target reads as a loss every
 *   year it is in force, no matter what the lifetime average did last period, which is what the
 *   change-based figure below got wrong.
 * - The magnitude shrinks as the record lengthens: a year of sales still matters, but less, the
 *   more has already been sold.
 *
 * The end-of-run score itself is judged on the lifetime average and is untouched by this; this
 * is the display's term for the year the player is choosing a rate for.
 */
export function publicRateYearContribution(
  targetRate: number,
  past: Pick<MonthlyHistoryType, "supplyWh">,
  next: Pick<MonthlyHistoryType, "supplyWh">,
  rate: number,
): number {
  const lifetimeWh = past.supplyWh + next.supplyWh;
  if (lifetimeWh <= 0) {
    // Nothing sold means no rate to judge, so the category stays neutral
    return 0;
  }
  const share = next.supplyWh / lifetimeWh;
  return Math.round(
    PUBLIC_RATE_POINTS_PER_CENT * 100 * (targetRate - rate) * share,
  );
}

export function totalScore(breakdown: ScoreBreakdownType): number {
  return Object.values(breakdown).reduce((a, b) => a + b, 0);
}
