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
          label: "Retrofit remaining plants",
          costDollars: 0,
          description:
            "Permanently winterize remaining gas, coal, nuclear, and wind plants.",
          message:
            "Winterization installation started. Demand and gas prices still surge during the freeze.",
        },
        {
          id: "standard",
          label: "Keep construction budget",
          costDollars: 0,
          meaningful: false,
          description:
            "Keep cash for construction or individual upgrades. Existing winterization still protects its plants.",
          message:
            "Construction budget kept. Existing winterization stays with its plants.",
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
