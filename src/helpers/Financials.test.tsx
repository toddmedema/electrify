import {
  customersFromMarketingSpend,
  CreditInputsType,
  facilityCashBack,
  getCompanyInterestRate,
  getCreditInputs,
  getCreditPremium,
  getMonthlyPayment,
  getPaymentInterest,
  getTotalDebt,
  MAX_CREDIT_POINTS,
  LCWH,
} from "./Financials";
import {
  GENERATOR_SELL_MULTIPLIER,
  HOURS_PER_YEAR_REAL,
  LOAN_MONTHS,
} from "../Constants";
import { FacilityOperatingType, GeneratorShoppingType } from "../Types";
import { getDateFromMinute } from "./DateTime";
import { formatMoneyConcise } from "./Format";
import { initFuelPricesFromCsv } from "../data/FuelPrices";

// Only the fields these helpers read; the rest of an operating facility is irrelevant here
function aFacility(
  overrides: Partial<FacilityOperatingType> = {},
): FacilityOperatingType {
  return {
    buildCost: 1000000,
    loanAmountLeft: 0,
    yearsToBuild: 4,
    yearsToBuildLeft: 0,
    ...overrides,
  } as FacilityOperatingType;
}

describe("getMonthlyPayment", () => {
  // The amortisation formula is 0/0 at a rate of zero, and a NaN payment spreads to the balance,
  // the cash and the net worth without ever announcing itself. Nothing in the game reaches this
  // today -- prime has a 3.25% floor and the credit premium only multiplies it -- but this is
  // exported, and an interest free loan is a plain division rather than an undefined one
  it("splits the principal evenly when there is no interest to pay", () => {
    expect(getMonthlyPayment(1200, 0, 12)).toBe(100);
    expect(getMonthlyPayment(1200, 0, 0)).toBe(1200);
  });

  it("amortizes the principal away over the term", () => {
    const principal = 1000000;
    const rate = 0.06;
    const months = 120;
    const payment = getMonthlyPayment(principal, rate, months);

    let balance = principal;
    for (let i = 0; i < months; i++) {
      balance -= payment - getPaymentInterest(balance, rate);
    }
    // The last dollar of a ten year loan is where the rounding lands
    expect(balance).toBeCloseTo(0, 6);
  });

  it("charges more per month over a shorter term", () => {
    expect(getMonthlyPayment(1000000, 0.06, 60)).toBeGreaterThan(
      getMonthlyPayment(1000000, 0.06, 120),
    );
  });

  it("charges more per month at a higher rate", () => {
    expect(getMonthlyPayment(1000000, 0.1, LOAN_MONTHS)).toBeGreaterThan(
      getMonthlyPayment(1000000, 0.05, LOAN_MONTHS),
    );
  });

  it("always repays at least the principal", () => {
    const principal = 1000000;
    const total = getMonthlyPayment(principal, 0.06, LOAN_MONTHS) * LOAN_MONTHS;
    expect(total).toBeGreaterThan(principal);
  });
});

describe("getPaymentInterest", () => {
  it("charges the monthly share of the annual rate on the balance", () => {
    expect(getPaymentInterest(120000, 0.06)).toBeCloseTo(600, 6);
  });

  it("charges nothing once the loan is paid off", () => {
    expect(getPaymentInterest(0, 0.06)).toBe(0);
  });

  it("falls as the balance falls", () => {
    expect(getPaymentInterest(50000, 0.06)).toBeLessThan(
      getPaymentInterest(100000, 0.06),
    );
  });
});

describe("facilityCashBack", () => {
  it("returns the full build cost for a facility that was never started", () => {
    // Nothing has been spent on materials yet, so there is nothing to lose on resale
    expect(
      facilityCashBack(aFacility({ yearsToBuildLeft: 4, yearsToBuild: 4 })),
    ).toBe(1000000);
  });

  it("takes the sell multiplier off a finished facility", () => {
    expect(facilityCashBack(aFacility())).toBeCloseTo(
      1000000 * (1 - GENERATOR_SELL_MULTIPLIER),
      6,
    );
  });

  it("pays back less the further construction has progressed", () => {
    // 2.5% and 5% of a four year build
    const early = facilityCashBack(aFacility({ yearsToBuildLeft: 3.9 }));
    const later = facilityCashBack(aFacility({ yearsToBuildLeft: 3.8 }));
    expect(early).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(facilityCashBack(aFacility()));
  });

  /**
   * The taper is sqrt(percentBuilt * 10), capped at 1, so it reaches the full penalty at 10% built
   * and everything past that refunds the same. Worth knowing before reading the "refund slightly
   * more if construction isn't complete" comment as a smooth curve across the whole build.
   */
  it("charges the full penalty from 10% built onwards", () => {
    const tenPercent = facilityCashBack(aFacility({ yearsToBuildLeft: 3.6 }));
    expect(tenPercent).toBeCloseTo(facilityCashBack(aFacility()), 6);
    expect(facilityCashBack(aFacility({ yearsToBuildLeft: 0.5 }))).toBeCloseTo(
      facilityCashBack(aFacility()),
      6,
    );
  });

  it("nets out what is still owed on the loan", () => {
    const owed = 400000;
    expect(facilityCashBack(aFacility({ loanAmountLeft: owed }))).toBeCloseTo(
      (1000000 - owed) * (1 - GENERATOR_SELL_MULTIPLIER),
      6,
    );
  });

  it("never returns more than was spent", () => {
    [0, 0.1, 1, 2, 3.5, 4].forEach((yearsToBuildLeft) => {
      expect(
        facilityCashBack(aFacility({ yearsToBuildLeft })),
      ).toBeLessThanOrEqual(1000000);
    });
  });
});

describe("customersFromMarketingSpend", () => {
  it("signs up nobody for nothing", () => {
    expect(customersFromMarketingSpend(0)).toBe(0);
  });

  it("returns a whole number of customers", () => {
    expect(Number.isInteger(customersFromMarketingSpend(1234567))).toBe(true);
  });

  it("wins more customers the more is spent", () => {
    expect(customersFromMarketingSpend(1000000)).toBeGreaterThan(
      customersFromMarketingSpend(100000),
    );
  });

  it("costs more per customer as spend grows", () => {
    // The acquisition cost rises with spend, so the last dollar buys less than the first
    const costPer = (spend: number) =>
      spend / customersFromMarketingSpend(spend);
    expect(costPer(10000000)).toBeGreaterThan(costPer(100000));
  });
});

describe("LCWH", () => {
  // Only the fields LCWH reads
  const generator = {
    fuel: "Wind",
    peakW: 100000000,
    buildCost: 200000000,
    annualOperatingCost: 4000000,
    lifespanYears: 25,
    capacityFactor: 0.35,
    btuPerWh: 0,
  } as GeneratorShoppingType;
  const date = getDateFromMinute(0, 2020);
  const SEED = 1;

  beforeAll(() => {
    initFuelPricesFromCsv(
      ["year,month,naturalgas,coal,uranium,oil"]
        .concat(
          Array.from({ length: 12 }, (_v, i) => `2020,${i + 1},3,2,0.7,10`),
        )
        .join("\n"),
    );
  });

  it("spreads build and operating costs across a lifetime of output", () => {
    const totalWh = 100000000 * 25 * HOURS_PER_YEAR_REAL * 0.35;
    expect(LCWH(generator, date, 0, SEED)).toBeCloseTo(
      (200000000 + 4000000 * 25) / totalWh,
      12,
    );
  });

  it("charges a carbon fee against a fuel's emissions", () => {
    const gas = {
      ...generator,
      fuel: "Natural Gas",
      btuPerWh: 0.0035,
    } as GeneratorShoppingType;
    expect(LCWH(gas, date, 0.1, SEED)).toBeGreaterThan(
      LCWH(gas, date, 0, SEED),
    );
  });

  /**
   * An intermittent generator sampled across a window with no sun in it comes back with a zero
   * capacity factor, and dividing by that used to reach the build screen as "$INFINITY/MWh".
   * The cost really is unbounded, so LCWH says so and the formatter renders it as a dash.
   */
  it("reports an unbounded cost for a generator expected to produce nothing", () => {
    const dark = { ...generator, capacityFactor: 0 };
    expect(LCWH(dark, date, 0, SEED)).toBe(Infinity);
    expect(formatMoneyConcise(LCWH(dark, date, 0, SEED) * 1000000)).toEqual(
      "\u2014",
    );
  });
});

// A company a lender has no complaint about: profitable, liquid, barely borrowed
function aCleanCompany(
  overrides: Partial<CreditInputsType> = {},
): CreditInputsType {
  return {
    profitMargin: 0.1,
    cashRatio: 0.1,
    debtToCapital: 0.4,
    debtToRevenue: 2,
    ...overrides,
  };
}

describe("getCreditPremium", () => {
  it("lends at prime to a company with nothing wrong with it", () => {
    expect(getCreditPremium(aCleanCompany())).toEqual(1);
  });

  it("charges nothing extra for being better than the bar", () => {
    // Sitting on twice the cash asked for doesn't earn a discount - prime is the floor
    expect(
      getCreditPremium(
        aCleanCompany({ profitMargin: 0.5, cashRatio: 0.9, debtToCapital: 0 }),
      ),
    ).toEqual(1);
  });

  // The worked example from the issue: 10 points for no margin, 5 for holding only 5% cash
  it("charges 5% of prime for each point a company falls short by", () => {
    const premium = getCreditPremium(
      aCleanCompany({ profitMargin: 0, cashRatio: 0.05 }),
    );
    expect(premium).toBeCloseTo(1.75, 10);
    expect(
      getCompanyInterestRate(
        0.05,
        aCleanCompany({
          profitMargin: 0,
          cashRatio: 0.05,
        }),
      ),
    ).toBeCloseTo(0.0875, 10);
  });

  it("keeps charging a company whose losses keep growing", () => {
    const bad = getCreditPremium(aCleanCompany({ profitMargin: -0.1 }));
    const worse = getCreditPremium(aCleanCompany({ profitMargin: -0.3 }));
    expect(worse).toBeGreaterThan(bad);
    expect(bad).toBeGreaterThan(1);
  });

  // The feedback loop the issue is missing without it: borrowing to build makes the next
  // loan dearer, whatever the income statement says
  it("charges more for being levered, holding profit and cash fixed", () => {
    const modest = getCreditPremium(aCleanCompany({ debtToCapital: 0.4 }));
    const stretched = getCreditPremium(aCleanCompany({ debtToCapital: 0.8 }));
    expect(stretched).toBeGreaterThan(modest);
    // 40 points of leverage above the line, at half a point each, at 5% of prime each
    expect(stretched).toBeCloseTo(1 + 20 * 0.05, 10);
  });

  it("charges more for owing more years of revenue, holding everything else fixed", () => {
    const covered = getCreditPremium(aCleanCompany({ debtToRevenue: 2 }));
    const stretched = getCreditPremium(aCleanCompany({ debtToRevenue: 6 }));
    expect(stretched).toBeGreaterThan(covered);
  });

  it("stops pricing a company that is past saving", () => {
    const hopeless = getCreditPremium({
      profitMargin: -10,
      cashRatio: -1,
      debtToCapital: 1,
      debtToRevenue: 100,
    });
    expect(hopeless).toEqual(1 + MAX_CREDIT_POINTS * 0.05);
  });
});

describe("getTotalDebt", () => {
  it("adds up what is still owed across the fleet", () => {
    expect(
      getTotalDebt([
        aFacility({ loanAmountLeft: 1000 }),
        aFacility({ loanAmountLeft: 2500 }),
        aFacility(), // Bought outright
      ]),
    ).toEqual(3500);
  });
});

describe("getCreditInputs", () => {
  const aMonth = (revenue: number, expenses: number) =>
    ({
      revenue,
      expensesFuel: expenses,
      expensesOM: 0,
      expensesCarbonFee: 0,
      expensesInterest: 0,
      expensesMarketing: 0,
      supplyWh: 1000,
    }) as never;

  it("prices a company on its first day off its balance sheet alone", () => {
    // No history to read a margin from, and dividing by that revenue would be a NaN rate
    const inputs = getCreditInputs([], 1000, 1000, []);
    expect(getCreditPremium(inputs)).toEqual(1);
  });

  it("reads the margin off a year of results", () => {
    const months = new Array(12).fill(aMonth(100, 80));
    const inputs = getCreditInputs(months, 500, 1000, []);
    expect(inputs.profitMargin).toBeCloseTo(0.2, 10);
    expect(inputs.cashRatio).toBeCloseTo(0.5, 10);
  });

  it("annualises a partial year rather than judging it as a whole one", () => {
    // Three months in, a company owing one month's revenue is not owing a third of a year's
    const months = new Array(3).fill(aMonth(100, 80));
    const inputs = getCreditInputs(months, 500, 1000, [
      aFacility({ loanAmountLeft: 1200 }),
    ]);
    expect(inputs.debtToRevenue).toBeCloseTo(1, 10);
  });

  it("counts debt against what is financing the fleet", () => {
    const inputs = getCreditInputs([aMonth(100, 50)], 500, 1000, [
      aFacility({ loanAmountLeft: 1000 }),
    ]);
    expect(inputs.debtToCapital).toBeCloseTo(0.5, 10);
  });
});
