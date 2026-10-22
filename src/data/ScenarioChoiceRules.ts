import type { DifficultyType } from "../Types";
import type { RuleChoice, RuleOption } from "./ScenarioRules";

/** Catalog data shared by official play and detached imported-arc compilation. */
export interface CatalogScenarioChoice {
  scenarioId: number;
  arcId: string;
  choice: Omit<RuleChoice, "options"> & {
    options: Array<RuleOption & { meaningful?: false }>;
  };
}

// The same 100 MW connection earns the same contribution at every difficulty.
// Demand, operating economics and customer retention already scale the challenge.
export const DATA_CENTER_GRANT: Record<DifficultyType, number> = {
  Intern: 15000000,
  Employee: 15000000,
  Manager: 15000000,
  VP: 15000000,
  CEO: 15000000,
};

// Rounded 2020-dollar planning allowance for the thermal fleet, wind and expansion.
// See src/testing/SCENARIO_CHOICE_BALANCE.md. Difficulty changes risk, not service cost.
export const WINTERIZATION_COST: Record<DifficultyType, number> = {
  Intern: 90000000,
  Employee: 90000000,
  Manager: 90000000,
  VP: 90000000,
  CEO: 90000000,
};

// Advance inspection, staged equipment and crews; post-fire restoration is separate.
export const WILDFIRE_PREPARATION_COST = 2000000;

/** Months are authored one-based offsets, before the source's preparation lead. */
export const SCENARIO_CHOICE_RULES: CatalogScenarioChoice[] = [
  {
    scenarioId: 106,
    arcId: "data-center-boom",
    choice: {
      id: "connection",
      dueMonth: 49,
      title: "Negotiate the data-center connection",
      prompt: "Choose developer funding or more time to build capacity.",
      options: [
        {
          id: "fast-track",
          label: "Accept funded connection",
          grantDollars: { byDifficulty: DATA_CENTER_GRANT },
          description: "Receive {grant} to connect all 100 MW in January 2026.",
          message: "Funding received. Connect 100 MW in January 2026.",
        },
        {
          id: "phased",
          label: "Require phased connections",
          costDollars: 0,
          description:
            "Forgo funding. Connect 50 MW in January 2026 and 50 MW in January 2028, delaying half the sales.",
          message:
            "Connect 50 MW in January 2026 and 50 MW in January 2028. No funding received.",
          replaceLoad: {
            loadId: "manassas-data-centers",
            with: [
              {
                id: "manassas-data-centers-phase-one",
                startMonth: 73,
                peakMW: 50,
                loadFactor: 0.9,
                demandType: "Data Centers",
              },
              {
                id: "manassas-data-centers-phase-two",
                startMonth: 97,
                peakMW: 50,
                loadFactor: 0.9,
                demandType: "Data Centers",
              },
            ],
          },
        },
      ],
    },
  },
  {
    scenarioId: 107,
    arcId: "texas-deep-freeze",
    choice: {
      id: "winterization",
      dueMonth: 37,
      title: "Prepare for the deep freeze",
      prompt: "February demand and gas prices spiking as plant output falls.",
      options: [
        {
          id: "winterize",
          label: "Fund winterization",
          costDollars: { byDifficulty: WINTERIZATION_COST },
          description:
            "Halve February’s output losses at gas, coal, nuclear, and wind plants.",
          message:
            "Winterization halves February 2021 output losses. Demand and gas prices still surge.",
        },
        {
          id: "standard",
          label: "Keep construction budget",
          costDollars: 0,
          meaningful: false,
          description:
            "Save cash for construction and accept February’s full output losses, including a 38% drop at gas plants.",
          message:
            "Construction budget kept. February 2021 output losses apply in full.",
        },
      ],
    },
  },
  {
    scenarioId: 111,
    arcId: "california-wildfire-2025",
    choice: {
      id: "preparedness",
      dueMonth: 12,
      title: "Wildfire preparedness",
      prompt:
        "Prepare crews and equipment for January's Santa Ana winds, or keep cash.",
      options: [
        {
          id: "prepare",
          label: "Fund preparedness",
          costDollars: WILDFIRE_PREPARATION_COST,
          description:
            "Halve customer disconnections and generator output losses in January and February.",
          message:
            "Preparedness halves January–February disconnections and output losses. Repair costs stay the same.",
        },
        {
          id: "standard",
          label: "Keep cash",
          costDollars: 0,
          meaningful: false,
          description:
            "Save cash and accept January and February’s full customer disconnections and generator output losses.",
          message:
            "Cash kept. January–February disconnections, output losses and repair costs apply in full.",
        },
      ],
    },
  },
];

export const catalogChoiceKey = (entry: CatalogScenarioChoice): string =>
  `story:${entry.scenarioId}:${entry.arcId}:${entry.choice.id}`;
export const DATA_CENTER_DECISION_KEY = catalogChoiceKey(
  SCENARIO_CHOICE_RULES.find((entry) => entry.scenarioId === 106)!,
);
export const DEEP_FREEZE_DECISION_KEY = catalogChoiceKey(
  SCENARIO_CHOICE_RULES.find((entry) => entry.scenarioId === 107)!,
);
export const WILDFIRE_DECISION_KEY = catalogChoiceKey(
  SCENARIO_CHOICE_RULES.find((entry) => entry.scenarioId === 111)!,
);
