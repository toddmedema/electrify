import { SCENARIOS } from "../data/Scenarios";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import {
  computeScoreBreakdown,
  publicRateScoreChange,
  publicRateScore,
  publicRateYearContribution,
  startingDollarRevenue,
  totalScore,
} from "./Scoring";
import { EMPTY_HISTORY } from "./DateTime";
import { initEconomyFromCsv } from "../data/Economy";

// 12% a year, as 1% a month, so the index is exactly 1.01 ^ months elapsed
function loadSteadyInflation(years: number[]) {
  initEconomyFromCsv(
    "month,year,prime,inflation\n" +
      years
        .flatMap((year) =>
          Array.from(
            { length: 12 },
            (_, month) => `${month + 1},${year},4,0.12`,
          ),
        )
        .join("\n"),
  );
}

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

  const breakdown = computeScoreBreakdown(scenario, summary, summary.revenue);

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
  const imports = computeScoreBreakdown(scenario, summary, summary.revenue);
  const local = computeScoreBreakdown(
    scenario,
    {
      ...summary,
      localKgco2e: 1000000000,
      importedKgco2e: 0,
    },
    summary.revenue,
  );
  expect(imports.emissions).toBe(-2);
  expect(imports).toEqual(local);
});

describe("inflation and the public rate target", () => {
  const scenario = {
    ...SCENARIOS.find((s) => s.ownership === "Public")!,
    dollarsPerkWh: 0.1,
    startingYear: 2020,
  };
  const kWhPerMonth = 1000;
  // Months newest first, like state.monthlyHistory, each billed at the target raised by that
  // month's inflation: a rate that only keeps pace with costs
  const history = Array.from({ length: 36 }, (_, elapsed) => ({
    ...EMPTY_HISTORY,
    deliveredWhByFuel: {},
    year: 2020 + Math.floor(elapsed / 12),
    month: (elapsed % 12) + 1,
    supplyWh: kWhPerMonth * 1000,
    revenue: 0.1 * Math.pow(1.01, elapsed) * kWhPerMonth,
  })).reverse();
  const summary = history.reduce(
    (acc, month) => ({
      ...acc,
      supplyWh: acc.supplyWh + month.supplyWh,
      revenue: acc.revenue + month.revenue,
    }),
    { ...EMPTY_HISTORY, deliveredWhByFuel: {} },
  );

  beforeEach(() => loadSteadyInflation([2020, 2021, 2022]));

  it("deflates each month's revenue by the index in force that month", () => {
    expect(startingDollarRevenue(history, 2020, 1)).toBeCloseTo(
      0.1 * 36 * kWhPerMonth,
      6,
    );
  });

  it("scores a rate that only tracks inflation as meeting the target", () => {
    const real = computeScoreBreakdown(
      scenario,
      summary,
      startingDollarRevenue(history, 2020, 1),
    );
    expect(real.rate).toBe(0);
    // Judged on nominal revenue, the same run would lose points for inflation alone
    expect(
      computeScoreBreakdown(scenario, summary, summary.revenue).rate,
    ).toBeLessThan(-100);
  });

  it("compares the coming year's rate to the target in today's dollars", () => {
    const past = { supplyWh: kWhPerMonth * 1000 * 12 };
    const next = { supplyWh: kWhPerMonth * 1000 * 12 };
    const index = Math.pow(1.01, 24);
    expect(
      publicRateYearContribution(0.1, past, next, 0.1 * index, index),
    ).toBe(0);
    expect(
      publicRateYearContribution(0.1, past, next, 0.1, index),
    ).toBeGreaterThan(0);
  });
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
