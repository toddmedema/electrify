import {FUELS, GENERATOR_SELL_MULTIPLIER, HOURS_PER_YEAR_REAL} from '../Constants';
import {DateType, FacilityOperatingType, GeneratorShoppingType} from '../Types';
import {getFuelPricesPerMBTU} from '../data/FuelPrices';

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

// CAC $100->150, increasing as you spend more - https://woodlawnassociates.com/electrical-potential-solar-and-competitive-electricity/
export function customersFromMarketingSpend(spend: number) {
  return Math.floor(spend / (100 + spend / 1000000));
}
