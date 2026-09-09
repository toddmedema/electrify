import { ScenarioChoiceType } from "../Types";
import { WILDFIRE_DECISION_KEY, wildfirePreparationCost } from "./WorldEvents";
export const SCENARIO_CHOICES: ScenarioChoiceType[] = [
  {
    id: WILDFIRE_DECISION_KEY,
    scenarioId: 111,
    atMonth: 11,
    title: "Wildfire preparedness",
    message:
      "Extreme Santa Ana winds are forecast for January. Prepared crews halve physical customer disconnections and generator output losses during January and February. Normal restoration costs still apply.",
    options: [
      {
        id: "prepare",
        label: "Fund preparedness",
        cost: wildfirePreparationCost,
        message:
          "Preparedness funded. Crews halve physical disconnections and generator output losses in January and February; normal restoration costs still apply.",
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
