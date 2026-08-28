import { SCENARIOS } from "../data/Scenarios";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import { computeScoreBreakdown, totalScore } from "./Scoring";

it("gives a public utility that supplied no electricity a finite score", () => {
  const scenario = SCENARIOS.find(
    (candidate: ScenarioType) => candidate.ownership === "Public",
  ) as ScenarioType;
  const summary: MonthlyHistoryType = {
    year: scenario.startingYear,
    month: 1,
    supplyWh: 0,
    demandWh: 1000000000000,
    cash: -1,
    customers: 100,
    netWorth: 0,
    revenue: 0,
    expensesFuel: 0,
    expensesOM: 0,
    expensesCarbonFee: 0,
    expensesInterest: 0,
    expensesMarketing: 0,
    kgco2e: 0,
    interestRate: 0.05,
    inflationRate: 0.02,
  };

  const breakdown = computeScoreBreakdown(scenario, summary);

  expect(Object.values(breakdown).every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(totalScore(breakdown))).toBe(true);
});
