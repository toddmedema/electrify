import {FUELS, GENERATOR_SELL_MULTIPLIER, HOURS_PER_YEAR_REAL} from 'app/Constants';
import {DateType, FacilityOperatingType, GeneratorShoppingType, MonthlyHistoryType} from 'app/Types';
import {getFuelPricesPerMBTU} from 'shared/schema/FuelPrices';

// Get the monthly payment amount for a new loan
// https://codepen.io/joeymack47/pen/fHwvd?editors=1010
export function getMonthlyPayment(principlal: number, interestRate: number, months: number): number {
  const monthlyRate = interestRate / 12;
  return principlal * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)));
}

// For a given monthly payment, return how many $'s go towards paying off the interest (the rest goes towards principal)
export function getPaymentInterest(balance: number, interestRate: number, monthlyPayment: number): number {
  const monthlyRate = interestRate / 12;
  return balance * monthlyRate;
}

// TODO extrapolate future fuel prices over plant lifetime
export function LCWH(g: GeneratorShoppingType, date: DateType, feePerKgCO2e: number) {
  const fuel = FUELS[g.fuel] || {};
  const fuelCostPerWh = (getFuelPricesPerMBTU(date)[g.fuel] || 0) * g.btuPerWh / 1000000;
  const carbonCostPerWh = (feePerKgCO2e * fuel.kgCO2ePerBtu || 0) * g.btuPerWh;
  const totalWh = g.peakW * g.lifespanYears * HOURS_PER_YEAR_REAL * g.capacityFactor;
  const costPerWh = (g.buildCost + g.annualOperatingCost * g.lifespanYears + (fuelCostPerWh + carbonCostPerWh) * totalWh) / totalWh;
  return costPerWh;
}

// Returns how much cash the user recieves if they sell / cancel the facility
export function facilityCashBack(g: FacilityOperatingType): number {
  // Refund slightly more if construction isn't complete - after all, that money hasn't been spent yet
  // But lose more upfront from material purchases: https://www.wolframalpha.com/input/?i=10*x+%5E+1%2F2+from+0+to+100
  const percentBuilt = (g.yearsToBuild - g.yearsToBuildLeft) / g.yearsToBuild;
  const lostFromSelling = (g.buildCost - g.loanAmountLeft) * GENERATOR_SELL_MULTIPLIER * Math.min(1, Math.pow(percentBuilt * 10, 1 / 2));
  return g.buildCost - lostFromSelling - g.loanAmountLeft;
}

export function summarizeHistory(t: MonthlyHistoryType[], filter?: (t: MonthlyHistoryType) => boolean): MonthlyHistoryType {
  const summary = {
    supplyWh: 0,
    demandWh: 0,
    population: 0,
    kgco2e: 0,
    revenue: 0,
    expensesFuel: 0,
    expensesOM: 0,
    expensesCarbonFee: 0,
    expensesInterest: 0,
  } as MonthlyHistoryType;
  // Go in reverse so that the last values for ending values (like net worth are used)
  for (let i = t.length - 1; i >= 0 ; i--) {
    const h = t[i];
    if (!filter || filter(h)) {
      summary.supplyWh += h.supplyWh;
      summary.demandWh += h.demandWh;
      summary.kgco2e += h.kgco2e;
      summary.revenue += h.revenue;
      summary.expensesFuel += h.expensesFuel;
      summary.expensesOM += h.expensesOM;
      summary.expensesCarbonFee += h.expensesCarbonFee;
      summary.expensesInterest += h.expensesInterest;
      summary.population = h.population;
      summary.netWorth = h.netWorth;
    }
  }
  return summary;
}
