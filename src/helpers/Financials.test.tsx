import {
  customersFromMarketingSpend,
  facilityCashBack,
  getMonthlyPayment,
  getPaymentInterest,
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
