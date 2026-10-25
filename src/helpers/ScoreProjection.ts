import { getRateInflationIndex } from "../data/Economy";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import { EMPTY_HISTORY, reduceHistories } from "./DateTime";
import {
  computeScoreBreakdown,
  customerSalesRevenue,
  totalScore,
} from "./Scoring";

// A year of months averages out the seasons, so a winter run-rate isn't mistaken for a trend
const TREND_MONTHS = 12;

export interface ScoreProjectionType {
  /** The score at the end of each completed month, oldest first */
  actual: number[];
  /**
   * The score at the end of each remaining month if the recent pace holds, starting with the
   * month after the last completed one. Empty once the term is over.
   */
  projected: number[];
  /** Where the run is heading: the last projected score, or the current one at the end */
  final: number;
}

/**
 * The run's score month by month, and where it ends if the last year's pace continues.
 *
 * Each completed month is scored with the real end-of-run formula over everything up to it, so
 * the line matches what the score screen would have said had the run ended there. The projection
 * extends the same formula rather than a second model: what accumulates (energy supplied, unmet
 * demand, emissions, customer revenue) keeps arriving at its recent monthly average, and what is a
 * level at the end (net worth) keeps moving at its recent monthly rate. It is a
 * straight-line guide to the trend, not a forecast of the decisions still to come.
 *
 * `history` is newest first, as the game stores it.
 */
export function projectScore(
  scenario: ScenarioType,
  history: MonthlyHistoryType[],
  startingYear: number,
  seed: number,
): ScoreProjectionType | null {
  if (history.length === 0) {
    return null;
  }
  const summary: MonthlyHistoryType = { ...EMPTY_HISTORY };
  const revenues: number[] = [];
  const actual: number[] = [];
  let revenue = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const month = history[i];
    reduceHistories(summary, month);
    const deflated =
      customerSalesRevenue(month) /
      getRateInflationIndex(
        { year: month.year, monthNumber: month.month },
        startingYear,
        seed,
      );
    revenue += deflated;
    revenues.push(deflated);
    actual.push(totalScore(computeScoreBreakdown(scenario, summary, revenue)));
  }

  const window = history.slice(0, TREND_MONTHS);
  const months = window.length;
  const mean = (value: (month: MonthlyHistoryType) => number) =>
    window.reduce((sum, month) => sum + value(month), 0) / months;
  const supplyWh = mean((month) => month.supplyWh);
  const demandWh = mean((month) => month.demandWh);
  const kgco2e = mean((month) => month.kgco2e);
  const monthlyRevenue =
    revenues.slice(-months).reduce((sum, value) => sum + value, 0) / months;
  // The change from the month before the window began, so a full window spans a full year
  const before = history[months] ?? window[months - 1];
  const steps = Math.max(1, history[months] ? months : months - 1);
  const netWorthSlope = (window[0].netWorth - before.netWorth) / steps;

  const projected: number[] = [];
  const remaining = Math.max(0, scenario.durationMonths - history.length);
  for (let ahead = 1; ahead <= remaining; ahead++) {
    const future: MonthlyHistoryType = {
      ...summary,
      supplyWh: summary.supplyWh + supplyWh * ahead,
      demandWh: summary.demandWh + demandWh * ahead,
      kgco2e: summary.kgco2e + kgco2e * ahead,
      netWorth: summary.netWorth + netWorthSlope * ahead,
    };
    projected.push(
      totalScore(
        computeScoreBreakdown(
          scenario,
          future,
          revenue + monthlyRevenue * ahead,
        ),
      ),
    );
  }

  return {
    actual,
    projected,
    final: projected[projected.length - 1] ?? actual[actual.length - 1],
  };
}
