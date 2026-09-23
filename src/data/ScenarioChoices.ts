import { ScenarioChoiceType } from "../Types";
import {
  WILDFIRE_DECISION_KEY,
  wildfirePreparationCost,
  DEEP_FREEZE_DECISION_KEY,
  winterizationCost,
} from "./WorldEvents";
export const DATA_CENTER_DECISION_KEY = "story:106:data-center-boom:connection";
// The same 100 MW connection earns the same contribution at every difficulty.
// Demand, operating economics and customer retention already scale the challenge.
export const DATA_CENTER_GRANT = {
  Intern: 15000000,
  Employee: 15000000,
  Manager: 15000000,
  VP: 15000000,
  CEO: 15000000,
};
export const SCENARIO_CHOICES: ScenarioChoiceType[] = [
  {
    id: DATA_CENTER_DECISION_KEY,
    scenarioId: 106,
    atMonth: 48,
    title: "Negotiate the data-center connection",
    message: "Choose developer funding or more time to build capacity.",
    options: [
      {
        id: "fast-track",
        label: "Accept funded connection",
        cost: () => 0,
        upfrontGrant: (difficulty) => DATA_CENTER_GRANT[difficulty],
        description:
          "Receive funding toward capacity and connection work, not the full cost. Connect 100 MW in January 2026, when sales begin.",
        message:
          "Funding received. Your agreement commits you to connect 100 MW in January 2026.",
      },
      {
        id: "phased",
        label: "Require phased connections",
        cost: () => 0,
        description:
          "No funding. Connect 50 MW in January 2026 and 50 MW in January 2028, delaying half the demand and sales by two years.",
        message:
          "Phased connection agreed: 50 MW in January 2026 and 50 MW in January 2028, with no funding.",
        loadAdditions: [
          {
            id: "manassas-data-centers-phase-one",
            label: "New data centers",
            startsYear: 2026,
            peakW: 50000000,
            loadFactor: 0.9,
            demandType: "Data centers",
          },
          {
            id: "manassas-data-centers-phase-two",
            label: "New data centers",
            startsYear: 2028,
            peakW: 50000000,
            loadFactor: 0.9,
            demandType: "Data centers",
          },
        ],
      },
    ],
  },
  {
    id: DEEP_FREEZE_DECISION_KEY,
    scenarioId: 107,
    atMonth: 36,
    title: "Prepare for the deep freeze",
    message:
      "Fund plant protection and supplier coordination before February 2021 to reduce output losses. Demand and gas prices will still surge.",
    options: [
      {
        id: "winterize",
        label: "Fund winterization",
        cost: winterizationCost,
        description:
          "Halve February output losses: gas retains 81%, coal 86.5%, nuclear 88.5%, and wind 72% of normal output. Demand and gas-price shocks still apply.",
        message:
          "Winterization funded. February 2021 plant output losses will be halved; the demand surge and gas-price spike still apply.",
      },
      {
        id: "standard",
        label: "Keep construction budget",
        cost: () => 0,
        meaningful: false,
        description:
          "Keep your cash for generation and storage. February output falls to 62% for gas, 73% for coal, 77% for nuclear, and 44% for wind; demand and gas prices also surge.",
        message:
          "Construction budget preserved. Full February 2021 output losses, demand surge, and gas-price spike apply.",
      },
    ],
  },
  {
    id: WILDFIRE_DECISION_KEY,
    scenarioId: 111,
    atMonth: 11,
    title: "Wildfire preparedness",
    message:
      "Extreme Santa Ana winds are forecast for January. Inspections, staged backup equipment and response crews halve customer disconnections and generator output losses in January and February. Restoration costs still apply.",
    options: [
      {
        id: "prepare",
        label: "Fund preparedness",
        cost: wildfirePreparationCost,
        message:
          "Preparedness funded. January and February customer disconnections and generator output losses are halved. Restoration costs still apply.",
      },
      {
        id: "standard",
        meaningful: false,
        label: "Keep cash",
        cost: () => 0,
        message:
          "Cash preserved. The full January and February outage impact and restoration costs apply.",
      },
    ],
  },
];
