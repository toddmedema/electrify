import { SCENARIOS } from "../data/Scenarios";
import { initEconomyFromCsv } from "../data/Economy";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import { EMPTY_HISTORY, summarizeHistory } from "./DateTime";
import {
  computeScoreBreakdown,
  startingDollarRevenue,
  totalScore,
} from "./Scoring";
import { projectScore } from "./ScoreProjection";

const investor = {
  ...SCENARIOS.find((s) => s.ownership === "Investor")!,
  durationMonths: 48,
} as ScenarioType;

// Flat prices, so starting-year dollars equal nominal ones and the arithmetic stays readable
beforeAll(() =>
  initEconomyFromCsv(
    "month,year,prime,inflation\n" +
      [2020, 2021, 2022, 2023]
        .flatMap((year) =>
          Array.from({ length: 12 }, (_, month) => `${month + 1},${year},4,0`),
        )
        .join("\n"),
  ),
);

// Newest first, like state.monthlyHistory: a steady month of supply, with net worth and
// customers each climbing by a fixed amount
function steadyRun(months: number): MonthlyHistoryType[] {
  return Array.from({ length: months }, (_, elapsed) => ({
    ...EMPTY_HISTORY,
    deliveredWhByFuel: {},
    year: 2020 + Math.floor(elapsed / 12),
    month: (elapsed % 12) + 1,
    supplyWh: 1e12,
    demandWh: 1e12,
    kgco2e: 0,
    netWorth: 1e9 * (elapsed + 1),
    customers: 100000 * (elapsed + 1),
  })).reverse();
}

describe("projectScore", () => {
  it("scores each completed month with the end-of-run formula", () => {
    const history = steadyRun(18);
    const projection = projectScore(investor, history, 2020, 1)!;
    expect(projection.actual).toHaveLength(18);
    const current = totalScore(
      computeScoreBreakdown(
        investor,
        summarizeHistory(history),
        startingDollarRevenue(history, 2020, 1),
      ),
    );
    expect(projection.actual[17]).toBe(current);
    // The first month is scored on its own: 1 TWh, $1B and 100k customers
    expect(projection.actual[0]).toBe(1 + 40 + 2);
  });

  it("extends a steady pace in a straight line to the end of the term", () => {
    const projection = projectScore(investor, steadyRun(18), 2020, 1)!;
    expect(projection.projected).toHaveLength(30);
    // Every month adds 1 point of supply, 40 of net worth and 2 of customers
    expect(projection.projected[0]).toBe(projection.actual[17] + 43);
    expect(projection.final).toBe(48 * 43);
  });

  it("settles on the current score once the term is over", () => {
    const projection = projectScore(investor, steadyRun(48), 2020, 1)!;
    expect(projection.projected).toEqual([]);
    expect(projection.final).toBe(projection.actual[47]);
  });

  it("reads a pace from the months there are, and nothing from none", () => {
    expect(projectScore(investor, [], 2020, 1)).toBeNull();
    const early = projectScore(investor, steadyRun(3), 2020, 1)!;
    expect(early.final).toBe(48 * 43);
    // A single month has no trend in its levels yet, only its flows
    const first = projectScore(investor, steadyRun(1), 2020, 1)!;
    expect(first.final).toBe(48 + 40 + 2);
  });

  it("never projects fewer than zero customers", () => {
    const shrinking = steadyRun(12).reverse();
    shrinking.forEach((month, elapsed) => {
      month.customers = 100000 * (12 - elapsed);
    });
    const projection = projectScore(investor, shrinking.reverse(), 2020, 1)!;
    const withoutCustomers = projectScore(
      investor,
      shrinking.map((month) => ({ ...month, customers: 0 })),
      2020,
      1,
    )!;
    expect(projection.final).toBe(withoutCustomers.final);
  });
});
