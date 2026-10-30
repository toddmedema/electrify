import { OFFICIAL_EFFECT_SCENARIO_RULES } from "./OfficialScenarioEffectRules";
import { OFFICIAL_TARGET_SCENARIO_RULES } from "./OfficialScenarioTargetRules";
import type { DifficultyType, StoryAttributeValueType } from "../Types";
import type {
  CompiledRuleEvent,
  RuleNumber,
  RuleReport,
  ScenarioRuleDefinitions,
} from "./ScenarioRules";

export interface OfficialRulePresentation {
  messageByDifficulty?: Record<DifficultyType, string>;
  titleByDifficulty?: Record<DifficultyType, string>;
  previewTitle?: string;
  hidePreview?: true;
  attributes?: Record<string, StoryAttributeValueType>;
  attributesByDifficulty?: Record<
    DifficultyType,
    Record<string, StoryAttributeValueType>
  >;
  nativeReview?:
    | "shaleNormalization"
    | "paradiseReview"
    | "renewablesReview"
    | "deepFreezeThaw"
    | "deepFreezeOnset"
    | "agingWarning"
    | "agingDerate"
    | "coalTransitionReview"
    | "hurricaneOutlook"
    | "hurricaneLandfall"
    | "hurricaneRestoration"
    | "nuclearContingency"
    | "nuclearTrip";
  protection?: CompiledRuleEvent["protection"];
  reports?: RuleReport[];
  relativeReports?: Array<{
    id: string;
    kind: "reliability";
    monthsBefore: RuleNumber;
    minDemandServedShare?: number;
  }>;
  scheduleRandomKey?: string;
  scheduleAddress?: string;
  scheduleOffsetMonths?: RuleNumber;
  source: Omit<
    NonNullable<CompiledRuleEvent["source"]>,
    "scenarioId" | "arcId" | "phaseId"
  >;
}
export interface OfficialScenarioRuleDefinition {
  scenarioId: number;
  arcId: string;
  definitions: ScenarioRuleDefinitions;
  presentation: Record<string, OfficialRulePresentation>;
}

export interface LoadSheddingBalanceType {
  /** Share of nominal coal output still available, year by year from 2019 to 2022. */
  coalOutputMultipliers: [number, number, number, number];
  /** Coal operating cost, which rises with the breakdowns and the running repairs. */
  coalOperatingMultipliers: [number, number, number, number];
  /** Diesel is what covers the gap, and it is bought at short notice. */
  dieselPriceMultipliers: [number, number, number, number];
}

// Eskom's energy availability factor fell from 78% in 2018 to about 58% in 2022, with unplanned
// outages roughly doubling over the same period. These multiply nameplate output, so Employee is
// set to the published EAF itself - 67, 65, 62 and 58 percent - and the other difficulties sit
// either side of the record. Anything shallower leaves the fleet able to carry the load on its
// own, which is the one thing the years these steps describe were not.
// https://www.eskom.co.za/dataportal/supply-side/eaf-weekly-data/
export const LOAD_SHEDDING_BALANCE: Record<
  DifficultyType,
  LoadSheddingBalanceType
> = {
  Intern: {
    coalOutputMultipliers: [0.74, 0.72, 0.7, 0.68],
    coalOperatingMultipliers: [1.05, 1.1, 1.15, 1.2],
    dieselPriceMultipliers: [1.05, 1.1, 1.15, 1.2],
  },
  Employee: {
    coalOutputMultipliers: [0.67, 0.65, 0.62, 0.58],
    coalOperatingMultipliers: [1.08, 1.16, 1.24, 1.32],
    dieselPriceMultipliers: [1.1, 1.2, 1.3, 1.4],
  },
  Manager: {
    coalOutputMultipliers: [0.64, 0.61, 0.57, 0.53],
    coalOperatingMultipliers: [1.1, 1.2, 1.3, 1.45],
    dieselPriceMultipliers: [1.15, 1.3, 1.45, 1.6],
  },
  VP: {
    coalOutputMultipliers: [0.61, 0.57, 0.52, 0.47],
    coalOperatingMultipliers: [1.12, 1.26, 1.4, 1.55],
    dieselPriceMultipliers: [1.2, 1.4, 1.6, 1.8],
  },
  CEO: {
    coalOutputMultipliers: [0.58, 0.53, 0.47, 0.42],
    coalOperatingMultipliers: [1.15, 1.32, 1.5, 1.7],
    dieselPriceMultipliers: [1.25, 1.5, 1.75, 2],
  },
};

const difficultyValues = (
  field: keyof LoadSheddingBalanceType,
  step: number,
) => ({
  byDifficulty: Object.fromEntries(
    Object.entries(LOAD_SHEDDING_BALANCE).map(([difficulty, values]) => [
      difficulty,
      values[field][step],
    ]),
  ) as Record<DifficultyType, number>,
});

/** Trusted plain data: the pilot and imported arc consume this same contract. */
export const LOAD_SHEDDING_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 113,
  arcId: "load-shedding",
  definitions: {
    events: [
      {
        id: "maintenance-backlog",
        title: "The maintenance backlog is growing",
        message:
          "Coal output falling each year. Build replacement capacity before shortages begin.",
        startMonth: 7,
        visibility: "forecast",
      },
      ...([13, 25, 37, 49] as const).map((startMonth, step) => ({
        id: `availability-step-${step + 1}`,
        title: [
          "Breakdowns outpace repairs",
          "Another station derated",
          "The fleet is running on borrowed time",
          "Availability at its lowest",
        ][step],
        message: "Coal output falls.",
        startMonth,
        durationMonths: 12,
        visibility: "forecast" as const,
        preview:
          step === 0
            ? "Coal output decreasing."
            : "Coal output decreasing further.",
        effects: {
          outputMultipliersByFuel: {
            Coal: difficultyValues("coalOutputMultipliers", step),
          },
          operatingCostMultipliersByFuel: {
            Coal: difficultyValues("coalOperatingMultipliers", step),
          },
          fuelPriceMultipliers: {
            Oil: difficultyValues("dieselPriceMultipliers", step),
          },
        },
      })),
    ],
    objectives: [],
  },
  presentation: {
    "maintenance-backlog": {
      source: {
        kind: "WORLD_EVENT",
        concept: "forecast",
        importance: "NOTABLE",
        actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
      },
    },
    ...Object.fromEntries(
      [0, 1, 2, 3].map((step) => [
        `availability-step-${step + 1}`,
        {
          messageByDifficulty: Object.fromEntries(
            Object.entries(LOAD_SHEDDING_BALANCE).map(
              ([difficulty, values]) => [
                difficulty,
                `Coal output is down to ${Math.round(values.coalOutputMultipliers[step] * 100)}%.`,
              ],
            ),
          ) as Record<DifficultyType, string>,
          previewTitle: [
            "Breakdowns outpacing repairs",
            "Another station facing output limits",
            "Fleet reliability declining further",
            "Coal availability reaching a low",
          ][step],
          source: {
            kind: "WORLD_EVENT" as const,
            concept: "fuel" as const,
            importance:
              step >= 2 ? ("CRITICAL" as const) : ("NOTABLE" as const),
            actionTarget: {
              card: "FACILITIES" as const,
              view: "FLEET" as const,
            },
            turningPointPriority: 100 + step,
          },
        },
      ]),
    ),
  },
};

export const OFFICIAL_SCENARIO_RULES: readonly OfficialScenarioRuleDefinition[] =
  [
    LOAD_SHEDDING_RULES,
    // Portfolio ownership has no global shock to transplant into another grid.
    {
      scenarioId: 116,
      arcId: "utility-expansion",
      definitions: { events: [], objectives: [] },
      presentation: {},
    },
    ...OFFICIAL_EFFECT_SCENARIO_RULES,
    ...OFFICIAL_TARGET_SCENARIO_RULES,
  ];
export const officialScenarioRuleDefinition = (scenarioId: number) =>
  OFFICIAL_SCENARIO_RULES.find((entry) => entry.scenarioId === scenarioId);

/** Catalog setup keeps the shared goal's display value without a second threshold. */
export function officialRetentionMetadata(
  scenarioId: number,
): number | undefined {
  const goal = officialScenarioRuleDefinition(
    scenarioId,
  )?.definitions.objectives.find(
    (objective) => objective.metric === "customerRetention",
  );
  return goal?.metric === "customerRetention"
    ? goal.minRetainedShare
    : undefined;
}
