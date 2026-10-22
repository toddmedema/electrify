import type { RuleObjective } from "../data/ScenarioRules";
import { RULE_LIMITS } from "../helpers/ScenarioRulesSchema";
import type { ModPackage } from "../mods/ModSchema";

export const MOD_PERF_MONTHS = 1200;

/** Maximum definition counts, with legal overlapping neutral effects rather than impossible maxima. */
export function maximumRulePackage(): ModPackage {
  const window = { fromMonth: 1, throughMonth: MOD_PERF_MONTHS };
  type Specification<T> = T extends unknown ? Omit<T, "id" | "label"> : never;
  const kinds: Specification<RuleObjective>[] = [
    { ...window, metric: "monthlyReliability", minDemandServedShare: 0 },
    {
      metric: "customerRetention",
      minRetainedShare: 0,
      deadlineMonth: MOD_PERF_MONTHS,
    },
    { ...window, metric: "emissionsBudget", budgetTonnesCO2e: 1e12 },
    { ...window, metric: "emissionsPerDeliveredMWh", maxKgCO2ePerMWh: 1e6 },
    {
      ...window,
      metric: "localFuelShare",
      fuels: ["Natural Gas"],
      minShare: 0,
    },
    { metric: "fuelRetirement", fuel: "Coal", deadlineMonth: MOD_PERF_MONTHS },
    { ...window, metric: "monthlyBilledRate", maxDollarsPerKWh: 100 },
    { ...window, metric: "monthEndDebt", maxDebtDollars: 1e12 },
  ];
  return {
    schemaVersion: 1,
    gameApi: 1,
    id: "maximum-rule-benchmark",
    title: "Maximum rule benchmark",
    creator: "Electrify benchmarks",
    version: "1",
    description: "A deterministic stress workload, not a balanced challenge.",
    seed: 605,
    baseScenarioId: 999,
    officialArcs: [],
    scenario: {
      startingYear: 2020,
      durationMonths: MOD_PERF_MONTHS,
      startingCustomers: 1000,
      cash: 1e12,
      dollarsPerkWh: 0.1,
    },
    events: Array.from({ length: RULE_LIMITS.events }, (_, index) => ({
      id: `event-${index}`,
      title: `Operating agreement ${index}`,
      message: "The operating agreement is in effect.",
      preview: "The operating agreement will take effect.",
      startMonth: 1,
      durationMonths: "untilEnd",
      effects: {
        demandMultiplier: 1,
        hydroInflowMultiplier: 1,
        fuelPriceMultipliers: { "Natural Gas": 1 },
        constructionCostMultipliersByFuel: { "Natural Gas": 1 },
        operatingCostMultipliersByFuel: { "Natural Gas": 1 },
        outputMultipliersBySelector: [
          {
            target: { selector: "largestOperating", fuel: "Natural Gas" },
            outputMultiplier: 1,
          },
        ],
        transactions: [{ kind: "grant", amountDollars: 1 }],
      },
      loads: Array.from({ length: RULE_LIMITS.loadsPerEvent }, (_, load) => ({
        id: `load-${index}-${load}`,
        startMonth: 1,
        demandType: "Data Centers",
        loadFactor: 0.5,
        peakMW: 0.001,
      })),
    })),
    choices: Array.from({ length: RULE_LIMITS.choices }, (_, index) => ({
      id: `choice-${index}`,
      dueMonth: 1,
      title: `Operating decision ${index}`,
      prompt: "Choose an operating agreement.",
      options: Array.from({ length: RULE_LIMITS.options }, (_, option) => ({
        id: `option-${option}`,
        label: `Agreement ${option}`,
        description: "Keep the same operating terms.",
        message: "The agreement is accepted.",
        costDollars: 0,
      })),
    })),
    objectives: {
      mode: "replace",
      items: Array.from({ length: RULE_LIMITS.objectives }, (_, index) => ({
        ...kinds[index % kinds.length],
        id: `objective-${index}`,
        label: `Benchmark objective ${index}`,
        required: false,
      })) as RuleObjective[],
    },
  };
}
