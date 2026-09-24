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
        description: "Receive {grant} to connect all 100 MW in January 2026.",
        message:
          "Funding received for your commitment to connect 100 MW in January 2026.",
      },
      {
        id: "phased",
        label: "Require phased connections",
        cost: () => 0,
        description:
          "Forgo funding and delay half the demand and sales: connect 50 MW in January 2026 and 50 MW in January 2028.",
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
      "Protect plant output during February 2021’s freeze or save cash for construction; demand and gas prices surge either way.",
    options: [
      {
        id: "winterize",
        label: "Fund winterization",
        cost: winterizationCost,
        description:
          "Spend {cost} to halve February’s output losses at gas, coal, nuclear, and wind plants.",
        message:
          "Winterization halves February 2021 plant output losses, but demand and gas prices still surge.",
      },
      {
        id: "standard",
        label: "Keep construction budget",
        cost: () => 0,
        meaningful: false,
        description:
          "Save cash for construction and accept February’s full output losses, including a 38% drop at gas plants.",
        message:
          "Construction funds are preserved, with full plant output losses and surging demand and gas prices in February 2021.",
      },
    ],
  },
  {
    id: WILDFIRE_DECISION_KEY,
    scenarioId: 111,
    atMonth: 11,
    title: "Wildfire preparedness",
    message:
      "Prepare for January's extreme Santa Ana winds; restoration costs apply either way.",
    options: [
      {
        id: "prepare",
        label: "Fund preparedness",
        cost: wildfirePreparationCost,
        description:
          "Spend {cost} to halve customer disconnections and generator output losses in January and February.",
        message:
          "Preparedness halves January and February customer disconnections and generator output losses, with restoration costs unchanged.",
      },
      {
        id: "standard",
        meaningful: false,
        label: "Keep cash",
        cost: () => 0,
        description:
          "Save cash and accept January and February’s full customer disconnections and generator output losses.",
        message:
          "Cash is preserved, with the full January and February outage impact and restoration costs.",
      },
    ],
  },
];
