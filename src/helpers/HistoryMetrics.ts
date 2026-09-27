import numbro from "numbro";
import { DerivedHistoryType, UnitSystemType } from "../Types";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWattHours,
} from "./Format";
import {
  formatLargeMassValue,
  formatLargeMassValueConcise,
  largeMassUnit,
  massUnit,
  toDisplayMass,
} from "./Units";

/**
 * The monthly history metrics a player can read back, in the order the summary table lists
 * them. Breakdowns follow the total they break down, which `nesting` indents.
 */
export const HISTORY_METRIC_KEYS = [
  "profit",
  "profitPerkWh",
  "revenue",
  "revenuePerkWh",
  "supplyWh",
  "demandWh",
  "customers",
  "expenses",
  "expensesFuel",
  "expensesOM",
  "expensesPolicy",
  "expensesInterest",
  "interestRate",
  "expensesCarbonFee",
  "kgco2e",
  "kgco2ePerMWh",
  "netWorth",
  "cash",
  "inflationRate",
] as const satisfies readonly (keyof DerivedHistoryType)[];

export type HistoryMetricKeyType = (typeof HISTORY_METRIC_KEYS)[number];

export interface HistoryMetricType {
  label: string;
  format: (n: number) => string;
  formatTable?: (n: number) => string; // if different than chart formatting
  suffix?: string;
  nesting?: number; // default 0 / unnested
  /**
   * Which direction of a change is good news. Left unset for metrics such as inflation that are
   * neither good nor bad.
   */
  higherIsBetter?: boolean;
}

const money = {
  format: formatMoneyConcise,
  formatTable: formatMoneyStable,
};

// Only the two emissions rows care which unit system they are read in
export function historyMetrics(
  units: UnitSystemType,
): Record<HistoryMetricKeyType, HistoryMetricType> {
  return {
    profit: { label: "Profit", higherIsBetter: true, ...money },
    profitPerkWh: {
      label: "Profit per kWh",
      higherIsBetter: true,
      ...money,
      suffix: "/kWh",
      nesting: 1,
    },
    revenue: { label: "Revenue", higherIsBetter: true, ...money },
    revenuePerkWh: {
      label: "Revenue per kWh",
      higherIsBetter: true,
      ...money,
      suffix: "/kWh",
      nesting: 1,
    },
    supplyWh: {
      label: "Electricity sold",
      higherIsBetter: true,
      format: (n: number) => formatWattHours(n, 0),
      nesting: 1,
    },
    demandWh: {
      label: "Demand",
      higherIsBetter: true,
      format: (n: number) => formatWattHours(n, 0),
    },
    customers: {
      label: "Customers",
      higherIsBetter: true,
      format: (n: number) => numbro(n).format({ average: true }),
      nesting: 1,
    },
    expenses: { label: "Expenses", higherIsBetter: false, ...money },
    expensesFuel: {
      label: "Fuel",
      higherIsBetter: false,
      ...money,
      nesting: 1,
    },
    expensesOM: {
      label: "Operations & maintenance",
      higherIsBetter: false,
      ...money,
      nesting: 1,
    },
    expensesPolicy: {
      label: "Customer programs",
      higherIsBetter: false,
      ...money,
      nesting: 1,
    },
    expensesInterest: {
      label: "Loan interest",
      higherIsBetter: false,
      ...money,
      nesting: 1,
    },
    interestRate: {
      label: "Interest rate",
      higherIsBetter: false,
      format: (n: number) => `${(n * 100).toFixed(2)}%`,
      nesting: 2,
    },
    expensesCarbonFee: {
      label: "Carbon fees",
      higherIsBetter: false,
      ...money,
      nesting: 1,
    },
    kgco2e: {
      label: "CO2e emitted",
      higherIsBetter: false,
      format: (n: number) => formatLargeMassValueConcise(n, units),
      formatTable: (n: number) => formatLargeMassValue(n, units),
      suffix: largeMassUnit(units),
      nesting: 2,
    },
    kgco2ePerMWh: {
      label: "Emissions per MWh",
      higherIsBetter: false,
      format: (n: number) =>
        numbro(toDisplayMass(n, units)).format({
          thousandSeparated: true,
          mantissa: 0,
        }),
      suffix: `${massUnit(units)}/MWh`,
      nesting: 2,
    },
    netWorth: { label: "Net worth", higherIsBetter: true, ...money },
    cash: {
      label: "Cash",
      higherIsBetter: true,
      ...money,
      nesting: 1,
    },
    inflationRate: {
      label: "Inflation",
      format: (n: number) => `${(n * 100).toFixed(1)}%`,
    },
  };
}

/**
 * The useful part of the customer forecast is its change, not its resulting total. At large
 * customer counts, formatting both totals compactly can turn `1m -> 1m` and hide the effect.
 */
export function formatCustomerChange(
  change: number,
  customers: number,
): string {
  const formattedChange = numbro(Math.abs(change)).format({
    average: true,
    mantissa: 1,
    trimMantissa: true,
  });
  const percent =
    customers > 0
      ? ` (${change >= 0 ? "+" : "-"}${((Math.abs(change) / customers) * 100).toFixed(1)}%)`
      : "";
  return `${change >= 0 ? "+" : "-"}${formattedChange}${percent}`;
}
