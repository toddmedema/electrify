import { WEATHER_DEPENDENT_FUELS } from "../Constants";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  SCENARIOS,
} from "../data/Scenarios";
import { createGame } from "../testing/Simulator";
import { isStorage, ScenarioType } from "../Types";

it.each(SCENARIOS)(
  "starts $name with weather-driven generation first",
  (scenario) => {
    const state = createGame({ scenarioId: scenario.id, scenario });
    const priorities = state.facilities.map((facility) =>
      !isStorage(facility) && WEATHER_DEPENDENT_FUELS.includes(facility.fuel)
        ? 0
        : 1,
    );
    expect(priorities).toEqual([...priorities].sort());
  },
);

it.each([false, true])(
  "prioritizes every wind technology and solar in a mixed fleet (tutorial: %s)",
  (tutorial) => {
    const scenario: ScenarioType = {
      ...DEFAULT_CUSTOM_SCENARIO,
      startingYear: 2050,
      tutorialSteps: tutorial ? [] : undefined,
      intertiesEnabled: false,
      facilities: [
        { fuel: "Coal", peakW: 200000000 },
        { fuel: "Wind", peakW: 100000000 },
        { name: "Pumped Hydro", peakWh: 500000000 },
        { fuel: "Sun", peakW: 100000000 },
        { fuel: "Oil", peakW: 100000000 },
        { fuel: "Offshore Wind", peakW: 100000000 },
        { fuel: "Airborne Wind", peakW: 100000000 },
      ],
    };
    const state = createGame({ scenarioId: CUSTOM_SCENARIO_ID, scenario });
    expect(
      state.facilities.map((facility) => facility.fuel ?? facility.name),
    ).toEqual(
      tutorial
        ? [
            "Airborne Wind",
            "Offshore Wind",
            "Sun",
            "Wind",
            "Oil",
            "Coal",
            "Pumped Hydro",
          ]
        : [
            "Wind",
            "Sun",
            "Offshore Wind",
            "Airborne Wind",
            "Coal",
            "Oil",
            "Pumped Hydro",
          ],
    );
  },
);
