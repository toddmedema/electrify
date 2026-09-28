import { getInflationIndex } from "../data/Economy";
import {
  MonthlyHistoryType,
  ScenarioType,
  ScoreBreakdownType,
  ScoreCategoryType,
} from "../Types";

// What each scored category is called on the score screen, in lower case to sit mid-sentence
export const SCORE_LABELS: Record<ScoreCategoryType, string> = {
  supply: "electricity supplied",
  netWorth: "final net worth",
  customers: "final customers",
  rate: "electric rates",
  emissions: "emissions",
  blackouts: "blackouts",
};

/**
 * The label for a breakdown key. Breakdowns can arrive from saves, replays and the leaderboard,
 * so an unrecognised key falls back to itself instead of rendering blank.
 */
export function scoreLabel(category: string): string {
  return (SCORE_LABELS as Record<string, string>)[category] || category;
}

interface ScoreInputsType {
  summary: MonthlyHistoryType;
  blackoutsTWh: number;
  targetRate: number;
  effectiveRate: number;
}

interface ScoreTextContextType {
  dollarsPerkWh: number;
  // The emissions unit the player reads in, such as "1 megatonne"
  perEmissions: string;
}

interface ScoreRuleType {
  category: ScoreCategoryType;
  // Points per `per` units of `measure`; negative for a penalty
  points: number;
  per: number;
  measure: (inputs: ScoreInputsType) => number;
  // A category whose points aren't a straight `points * measure / per`
  score?: (inputs: ScoreInputsType) => number;
  text: (context: ScoreTextContextType, rule: ScoreRuleType) => string;
}

function pointsText(points: number): string {
  const magnitude = Math.abs(points);
  return `${magnitude} point${magnitude === 1 ? "" : "s"}`;
}

function earnOrLose(rule: ScoreRuleType): string {
  return `${rule.points < 0 ? "Lose" : "Earn"} ${pointsText(rule.points)}`;
}

const TWH = 1e12;
const BILLION = 1e9;

function supplyRule(points: number): ScoreRuleType {
  return {
    category: "supply",
    points,
    per: TWH,
    measure: ({ summary }) => summary.supplyWh,
    text: (_context, rule) =>
      `${earnOrLose(rule)} per terawatt-hour (TWh) of electricity supplied.`,
  };
}

function emissionsRule(points: number): ScoreRuleType {
  return {
    category: "emissions",
    points,
    per: BILLION,
    measure: ({ summary }) => summary.kgco2e,
    text: ({ perEmissions }, rule) =>
      `${earnOrLose(rule)} per ${perEmissions} of greenhouse gas emissions.`,
  };
}

function blackoutsRule(points: number): ScoreRuleType {
  return {
    category: "blackouts",
    points,
    per: 1,
    measure: ({ blackoutsTWh }) => blackoutsTWh,
    text: (_context, rule) =>
      `${earnOrLose(rule)} per TWh of customer demand not served.`,
  };
}

// A public utility earns this many points for each cent per kWh its lifetime average rate sits
// below the scenario's target, in starting-year dollars, and loses the same above it.
export const PUBLIC_RATE_POINTS_PER_CENT = 80;

/**
 * Every scored category for each ownership model, in the order the score screen lists them. The
 * formula in `computeScoreBreakdown` and the rule text players read are both generated from this
 * table, so the two can't drift apart.
 */
export const SCORE_RULES: Record<ScenarioType["ownership"], ScoreRuleType[]> = {
  Investor: [
    supplyRule(1),
    {
      category: "netWorth",
      points: 40,
      per: BILLION,
      measure: ({ summary }) => summary.netWorth,
      text: (_context, rule) =>
        `${earnOrLose(rule)} per $1 billion of net worth at the end.`,
    },
    {
      category: "customers",
      points: 2,
      per: 100000,
      measure: ({ summary }) => summary.customers,
      text: (_context, rule) =>
        `${earnOrLose(rule)} per 100,000 customers at the end.`,
    },
    emissionsRule(-2),
    blackoutsRule(-8),
  ],
  Public: [
    {
      category: "rate",
      points: PUBLIC_RATE_POINTS_PER_CENT,
      per: 0.01,
      measure: ({ targetRate, effectiveRate }) => targetRate - effectiveRate,
      score: ({ targetRate, effectiveRate }) =>
        publicRateScore(targetRate, effectiveRate),
      text: ({ dollarsPerkWh }, rule) =>
        `Earn ${pointsText(rule.points)} for each $0.01/kWh your lifetime average rate is below the $${dollarsPerkWh}/kWh target. Lose ${pointsText(rule.points)} for each $0.01/kWh it is above. The target is in the starting year's dollars and rises with inflation.`,
    },
    supplyRule(10),
    emissionsRule(-5),
    blackoutsRule(-10),
  ],
};

// The rules read as a list lead with what the player is chasing, which isn't the scoring order
const RULE_TEXT_ORDER: ScoreCategoryType[] = [
  "rate",
  "netWorth",
  "customers",
  "supply",
  "emissions",
  "blackouts",
];

/** The point rule behind each score category, in the player's terms. */
export function scoreRuleText(
  ownership: ScenarioType["ownership"],
  dollarsPerkWh: number,
  perEmissions: string,
): ScoreBreakdownText {
  const text: ScoreBreakdownText = {};
  for (const category of RULE_TEXT_ORDER) {
    const rule = SCORE_RULES[ownership].find((r) => r.category === category);
    if (rule) {
      text[category] = rule.text({ dollarsPerkWh, perEmissions }, rule);
    }
  }
  return text;
}

export type ScoreBreakdownText = Partial<Record<ScoreCategoryType, string>>;

/**
 * The end-of-run scoring formula, factored out so the reducer and any UI that wants to show a
 * score (final or in-progress) call the same code. The rules come from `SCORE_RULES`, which also
 * writes the in-game description; the manual describes them separately and needs updating by hand.
 *
 * `revenueInStartingDollars` is the run's revenue in its starting year's dollars, from
 * `startingDollarRevenue` below. A public utility's target rate is authored in those dollars, and
 * judging nominal revenue against it would charge the player for inflation their costs already
 * pass through: over twenty years of 2.5% inflation, a rate that merely holds its real value ends
 * about 60% above the target.
 */
export function computeScoreBreakdown(
  scenario: ScenarioType,
  summary: MonthlyHistoryType,
  revenueInStartingDollars: number,
): ScoreBreakdownType {
  const blackoutsTWh =
    Math.max(0, summary.demandWh - summary.supplyWh) / 1000000000000;
  // A public utility that fails before supplying any electricity still needs a valid final score.
  // Its effective rate is unknowable, so leave that category neutral instead of dividing 0 / 0
  // and sending NaN to the score screen and Firestore.
  const effectiveRate = lifetimeRate(
    { revenue: revenueInStartingDollars, supplyWh: summary.supplyWh },
    scenario.dollarsPerkWh,
  );
  const inputs: ScoreInputsType = {
    summary,
    blackoutsTWh,
    targetRate: scenario.dollarsPerkWh,
    effectiveRate,
  };
  const breakdown: ScoreBreakdownType = {};
  for (const rule of SCORE_RULES[scenario.ownership]) {
    breakdown[rule.category] = rule.score
      ? rule.score(inputs)
      : Math.round((rule.points * rule.measure(inputs)) / rule.per);
  }
  return breakdown;
}

/**
 * Revenue across completed months, each deflated to the run's starting-year dollars by the
 * inflation index in force that month. Every kWh then counts equally toward the lifetime average
 * rate, whichever year it was sold in.
 */
export function startingDollarRevenue(
  history: Pick<MonthlyHistoryType, "revenue" | "year" | "month">[],
  startingYear: number,
  seed: number,
): number {
  return history.reduce(
    (sum, { revenue, year, month }) =>
      sum +
      revenue /
        getInflationIndex({ year, monthNumber: month }, startingYear, seed),
    0,
  );
}

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
 * is the display's term for the year the player is choosing a rate for. `rate` is in today's
 * dollars and `inflationIndex` is today's index, which deflates it to the starting-year dollars
 * the target is authored in.
 */
export function publicRateYearContribution(
  targetRate: number,
  past: Pick<MonthlyHistoryType, "supplyWh">,
  next: Pick<MonthlyHistoryType, "supplyWh">,
  rate: number,
  inflationIndex = 1,
): number {
  const lifetimeWh = past.supplyWh + next.supplyWh;
  if (lifetimeWh <= 0) {
    // Nothing sold means no rate to judge, so the category stays neutral
    return 0;
  }
  const share = next.supplyWh / lifetimeWh;
  return Math.round(
    PUBLIC_RATE_POINTS_PER_CENT *
      100 *
      (targetRate - rate / inflationIndex) *
      share,
  );
}

export function totalScore(breakdown: ScoreBreakdownType): number {
  return Object.values(breakdown).reduce((a, b) => a + (b ?? 0), 0);
}
