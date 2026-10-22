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
        message: "Funding received. Connect 100 MW in January 2026.",
      },
      {
        id: "phased",
        label: "Require phased connections",
        cost: () => 0,
        description:
          "Forgo funding. Connect 50 MW in January 2026 and 50 MW in January 2028, delaying half the sales.",
        message:
          "Connect 50 MW in January 2026 and 50 MW in January 2028. No funding received.",
        loadAdditions: [
          {
            id: "manassas-data-centers-phase-one",
            label: "Data Centers",
            startsYear: 2026,
            peakW: 50000000,
            loadFactor: 0.9,
            demandType: "Data Centers",
          },
          {
            id: "manassas-data-centers-phase-two",
            label: "Data Centers",
            startsYear: 2028,
            peakW: 50000000,
            loadFactor: 0.9,
            demandType: "Data Centers",
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
    message: "February demand and gas prices spiking as plant output falls.",
    options: [
      {
        id: "winterize",
        label: "Fund winterization",
        cost: winterizationCost,
        description:
          "Halve February’s output losses at gas, coal, nuclear, and wind plants.",
        message:
          "Winterization halves February 2021 output losses. Demand and gas prices still surge.",
      },
      {
        id: "standard",
        label: "Keep construction budget",
        cost: () => 0,
        meaningful: false,
        description:
          "Save cash for construction and accept February’s full output losses, including a 38% drop at gas plants.",
        message:
          "Construction budget kept. February 2021 output losses apply in full.",
      },
    ],
  },
  {
    id: WILDFIRE_DECISION_KEY,
    scenarioId: 111,
    atMonth: 11,
    title: "Wildfire preparedness",
    message:
      "Reserve local backup for critical sites during January's fire response, or keep cash.",
    options: [
      {
        id: "prepare",
        label: "Fund preparedness",
        cost: wildfirePreparationCost,
        description:
          "Reserve one mobile generator: up to 150 kW for 24 hours (3.6 MWh) at eligible local critical sites.",
        message:
          "Local critical-load backup reserved: 150 kW for 24 hours (3.6 MWh). Fire isolation and repair costs remain.",
      },
      {
        id: "standard",
        meaningful: false,
        label: "Keep cash",
        cost: () => 0,
        description:
          "Keep the deployment budget. Respond to damaged lines and customer interruptions without the reserved local backup.",
        message:
          "Cash kept. Standard response applies, with no reserved local critical-load backup.",
      },
    ],
  },
];
