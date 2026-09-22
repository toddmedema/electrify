import { SCENARIOS } from "../data/Scenarios";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import {
  computeScoreBreakdown,
  publicRateScoreChange,
  publicRateScore,
  publicRateYearContribution,
  totalScore,
} from "./Scoring";
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

describe("publicRateScoreChange", () => {
  const kWh = (n: number) => n * 1000;

  it("credits a first year the full distance of its rate from the target", () => {
    // Nothing sold yet: the category starts neutral, then lands on the year's own average
    expect(
      publicRateScoreChange(
        0.1,
        { revenue: 0, supplyWh: 0 },
        { revenue: 0.08 * 1000, supplyWh: kWh(1000) },
      ),
    ).toBe(160);
  });

  it("moves an established average less than a fresh one", () => {
    // Three years at the target, then one at 2¢ under: the average only falls by 0.5¢
    expect(
      publicRateScoreChange(
        0.1,
        { revenue: 0.1 * 3000, supplyWh: kWh(3000) },
        { revenue: 0.08 * 1000, supplyWh: kWh(1000) },
      ),
    ).toBe(40);
  });

  it("takes points back when a cheap history is followed by a dear year", () => {
    expect(
      publicRateScoreChange(
        0.1,
        { revenue: 0.08 * 1000, supplyWh: kWh(1000) },
        { revenue: 0.12 * 1000, supplyWh: kWh(1000) },
      ),
    ).toBe(-160);
  });
});

describe("publicRateYearContribution", () => {
  const kWh = (n: number) => n * 1000;

  it("always takes the sign of the rate against the target", () => {
    const past = { supplyWh: kWh(12000) };
    const next = { supplyWh: kWh(12000) };
    expect(publicRateYearContribution(0.1, past, next, 0.08)).toBeGreaterThan(
      0,
    );
    expect(publicRateYearContribution(0.1, past, next, 0.1)).toBe(0);
    expect(publicRateYearContribution(0.1, past, next, 0.12)).toBeLessThan(0);
  });

  it("reads a rate above target as a loss even when the average improves", () => {
    // A 10¢ target, a year at 20¢, then a year at 15¢: the lifetime average falls back toward
    // the target, so the change-based figure shows a gain while the rate is still 5¢ over.
    const past = { revenue: 0.2 * 12000, supplyWh: kWh(12000) };
    const next = { revenue: 0.15 * 12000, supplyWh: kWh(12000) };
    expect(publicRateScoreChange(0.1, past, next)).toBeGreaterThan(0);
    expect(publicRateYearContribution(0.1, past, next, 0.15)).toBe(-200);
  });

  it("shrinks as the record lengthens, because the year's share of lifetime sales does", () => {
    const year = { supplyWh: kWh(12000) };
    const shortRecord = { supplyWh: kWh(12000) };
    const longRecord = { supplyWh: kWh(120000) };
    const rate = 0.08;
    expect(
      Math.abs(publicRateYearContribution(0.1, longRecord, year, rate)),
    ).toBeLessThan(
      Math.abs(publicRateYearContribution(0.1, shortRecord, year, rate)),
    );
  });

  it("adds up to the final score over a supply-weighted split of the run", () => {
    // The score decomposes exactly into the years' own terms, so one year at the current rate
    // plus the years already played must rebuild the lifetime figure (up to rounding).
    const target = 0.1;
    const past = { revenue: 0.12 * 10000, supplyWh: kWh(10000) };
    const next = { revenue: 0.15 * 8000, supplyWh: kWh(8000) };
    const terms =
      publicRateYearContribution(target, past, next, 0.15) +
      publicRateYearContribution(target, next, past, 0.12);
    const lifetime = {
      revenue: past.revenue + next.revenue,
      supplyWh: past.supplyWh + next.supplyWh,
    };
    const expected = publicRateScore(
      target,
      lifetime.revenue / (lifetime.supplyWh / 1000),
    );
    expect(terms).toBeCloseTo(expected, -1);
  });

  it("stays neutral when nothing has been or will be supplied", () => {
    expect(
      publicRateYearContribution(0.1, { supplyWh: 0 }, { supplyWh: 0 }, 0.2),
    ).toBe(0);
  });
});
