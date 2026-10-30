import { DIFFICULTY_IDS } from "../Constants";
import type {
  DifficultyType,
  StoryActionTargetType,
  StoryAttributeValueType,
} from "../Types";
import { buildLeadTimeHint } from "../helpers/BuildLeadTime";
import type { RuleNumber } from "./ScenarioRules";
import type { OfficialScenarioRuleDefinition } from "./OfficialScenarioRules";

export interface HurricaneBalanceType {
  severity: string;
  targetCapacityShare: number;
  outputMultiplier: number;
  durationMonths: number;
  oilMultiplier: number;
}

export const HURRICANE_BALANCE: Record<DifficultyType, HurricaneBalanceType> = {
  Intern: {
    severity: "Limited",
    targetCapacityShare: 0.15,
    outputMultiplier: 0.8,
    durationMonths: 2,
    oilMultiplier: 1.15,
  },
  Employee: {
    severity: "Moderate",
    targetCapacityShare: 0.2,
    outputMultiplier: 0.7,
    durationMonths: 3,
    oilMultiplier: 1.25,
  },
  Manager: {
    severity: "Major",
    targetCapacityShare: 0.3,
    outputMultiplier: 0.6,
    durationMonths: 4,
    oilMultiplier: 1.4,
  },
  VP: {
    severity: "Severe",
    targetCapacityShare: 0.4,
    outputMultiplier: 0.5,
    durationMonths: 5,
    oilMultiplier: 1.5,
  },
  CEO: {
    severity: "Extreme",
    targetCapacityShare: 0.6,
    outputMultiplier: 0.1,
    durationMonths: 6,
    oilMultiplier: 1.6,
  },
};

export interface EndOfEraBalanceType {
  oldCoalOutput: number;
  coalOM: number;
  complianceCoalOutput: number;
}

export const END_OF_ERA_BALANCE: Record<DifficultyType, EndOfEraBalanceType> = {
  Intern: { oldCoalOutput: 0.9, coalOM: 1.1, complianceCoalOutput: 1 },
  Employee: {
    oldCoalOutput: 0.875,
    coalOM: 1.15,
    complianceCoalOutput: 0.9,
  },
  Manager: {
    oldCoalOutput: 0.85,
    coalOM: 1.2,
    complianceCoalOutput: 0.75,
  },
  VP: { oldCoalOutput: 0.825, coalOM: 1.25, complianceCoalOutput: 0.5 },
  CEO: { oldCoalOutput: 0.8, coalOM: 1.3, complianceCoalOutput: 0.001 },
};

const FLEET_TARGET: StoryActionTargetType = {
  card: "FACILITIES",
  view: "FLEET",
};
const GENERATOR_TARGET: StoryActionTargetType = {
  card: "FACILITIES",
  view: "BUILD_GENERATORS",
};
const SUPPLY_DEMAND_TARGET: StoryActionTargetType = {
  card: "INSIGHTS",
  layer: "SUPPLY_DEMAND",
};

const byDifficulty = <T>(
  values: Record<DifficultyType, T>,
  read: (value: T, difficulty: DifficultyType) => number,
): RuleNumber => ({
  byDifficulty: Object.fromEntries(
    Object.entries(values).map(([difficulty, value]) => [
      difficulty,
      read(value, difficulty as DifficultyType),
    ]),
  ) as Record<DifficultyType, number>,
});
const copyByDifficulty = <T>(
  values: Record<DifficultyType, T>,
  read: (value: T, difficulty: DifficultyType) => string,
): Record<DifficultyType, string> =>
  Object.fromEntries(
    Object.entries(values).map(([difficulty, value]) => [
      difficulty,
      read(value, difficulty as DifficultyType),
    ]),
  ) as Record<DifficultyType, string>;
const attributesByDifficulty = <T>(
  values: Record<DifficultyType, T>,
  read: (value: T) => Record<string, StoryAttributeValueType>,
): Record<DifficultyType, Record<string, StoryAttributeValueType>> =>
  Object.fromEntries(
    Object.entries(values).map(([difficulty, value]) => [
      difficulty,
      read(value),
    ]),
  ) as Record<DifficultyType, Record<string, StoryAttributeValueType>>;
const percent = (value: number) =>
  `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;

/** All operating old coal plants are selected at onset, rather than a fixed count of units. */
export const END_OF_ERA_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 102,
  arcId: "coal-transition",
  definitions: {
    events: [
      {
        id: "aging-warning",
        title: "Aging coal warning",
        message:
          "Coal plants that reach 30 years of age in two years will face a temporary output limit. Prepare replacement power.",
        startMonth: 49,
        visibility: "forecast",
      },
      {
        id: "aging-derate",
        title: "Aging coal slowdown",
        message:
          "Operating coal plants at least 30 years old temporarily produce less power.",
        startMonth: 73,
        durationMonths: 24,
        preview: "Aging coal plants will produce less power.",
        effects: {
          outputMultipliersBySelector: [
            {
              target: {
                selector: "operatingAtLeastAge",
                fuel: "Coal",
                minAgeYears: 30,
              },
              outputMultiplier: byDifficulty(
                END_OF_ERA_BALANCE,
                (balance) => balance.oldCoalOutput,
              ),
            },
          ],
        },
        report: {
          id: "aging-derate-affected",
          kind: "affectedFacilities",
          eventId: "aging-derate",
        },
      },
      {
        id: "compliance-warning",
        title: "New coal rules announced",
        message: "Coal running costs will rise.",
        startMonth: 131,
        visibility: "forecast",
      },
      {
        id: "aging-restoration",
        title: "Aging slowdown ends",
        message: "Older coal plants return to full output.",
        startMonth: 97,
        preview: "Temporary limits on older coal plants will lift.",
      },
      {
        id: "compliance",
        title: "New coal rules begin",
        message: "Coal running costs rise and output is limited.",
        startMonth: 181,
        durationMonths: 60,
        preview: "Coal plants will cost more to run and produce less power.",
        effects: {
          operatingCostMultipliersByFuel: {
            Coal: byDifficulty(END_OF_ERA_BALANCE, (balance) => balance.coalOM),
          },
          outputMultipliersByFuel: {
            Coal: byDifficulty(
              END_OF_ERA_BALANCE,
              (balance) => balance.complianceCoalOutput,
            ),
          },
        },
      },
      {
        id: "successor-review",
        title: "New-grid check-in",
        message:
          "Review the grid's recorded results for the previous twelve months.",
        startMonth: 217,
        preview: "The move away from coal will be assessed.",
      },
    ],
    objectives: [
      {
        id: "retention",
        label: "Retain the community",
        metric: "customerRetention",
        deadlineMonth: 240,
        minRetainedShare: 0.8,
      },
    ],
  },
  presentation: {
    "aging-warning": {
      nativeReview: "agingWarning",
      hidePreview: true,
      source: {
        kind: "WORLD_EVENT",
        concept: "generator",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
      },
    },
    "aging-derate": {
      nativeReview: "agingDerate",
      previewTitle: "Older coal output falling",
      attributesByDifficulty: Object.fromEntries(
        Object.entries(END_OF_ERA_BALANCE).map(([difficulty, balance]) => [
          difficulty,
          { outputMultiplier: balance.oldCoalOutput },
        ]),
      ) as Record<DifficultyType, { outputMultiplier: number }>,
      source: {
        kind: "WORLD_EVENT",
        concept: "generator",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
      },
    },
    "compliance-warning": {
      hidePreview: true,
      messageByDifficulty: copyByDifficulty(
        END_OF_ERA_BALANCE,
        (balance) =>
          `Coal running costs rising ${Math.round((balance.coalOM - 1) * 100)}% in January 1995.`,
      ),
      source: {
        kind: "WORLD_EVENT",
        concept: "danger",
        importance: "NOTABLE",
        actionTarget: GENERATOR_TARGET,
      },
    },
    "aging-restoration": {
      previewTitle: "Older coal output recovering",
      source: {
        kind: "WORLD_EVENT",
        concept: "supply",
        importance: "ROUTINE",
        actionTarget: FLEET_TARGET,
      },
    },
    compliance: {
      previewTitle: "Coal rules tightening",
      messageByDifficulty: copyByDifficulty(
        END_OF_ERA_BALANCE,
        ({ coalOM, complianceCoalOutput }) =>
          `Coal running costs rise ${Math.round((coalOM - 1) * 100)}%; output is limited to ${percent(complianceCoalOutput)}.`,
      ),
      attributesByDifficulty: Object.fromEntries(
        Object.entries(END_OF_ERA_BALANCE).map(([difficulty, balance]) => [
          difficulty,
          {
            coalOM: balance.coalOM,
            complianceCoalOutput: balance.complianceCoalOutput,
          },
        ]),
      ) as Record<
        DifficultyType,
        { coalOM: number; complianceCoalOutput: number }
      >,
      source: {
        kind: "WORLD_EVENT",
        concept: "danger",
        importance: "CRITICAL",
        actionTarget: GENERATOR_TARGET,
        turningPointPriority: 100,
      },
    },
    "successor-review": {
      nativeReview: "coalTransitionReview",
      reports: [
        {
          id: "arc-102-successor-review-fuel-mix",
          kind: "fuelMix",
          fromMonth: 205,
          throughMonth: 216,
          fuels: ["Coal"],
          basis: "customerDemand",
        },
        {
          id: "arc-102-successor-review-reliability",
          kind: "reliability",
          fromMonth: 205,
          throughMonth: 216,
          minDemandServedShare: 0.999,
        },
        {
          id: "arc-102-successor-review-profit-loss",
          kind: "profitLoss",
          fromMonth: 205,
          throughMonth: 216,
        },
        {
          id: "arc-102-successor-review-firm-coverage",
          kind: "firmCoverage",
          fromMonth: 205,
          throughMonth: 216,
        },
      ],
      previewTitle: "Transition review ahead",
      source: {
        kind: "WORLD_EVENT",
        concept: "goal",
        importance: "ROUTINE",
        actionTarget: FLEET_TARGET,
        turningPointPriority: 95,
      },
    },
  },
};

/** Linked onset/restoration phases share one addressed month draw at every difficulty. */
export const HURRICANE_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 104,
  arcId: "hurricane-2008",
  definitions: {
    events: [
      {
        id: "outlook",
        title: "2008 hurricane outlook",
        message:
          "A hurricane may cut plant output and raise oil prices. Add backup power.",
        startMonth: 61,
        visibility: "forecast",
      },
      {
        id: "landfall",
        title: "Hurricane hits",
        message:
          "Storm damage reduces affected generator output and raises oil prices.",
        startMonth: { from: 102, to: 107 },
        durationMonths: byDifficulty(
          HURRICANE_BALANCE,
          (balance) => balance.durationMonths,
        ),
        preview: "Storm damage may reduce plant output and raise oil prices.",
        effects: {
          fuelPriceMultipliers: {
            Oil: byDifficulty(
              HURRICANE_BALANCE,
              (balance) => balance.oilMultiplier,
            ),
          },
          outputMultipliersBySelector: [
            {
              target: {
                selector: "seededOperatingCapacityShare",
                targetCapacityShare: byDifficulty(
                  HURRICANE_BALANCE,
                  (balance) => balance.targetCapacityShare,
                ),
              },
              outputMultiplier: byDifficulty(
                HURRICANE_BALANCE,
                (balance) => balance.outputMultiplier,
              ),
            },
          ],
        },
        report: {
          id: "landfall-affected",
          kind: "affectedFacilities",
          eventId: "landfall",
        },
      },
      {
        id: "restoration",
        title: "Storm repairs complete",
        message:
          "Storm repairs finish. Affected generator output and oil prices return to normal.",
        startMonth: { from: 102, to: 107 },
        preview: "Plant output and oil prices will return to normal.",
        report: {
          id: "restoration-affected",
          kind: "affectedFacilities",
          eventId: "landfall",
        },
      },
    ],
    objectives: [],
  },
  presentation: {
    outlook: {
      nativeReview: "hurricaneOutlook",
      hidePreview: true,
      messageByDifficulty: copyByDifficulty(
        HURRICANE_BALANCE,
        (balance, difficulty) =>
          `A ${balance.severity.toLowerCase()} hurricane in 2008 may cut plant output for ${balance.durationMonths} months and raise oil prices. Add backup power. ${buildLeadTimeHint(difficulty)}`,
      ),
      source: {
        kind: "WORLD_EVENT",
        concept: "danger",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
      },
    },
    landfall: {
      nativeReview: "hurricaneLandfall",
      scheduleRandomKey: "landfall-month",
      scheduleAddress: "landfall",
      titleByDifficulty: copyByDifficulty(
        HURRICANE_BALANCE,
        (balance) => `${balance.severity} hurricane hits`,
      ),
      previewTitle: "A hurricane may disrupt power",
      attributesByDifficulty: attributesByDifficulty(
        HURRICANE_BALANCE,
        (balance) => ({ ...balance }),
      ),
      source: {
        drawKey: "story:104:hurricane-2008:landfall",
        kind: "WORLD_EVENT",
        concept: "danger",
        importance: "CRITICAL",
        actionTarget: FLEET_TARGET,
        turningPointPriority: 100,
      },
    },
    restoration: {
      nativeReview: "hurricaneRestoration",
      relativeReports: [
        {
          id: "arc-104-restoration-reliability",
          kind: "reliability",
          monthsBefore: byDifficulty(
            HURRICANE_BALANCE,
            (balance) => balance.durationMonths,
          ),
          minDemandServedShare: 0.999,
        },
      ],
      scheduleRandomKey: "landfall-month",
      scheduleAddress: "landfall",
      scheduleOffsetMonths: byDifficulty(
        HURRICANE_BALANCE,
        (balance) => balance.durationMonths,
      ),
      previewTitle: "Storm repairs finishing",
      source: {
        kind: "WORLD_EVENT",
        concept: "supply",
        actionTarget: SUPPLY_DEMAND_TARGET,
        turningPointPriority: 90,
      },
    },
  },
};

/** The shutdown binds to the original owned asset, including a temporarily paused unit. */
export const NUCLEAR_TRIP_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 110,
  arcId: "nuclear-trip",
  definitions: {
    events: [
      {
        id: "contingency-review",
        title: "Backup-power review",
        message:
          "Your largest reactor may shut down between July 2026 and January 2027. Build backup power.",
        startMonth: 2,
        visibility: "forecast",
      },
      {
        id: "trip",
        title: "Grand Nuclear Unit shuts down",
        message:
          "Your largest generator is offline for the rest of the mission. Replace its power with backup generation and storage.",
        startMonth: { from: 31, to: 37 },
        durationMonths: 48,
        visibility: "surprise",
        effects: {
          outputMultipliersBySelector: [
            {
              target: {
                selector: "startingAsset",
                assetId: "scenario-110-grand-nuclear-unit",
              },
              outputMultiplier: 0,
            },
          ],
        },
        report: {
          id: "nuclear-trip-affected",
          kind: "affectedFacilities",
          eventId: "trip",
        },
      },
    ],
    objectives: [],
  },
  presentation: {
    "contingency-review": {
      nativeReview: "nuclearContingency",
      hidePreview: true,
      messageByDifficulty: copyByDifficulty(
        HURRICANE_BALANCE,
        (_balance, difficulty) =>
          `Your largest reactor may shut down between July 2026 and January 2027. Build backup power. ${buildLeadTimeHint(difficulty)}`,
      ),
      source: {
        kind: "WORLD_EVENT",
        concept: "danger",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
      },
    },
    trip: {
      nativeReview: "nuclearTrip",
      scheduleRandomKey: "largest-unit-trip",
      hidePreview: true,
      source: {
        kind: "WORLD_EVENT",
        concept: "danger",
        importance: "CRITICAL",
        actionTarget: FLEET_TARGET,
        turningPointPriority: 120,
      },
    },
  },
};

// The surviving route is capped in watts, including later upgrades on the same path.
export const WILDFIRE_INTERTIE_RETAINED_CAPACITY = 0.1;
export const WILDFIRE_INTERTIE_CAPACITY_LIMIT_W = 4e6;
export const WILDFIRE_CORRIDOR_ID = "california-north";

/** Native 111 uses the same plain corridor restriction as authored community events. */
export const CALIFORNIA_WILDFIRE_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 111,
  arcId: "wildfire-intertie",
  definitions: {
    events: [
      {
        id: "readiness",
        title: "Prepare for a northern intertie outage",
        message:
          "Your existing northern intertie will lose 90% of its capacity in January and February 2025. Prepare local supply, storage, or an independent connection.",
        startMonth: 2,
        visibility: "surprise",
      },
      {
        id: "outage",
        title: "Northern intertie capacity down 90%",
        message:
          "Wildfire has cut the northern intertie to 10% capacity through February. Use local supply or an independent connection to cover the gap.",
        startMonth: 13,
        durationMonths: 2,
        preview:
          "The northern intertie will lose 90% of its capacity through February. Prepare replacement supply.",
        effects: {
          transmissionCapacityLimitsMWByCorridor: {
            [WILDFIRE_CORRIDOR_ID]: WILDFIRE_INTERTIE_CAPACITY_LIMIT_W / 1e6,
          },
        },
      },
      {
        id: "restored",
        title: "Northern intertie restored",
        message: "The northern intertie is back at full capacity.",
        startMonth: 15,
      },
    ],
    objectives: [],
  },
  presentation: {
    readiness: {
      hidePreview: true,
      messageByDifficulty: Object.fromEntries(
        DIFFICULTY_IDS.map((difficulty) => [
          difficulty,
          `Your existing northern intertie will lose 90% of its capacity in January and February 2025. Prepare local supply, storage, or an independent connection. ${buildLeadTimeHint(difficulty)}`,
        ]),
      ) as Record<DifficultyType, string>,
      source: {
        kind: "WORLD_EVENT",
        concept: "forecast",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
      },
    },
    outage: {
      previewTitle: "Northern intertie wildfire outage",
      attributes: { retainedCapacity: WILDFIRE_INTERTIE_RETAINED_CAPACITY },
      source: {
        kind: "WORLD_EVENT",
        concept: "danger",
        importance: "CRITICAL",
        actionTarget: FLEET_TARGET,
        turningPointPriority: 120,
      },
    },
    restored: {
      hidePreview: true,
      source: {
        kind: "WORLD_EVENT",
        concept: "supply",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
        turningPointPriority: 110,
      },
    },
  },
};

export const OFFICIAL_TARGET_SCENARIO_RULES: readonly OfficialScenarioRuleDefinition[] =
  [
    END_OF_ERA_RULES,
    HURRICANE_RULES,
    NUCLEAR_TRIP_RULES,
    CALIFORNIA_WILDFIRE_RULES,
  ];
