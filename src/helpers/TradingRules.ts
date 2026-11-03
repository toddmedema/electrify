import {
  BUYING_RULES,
  BuyingRuleType,
  SELLING_RULES,
  SellingRuleType,
  GeneratorOperatingType,
  FuelPricesType,
} from "../Types";
import { feeableKgCO2ePerBtu } from "../Constants";

export const BUYING_LABELS: Record<BuyingRuleType, string> = {
  NONE: "None",
  SHORTAGES: "Shortages only",
  SHORTAGES_AND_STORAGE: "Shortages + Charging",
};
export const SELLING_LABELS: Record<SellingRuleType, string> = {
  NONE: "None",
  SURPLUS: "Surplus only",
  PROFITABLE: "All profitable",
};

export function isBuyingRule(value: unknown): value is BuyingRuleType {
  return BUYING_RULES.some((rule) => rule === value);
}
export function isSellingRule(value: unknown): value is SellingRuleType {
  return SELLING_RULES.some((rule) => rule === value);
}

/** Added operating cost only; fixed O&M, construction and already-paid starts are sunk. */
export function incrementalGenerationCostPerMWh(
  generator: Pick<
    GeneratorOperatingType,
    "fuel" | "btuPerWh" | "variableOperatingCostPerMWh"
  >,
  prices: FuelPricesType,
  carbonFee: number,
  operatingEscalation: number,
  operatingMultiplier: number,
): number {
  return (
    (generator.variableOperatingCostPerMWh || 0) *
      operatingEscalation *
      operatingMultiplier +
    (generator.btuPerWh || 0) *
      ((prices[generator.fuel] || 0) +
        feeableKgCO2ePerBtu(generator.fuel) * carbonFee * 1e6)
  );
}
