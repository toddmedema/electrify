import type { WorldEventEffectsType } from "../Types";

/** Mechanical conditions share one formatter across legacy imports and frozen live rules. */
export function scenarioEffectsSummary(
  effects: WorldEventEffectsType,
): string[] {
  const changes: string[] = [];
  if (effects.demandMultiplier !== undefined)
    changes.push(
      `Demand: ${Math.round(effects.demandMultiplier * 100)}% of normal`,
    );
  if (effects.temperatureOffsetC)
    changes.push(
      `Temperature: ${effects.temperatureOffsetC > 0 ? "+" : ""}${effects.temperatureOffsetC}°C`,
    );
  if (effects.hydroRunoffMultiplier !== undefined)
    changes.push(
      `Hydro inflow: ${Math.round(effects.hydroRunoffMultiplier * 100)}% of normal`,
    );
  if (effects.operatingExpensePerMonth)
    changes.push(
      `Restoration: $${Math.round(effects.operatingExpensePerMonth).toLocaleString("en-US")}/month`,
    );
  for (const [label, values] of [
    ["fuel price", effects.fuelPriceMultipliers],
    ["construction cost", effects.buildCostMultipliersByFuel],
    ["operating cost", effects.operatingCostMultipliersByFuel],
    ["output", effects.facilityOutputMultipliersByFuel],
  ] as const) {
    Object.entries(values || {}).forEach(([fuel, value]) =>
      changes.push(`${fuel} ${label}: ${Math.round(value! * 100)}% of normal`),
    );
  }
  if (
    effects.facilityOutputMultipliersById &&
    Object.keys(effects.facilityOutputMultipliersById).length
  )
    changes.push("Affected generators have reduced output");
  if (effects.carbonFeePerKgCO2e !== undefined)
    changes.push(
      `Carbon fee: $${Math.round(effects.carbonFeePerKgCO2e * 1000)}/tonne`,
    );
  return changes;
}
