import { SCENARIOS } from "../data/Scenarios";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import { computeScoreBreakdown, totalScore } from "./Scoring";
import { EMPTY_HISTORY } from "./DateTime";

it("gives a public utility that supplied no electricity a finite score", () => {
  const scenario = SCENARIOS.find(
    (candidate: ScenarioType) => candidate.ownership === "Public",
  ) as ScenarioType;
  const summary: MonthlyHistoryType = {
    year: scenario.startingYear,
    month: 1,
    supplyWh: 0,
    demandWh: 1000000000000,
    deliveredWhByFuel: {},
    peakDemandW: 1000000000000,
    cash: -1,
    customers: 100,
    netWorth: 0,
    revenue: 0,
    expensesFuel: 0,
    expensesOM: 0,
    expensesCarbonFee: 0,
    expensesInterest: 0,
    kgco2e: 0,
    interestRate: 0.05,
    inflationRate: 0.02,
  };

  const breakdown = computeScoreBreakdown(scenario, summary);

  expect(Object.values(breakdown).every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(totalScore(breakdown))).toBe(true);
});

it("counts purchased emissions in the score just like the same local total", () => {
  const scenario = SCENARIOS.find((s) => s.ownership === "Investor")!;
  const summary = {
    ...EMPTY_HISTORY,
    kgco2e: 1000000000,
    localKgco2e: 0,
    importedKgco2e: 1000000000,
  };
  const imports = computeScoreBreakdown(scenario, summary);
  const local = computeScoreBreakdown(scenario, {
    ...summary,
    localKgco2e: 1000000000,
    importedKgco2e: 0,
  });
  expect(imports.emissions).toBe(-2);
  expect(imports).toEqual(local);
});
