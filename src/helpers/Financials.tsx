import {
  FUELS,
  GENERATOR_SELL_MULTIPLIER,
  HOURS_PER_YEAR_REAL,
} from "../Constants";
import {
  DateType,
  FacilityOperatingType,
  GeneratorShoppingType,
  MonthlyHistoryType,
} from "../Types";
import { getFuelPricesPerMBTU } from "../data/FuelPrices";
import {
  deriveExpandedSummary,
  EMPTY_HISTORY,
  reduceHistories,
} from "./DateTime";

// Get the monthly payment amount for a new loan
// https://codepen.io/joeymack47/pen/fHwvd?editors=1010
export function getMonthlyPayment(
  principal: number,
  interestRate: number,
  months: number,
): number {
  const monthlyRate = interestRate / 12;
  // The amortisation formula is 0/0 at a rate of zero, and a NaN payment spreads to the balance,
  // the cash and the net worth without ever announcing itself. Prime has a floor of 3.25% and
  // the credit premium only multiplies it, so nothing in the game reaches this today -- but this
  // is exported, and an interest free loan is a plain division rather than an undefined one
  if (monthlyRate === 0) {
    return months > 0 ? principal / months : principal;
  }
  return principal * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)));
}

// Of a month's payment on an amortizing loan, how many $'s go towards interest
// (the rest goes towards principal). Depends only on what is still owed, so the payment
// amount itself is not a parameter -- it used to be one, and was never read.
export function getPaymentInterest(
  balance: number,
  interestRate: number,
): number {
  const monthlyRate = interestRate / 12;
  return balance * monthlyRate;
}

// What a lender looks at, and roughly what it is looking for. A company clearing all four pays
// the prime rate; every point short of them costs 5% of prime on top.
const CLEAN_MARGIN_PERCENT = 10; // Profit as a share of revenue
const CLEAN_CASH_PERCENT = 10; // Cash as a share of net worth
const CLEAN_DEBT_TO_CAPITAL_PERCENT = 40; // Debt as a share of everything financing the fleet
const CLEAN_DEBT_TO_REVENUE = 2; // Debt as a multiple of a year's revenue
const PREMIUM_PER_POINT = 0.05;
// A negative margin keeps accruing points without a floor, and a company being quoted more than
// three times prime is not being priced any more, it is being refused. Capped so that the bad
// end of the scale stays a number rather than running away.
export const MAX_CREDIT_POINTS = 40;

export function getTotalDebt(facilities: FacilityOperatingType[]): number {
  return facilities.reduce(
    (debt: number, g: FacilityOperatingType) => debt + g.loanAmountLeft,
    0,
  );
}

export interface CreditInputsType {
  profitMargin: number; // Trailing 12 month profit / revenue. Can be negative
  cashRatio: number; // Cash / net worth
  debtToCapital: number; // Debt / (debt + net worth)
  debtToRevenue: number; // Debt / trailing 12 month revenue
}

/**
 * How much more than prime a company pays, as a multiplier. Profitability and cash are what the
 * lender asks about first; the two debt terms are why borrowing to build gets steadily more
 * expensive rather than costing the same every time. Each is measured in the same currency -
 * points, worth 5% of prime apiece - so they simply add up.
 */
export function getCreditPremium(c: CreditInputsType): number {
  const points =
    Math.max(0, CLEAN_MARGIN_PERCENT - c.profitMargin * 100) +
    Math.max(0, CLEAN_CASH_PERCENT - c.cashRatio * 100) +
    // Half a point per point of leverage above the line, so that crossing it is a warning rather
    // than a cliff -- a fleet financed at 80% is 20 points, not 40
    Math.max(0, (c.debtToCapital * 100 - CLEAN_DEBT_TO_CAPITAL_PERCENT) / 2) +
    Math.max(0, (c.debtToRevenue - CLEAN_DEBT_TO_REVENUE) * 5);
  return 1 + PREMIUM_PER_POINT * Math.min(points, MAX_CREDIT_POINTS);
}

export function getCompanyInterestRate(
  primeRate: number,
  c: CreditInputsType,
): number {
  return primeRate * getCreditPremium(c);
}

// A lender looks at a year, not a month. One bad month of weather is not a credit event, and
// pricing off it would have the rate flapping around every rollover.
const TRAILING_MONTHS = 12;

/**
 * Reads the four things a lender cares about off the company's own books. Cash and net worth are
 * passed in rather than read from the history because the caller has the current tick and the
 * history only goes up to the end of last month.
 */
export function getCreditInputs(
  monthlyHistory: MonthlyHistoryType[],
  cash: number,
  netWorth: number,
  facilities: FacilityOperatingType[],
): CreditInputsType {
  const trailing = deriveExpandedSummary(
    monthlyHistory
      .slice(0, TRAILING_MONTHS)
      // Newest first, and reduceHistories keeps the last value it sees for point-in-time fields
      .reverse()
      .reduce(reduceHistories, { ...EMPTY_HISTORY }),
  );
  const debt = getTotalDebt(facilities);
  // Annualised, so that a company three months into its first year is judged on the rate it is
  // earning rather than on a quarter of a year's revenue
  const months = Math.min(TRAILING_MONTHS, monthlyHistory.length);
  const annualRevenue = months > 0 ? (trailing.revenue / months) * 12 : 0;
  const capital = debt + Math.max(0, netWorth);
  return {
    // No revenue means no track record to price - a company on its first day, or one that has
    // stopped selling entirely. Treat the former as unremarkable rather than dividing by zero;
    // the cash and debt terms still carry the assessment.
    profitMargin:
      trailing.revenue > 0
        ? trailing.profit / trailing.revenue
        : CLEAN_MARGIN_PERCENT / 100,
    cashRatio: netWorth > 0 ? cash / netWorth : 0,
    debtToCapital: capital > 0 ? debt / capital : 0,
    debtToRevenue: annualRevenue > 0 ? debt / annualRevenue : 0,
  };
}

// TODO extrapolate future fuel prices over plant lifetime
export function LCWH(
  g: GeneratorShoppingType,
  date: DateType,
  feePerKgCO2e: number,
  seed: number,
) {
  const fuel = FUELS[g.fuel] || {};
  const fuelCostPerWh =
    ((getFuelPricesPerMBTU(date, seed)[g.fuel] || 0) * g.btuPerWh) / 1000000;
  const carbonCostPerWh = (feePerKgCO2e * fuel.kgCO2ePerBtu || 0) * g.btuPerWh;
  // Zero when the capacity factor estimate is zero -- an intermittent generator sampled across
  // a window with no sun or no wind in it. The cost per Wh of a plant expected to produce nothing
  // is genuinely unbounded, so this returns Infinity rather than inventing a number; the money
  // formatters render that as a dash.
  const totalWh =
    g.peakW * g.lifespanYears * HOURS_PER_YEAR_REAL * g.capacityFactor;
  const costPerWh =
    (g.buildCost +
      g.annualOperatingCost * g.lifespanYears +
      (fuelCostPerWh + carbonCostPerWh) * totalWh) /
    totalWh;
  return costPerWh;
}

// Returns how much cash the user recieves if they sell / cancel the facility
export function facilityCashBack(g: FacilityOperatingType): number {
  // Refund slightly more if construction isn't complete - after all, that money hasn't been spent yet
  // But lose more upfront from material purchases: https://www.wolframalpha.com/input/?i=10*x+%5E+1%2F2+from+0+to+100
  const percentBuilt = (g.yearsToBuild - g.yearsToBuildLeft) / g.yearsToBuild;
  const lostFromSelling =
    (g.buildCost - g.loanAmountLeft) *
    GENERATOR_SELL_MULTIPLIER *
    Math.min(1, Math.pow(percentBuilt * 10, 1 / 2));
  return g.buildCost - lostFromSelling - g.loanAmountLeft;
}

// CAC $100->150, increasing as you spend more - https://woodlawnassociates.com/electrical-potential-solar-and-competitive-electricity/
export function customersFromMarketingSpend(spend: number) {
  return Math.floor(spend / (100 + spend / 1000000));
}
