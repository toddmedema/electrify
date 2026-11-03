import type { ScenarioType, PolicyId } from "../Types";
import type {
  RuleEvent,
  RuleObjective,
  ScenarioRuleDefinitions,
} from "./ScenarioRules";

export const LEGACY_CAMPAIGN_ID = 117;
export const LEGACY_GENERATION_MONTHS = 240;

export interface LegacyGeneration {
  index: number;
  scenarioId: number;
  startYear: number;
  name: string;
  referenceRate: number;
  /** Authored borrowing allowance per frozen opening MW, in 2023 dollars. */
  readonly debtDollars2023PerMW: number;
}

/** Fictional regional utility. Rates are nominal authoring proxies, not reconstructed tariffs. */
export const LEGACY_GENERATIONS: readonly LegacyGeneration[] = [
  {
    index: 0,
    scenarioId: 117,
    startYear: 1882,
    name: "First Light",
    referenceRate: 0.24,
    debtDollars2023PerMW: 20000000,
  },
  {
    index: 1,
    scenarioId: 118,
    startYear: 1902,
    name: "Beyond the Dynamo",
    referenceRate: 0.1,
    debtDollars2023PerMW: 20000000,
  },
  {
    index: 2,
    scenarioId: 119,
    startYear: 1922,
    name: "Affordable Growth",
    referenceRate: 0.05,
    debtDollars2023PerMW: 20000000,
  },
  {
    index: 3,
    scenarioId: 120,
    startYear: 1942,
    name: "Everybody Plugs In",
    referenceRate: 0.025,
    debtDollars2023PerMW: 30000000,
  },
  {
    index: 4,
    scenarioId: 121,
    startYear: 1962,
    name: "The Power You Don't Build",
    referenceRate: 0.035,
    debtDollars2023PerMW: 30000000,
  },
  {
    index: 5,
    scenarioId: 122,
    startYear: 1982,
    name: "The Price of Power",
    referenceRate: 0.06,
    debtDollars2023PerMW: 20000000,
  },
  {
    index: 6,
    scenarioId: 123,
    startYear: 2002,
    name: "The Sun Moves the Peak",
    referenceRate: 0.1,
    debtDollars2023PerMW: 15000000,
  },
  {
    index: 7,
    scenarioId: 124,
    startYear: 2022,
    name: "Renew the Grid",
    referenceRate: 0.15,
    debtDollars2023PerMW: 15000000,
  },
  {
    index: 8,
    scenarioId: 125,
    startYear: 2042,
    name: "A Different Kind of Growth",
    referenceRate: 0.2,
    debtDollars2023PerMW: 15000000,
  },
];

export function legacyGenerationTitle(generation: LegacyGeneration): string {
  return `${generation.name} (${generation.startYear}–${generation.startYear + LEGACY_GENERATION_MONTHS / 12 - 1})`;
}

export function isLegacyCampaignScenario(id: unknown): id is number {
  return (
    typeof id === "number" &&
    Number.isInteger(id) &&
    id >= LEGACY_CAMPAIGN_ID &&
    id < LEGACY_CAMPAIGN_ID + LEGACY_GENERATIONS.length
  );
}

export const getLegacyGeneration = (
  index: number,
): LegacyGeneration | undefined => LEGACY_GENERATIONS[index];

/** Later portfolios are standalone verification fixtures; handovers never initialize them. */
const portfolios: ScenarioType["facilities"][] = [
  [
    {
      assetId: "legacy-first-steam",
      fuel: "Coal",
      peakW: 100000,
      initialAgeYears: 0,
    },
  ],
  [
    {
      assetId: "legacy-1902-steam",
      fuel: "Coal",
      peakW: 300000,
      initialAgeYears: 5,
    },
  ],
  [
    {
      assetId: "legacy-1922-steam",
      fuel: "Coal",
      peakW: 1000000,
      initialAgeYears: 8,
    },
  ],
  [
    {
      assetId: "legacy-1942-oil",
      fuel: "Oil",
      peakW: 10000000,
      initialAgeYears: 5,
    },
  ],
  [
    {
      assetId: "legacy-1962-oil",
      fuel: "Oil",
      peakW: 50000000,
      initialAgeYears: 8,
    },
  ],
  [
    {
      assetId: "legacy-1982-oil",
      fuel: "Oil",
      peakW: 50000000,
      initialAgeYears: 15,
    },
    {
      assetId: "legacy-1982-gas",
      fuel: "Natural Gas",
      name: "Natural Gas Peaker",
      peakW: 30000000,
      initialAgeYears: 5,
    },
  ],
  [
    {
      assetId: "legacy-2002-gas",
      fuel: "Natural Gas",
      name: "Natural Gas CC",
      peakW: 50000000,
      initialAgeYears: 5,
    },
    {
      assetId: "legacy-2002-wind",
      fuel: "Wind",
      peakW: 20000000,
      initialAgeYears: 5,
    },
  ],
  [
    {
      assetId: "legacy-2022-gas",
      fuel: "Natural Gas",
      name: "Natural Gas CC",
      peakW: 50000000,
      initialAgeYears: 10,
    },
    {
      assetId: "legacy-2022-solar",
      fuel: "Sun",
      peakW: 60000000,
      initialAgeYears: 5,
    },
    {
      assetId: "legacy-2022-battery",
      name: "Battery",
      peakWh: 80000000,
      initialAgeYears: 2,
    },
  ],
  [
    {
      assetId: "legacy-2042-gas",
      fuel: "Natural Gas",
      name: "Natural Gas CC",
      peakW: 25000000,
      initialAgeYears: 10,
    },
    {
      assetId: "legacy-2042-solar",
      fuel: "Sun",
      peakW: 100000000,
      initialAgeYears: 10,
    },
    {
      assetId: "legacy-2042-wind",
      fuel: "Wind",
      peakW: 50000000,
      initialAgeYears: 8,
    },
    {
      assetId: "legacy-2042-battery",
      name: "Battery",
      peakWh: 200000000,
      initialAgeYears: 5,
    },
  ],
];

export const LEGACY_SCENARIOS: ScenarioType[] = LEGACY_GENERATIONS.map(
  (generation) => ({
    id: generation.scenarioId,
    name: legacyGenerationTitle(generation),
    icon:
      generation.index < 3 ? "coal" : generation.index < 6 ? "oil" : "solar",
    locationId: "SF",
    ownership: "Investor",
    startingYear: generation.startYear,
    durationMonths: LEGACY_GENERATION_MONTHS,
    cash: [
      85000, 750000, 2250000, 6750000, 20250000, 60750000, 182250000, 546750000,
      1640250000,
    ][generation.index],
    startingCustomers:
      generation.index === 0
        ? 100
        : [100, 400, 1500, 15000, 50000, 90000, 100000, 150000, 200000][
            generation.index
          ],
    startingDemandScale: generation.index === 0 ? 1.4 : 1,
    dollarsPerkWh: generation.referenceRate,
    feePerKgCO2e: 0,
    intertiesEnabled: generation.startYear >= 1962,
    facilities: portfolios[generation.index],
  }),
);

export interface LegacyRuleContext {
  peakMW: number;
  northCapacityMW: number;
  referenceRate: number;
  debtAllowance: number;
  emissionsBudgetTonnes?: number;
  openingCustomers?: number;
  endMarketCustomers?: number;
}

/**
 * Static readers cannot run the forecast. Their explicitly approximate fixture peak is 70% of
 * non-storage nameplate. Live runs always supply the production forecast's frozen opening peak.
 * Rules use the continuous campaign's 1882 dollar basis; 9.9 is the early modeled CPI anchor.
 * Keep this pure data module free of economy/catalog imports to preserve the startup boundary.
 */
const LEGACY_OPENING_DOLLAR_RATIO = 9.9 / 304.702;
function fixturePeakMW(index: number): number {
  return (
    (LEGACY_SCENARIOS[index].facilities.reduce(
      (watts, facility) =>
        watts + (facility.peakWh === undefined ? (facility.peakW ?? 0) : 0),
      0,
    ) *
      0.7) /
    1000000
  );
}

const growth = (
  id: string,
  startMonth: number,
  multiplier: number,
  durationMonths: number | "untilEnd" = "untilEnd",
): RuleEvent => ({
  id,
  title: "Electricity demand is growing",
  message: `Demand is ${Math.round((multiplier - 1) * 100)}% higher.`,
  preview: `Demand will rise by ${Math.round((multiplier - 1) * 100)}%.`,
  visibility: "forecast",
  startMonth,
  durationMonths,
  effects: { demandMultiplier: multiplier },
});

/** Reuses native effects and objectives; financial baselines are frozen before player actions. */
export function legacyRuleDefinitions(
  index: number,
  supplied?: Partial<LegacyRuleContext>,
): ScenarioRuleDefinitions {
  const generation = LEGACY_GENERATIONS[index];
  if (!generation) throw new Error("Unknown campaign generation");
  const peakMW = supplied?.peakMW ?? fixturePeakMW(index);
  const context: LegacyRuleContext = {
    peakMW,
    northCapacityMW: 0,
    referenceRate: generation.referenceRate,
    debtAllowance:
      peakMW * generation.debtDollars2023PerMW * LEGACY_OPENING_DOLLAR_RATIO,
    ...supplied,
  };
  const featured: RuleObjective[] = [
    {
      id: "first-profitable-year",
      label: "Cover operating costs with electricity revenue in 1885",
      metric: "financialCoverage",
      basis: "revenue",
      minCoverage: 1,
      fromMonth: 37,
      throughMonth: 48,
    },
    {
      id: "grow-the-customer-base",
      label: "Grow the customer base by 1921",
      metric: "customerCount",
      minCustomers: Math.ceil(
        Math.min(
          (context.openingCustomers ??
            LEGACY_SCENARIOS[index].startingCustomers!) * 1.5,
          (context.endMarketCustomers ?? Infinity) * 0.95,
        ),
      ),
      deadlineMonth: 240,
    },
    {
      id: "affordable-service",
      label: "Keep electricity affordable in 1941",
      metric: "monthlyBilledRate",
      fromMonth: 229,
      throughMonth: 240,
      maxDollarsPerKWh: context.referenceRate * 1.1,
    },
    {
      id: "postwar-reserves",
      label: "Keep a 10% opening-peak reserve throughout 1952",
      metric: "reserveMargin",
      minReserveW: context.peakMW * 1e6 * 0.1,
      fromMonth: 121,
      throughMonth: 132,
    },
    {
      id: "efficiency-dividend",
      label:
        "Save 5% of home and business electricity through efficiency in 1981",
      metric: "efficiencySavings",
      minShare: 0.05,
      fromMonth: 229,
      throughMonth: 240,
    },
    {
      id: "crisis-cash-buffer",
      label:
        "Keep one month of operating costs in cash during the energy crisis",
      metric: "financialCoverage",
      basis: "cash",
      minCoverage: 1,
      fromMonth: 223,
      throughMonth: 240,
    },
    {
      id: "serve-the-evening-peak",
      label: "Serve 99.5% of evening demand in 2019–2021",
      metric: "demandServedShare",
      hours: [17, 21],
      minShare: 0.995,
      fromMonth: 205,
      throughMonth: 240,
    },
    {
      id: "renew-the-oil-fleet",
      label: "Retire oil equipment commissioned through 2000 by 2035",
      metric: "fuelRetirement",
      fuel: "Oil",
      commissionedBeforeYear: 2001,
      deadlineMonth: 168,
    },
    {
      id: "generation-carbon-budget",
      label: "Stay within this term’s cumulative emissions budget",
      metric: "emissionsBudget",
      fromMonth: 1,
      throughMonth: 240,
      budgetTonnesCO2e: context.emissionsBudgetTonnes ?? context.peakMW * 21900,
    },
  ];
  const objectives: RuleObjective[] = [
    featured[index],
    {
      id: "retain-customers",
      label: "Retain 90% of opening customers",
      metric: "customerRetention",
      minRetainedShare: 0.9,
      deadlineMonth: 240,
    },
  ];
  if (index >= 1)
    objectives.push({
      id: "funded-expansion",
      label: "Keep debt within the published allowance",
      metric: "monthEndDebt",
      fromMonth: 229,
      throughMonth: 240,
      maxDebtDollars: context.debtAllowance,
    });
  if (index >= 3)
    objectives.push({
      id: "affordable-service",
      label: "Keep billed electricity affordable",
      metric: "monthlyBilledRate",
      fromMonth: 229,
      throughMonth: 240,
      maxDollarsPerKWh: context.referenceRate * 1.35,
    });
  if (index >= 6)
    objectives.push({
      id: "clean-electricity",
      label: "Reduce emissions per delivered MWh",
      metric: "emissionsPerDeliveredMWh",
      fromMonth: 217,
      throughMonth: 240,
      maxKgCO2ePerMWh: index === 6 ? 350 : index === 7 ? 200 : 100,
    });
  if (index === 8) {
    objectives.push({
      id: "2045-milestone",
      label: "Reach the 2045 electricity emissions milestone",
      metric: "emissionsPerDeliveredMWh",
      fromMonth: 37,
      throughMonth: 48,
      maxKgCO2ePerMWh: 100,
    });
  }
  const events: RuleEvent[] = [];
  switch (index) {
    case 0:
      events.push(
        growth("first-growth", 25, 1.35),
        growth("hydro-era-growth", 169, 1.5),
      );
      events.push({
        id: "hydro-opportunity",
        title: "River power is available",
        message:
          "A small hydro site is now available. Compare its construction cost with your coal bill.",
        preview: "A small hydro site will become available in 1895.",
        visibility: "forecast",
        startMonth: 157,
      });
      break;
    case 1:
    case 3:
      events.push(
        growth("growth-first-decade", 61, 1.15, 60),
        growth("growth-second-decade", 121, 1.35, 120),
      );
      break;
    case 2:
      events.push(
        growth("affordable-growth-one", 25, 1.15),
        growth("affordable-growth-two", 61, 1.15),
      );
      break;
    case 4:
      events.push({
        id: "oil-shock-1973",
        title: "Oil prices rise",
        message:
          "The 1973 oil shock raises the cost of oil-fired electricity. Efficiency can reduce the fuel you need.",
        startMonth: 133,
      });
      events.push({
        id: "oil-shock-1979",
        title: "Another oil shock",
        message:
          "Oil prices rise again. Your earlier efficiency and supply decisions now matter.",
        startMonth: 205,
      });
      break;
    case 5:
      events.push({
        id: "regional-squeeze",
        title: "Regional imports are constrained",
        message:
          "Regional supply is tight. Available northern imports are limited through the end of this term.",
        preview: "Northern imports will be constrained from July 2000.",
        visibility: "forecast",
        startMonth: 223,
        durationMonths: 18,
        effects: {
          transmissionCapacityLimitsMWByCorridor: {
            "california-north": Math.min(
              context.northCapacityMW,
              0.1 * context.peakMW,
            ),
          },
        },
        endMessage: "The regional supply restriction has ended.",
      });
      break;
    case 6:
      events.push(growth("clean-era-growth", 109, 1.1));
      events.push({
        id: "bootleg-fire",
        title: "Wildfire cuts northern imports",
        message: `Northern imports are limited to ${Math.round(context.northCapacityMW * 0.25 * 100) / 100} MW through August. This regional limit is fixed from the term's opening allocation. Use local supply, storage, or another connection.`,
        preview:
          "Northern imports will be restricted during July and August 2021. This advance warning is a gameplay allowance.",
        visibility: "forecast",
        startMonth: 235,
        durationMonths: 2,
        effects: {
          transmissionCapacityLimitsMWByCorridor: {
            "california-north": context.northCapacityMW * 0.25,
          },
        },
        endMessage: "Northern import capacity is restored.",
      });
      break;
    case 7:
      events.push(
        growth("electrification-first", 97, 1.15, 72),
        growth("electrification-second", 169, 1.3),
      );
      events.push({
        id: "aging-oil",
        title: "Old oil plants lose output",
        message:
          "Oil plants at least 30 years old are down to 60% output. Newer and replacement equipment is unaffected.",
        preview: "Oil plants at least 30 years old will lose output in 2030.",
        visibility: "forecast",
        startMonth: 97,
        durationMonths: "untilEnd",
        effects: {
          outputMultipliersBySelector: [
            {
              target: {
                selector: "operatingAtLeastAge",
                fuel: "Oil",
                minAgeYears: 30,
              },
              outputMultiplier: 0.6,
            },
          ],
        },
      });
      break;
    case 8:
      events.push(
        growth("future-growth-one", 61, 1.15, 60),
        growth("future-growth-two", 121, 1.3),
      );
      // Reapply the inherited 2030 condition after term-local event receipts reset.
      // Age 42 in 2042 preserves the original commissioning cutoff of 2000.
      events.push({
        id: "inherited-aging-oil",
        title: "Old oil plants retain reduced output",
        message:
          "Oil plants commissioned by 2000 remain at 60% output. Newer equipment is unaffected.",
        visibility: "forecast",
        startMonth: 1,
        durationMonths: "untilEnd",
        effects: {
          outputMultipliersBySelector: [
            {
              target: {
                selector: "operatingAtLeastAge",
                fuel: "Oil",
                minAgeYears: 42,
              },
              outputMultiplier: 0.6,
            },
          ],
        },
      });
      break;
  }
  return {
    events,
    objectives,
    debriefReports: [
      {
        id: "generation-service",
        kind: "reliability",
        fromMonth: 229,
        throughMonth: 240,
      },
      {
        id: "generation-finances",
        kind: "profitLoss",
        fromMonth: 238,
        throughMonth: 240,
      },
      ...(index === 0
        ? [
            {
              id: "first-years-service",
              kind: "reliability" as const,
              fromMonth: 25,
              throughMonth: 36,
            },
            {
              id: "first-years-finances",
              kind: "profitLoss" as const,
              fromMonth: 34,
              throughMonth: 36,
            },
          ]
        : []),
      ...(index === 6
        ? [
            {
              id: "fire-service",
              kind: "reliability" as const,
              fromMonth: 235,
              throughMonth: 236,
            },
          ]
        : []),
    ],
  };
}

/** Dates gate the existing programs in UI, reducer commands, and forecasts alike. */
export function legacyPolicyAllowed(
  scenarioId: number,
  id: PolicyId,
  year: number,
): boolean {
  if (!isLegacyCampaignScenario(scenarioId)) return true;
  switch (id) {
    case "efficiency":
      return year >= 1973;
    case "curtailment":
      return year >= 1973;
    case "timeOfUse":
      return year >= 1982;
    case "solar":
      return year >= 2000;
    case "thermal":
      return year >= 2000;
    case "evCharging":
      return year >= 2010;
    case "battery":
      return year >= 2015;
  }
}
