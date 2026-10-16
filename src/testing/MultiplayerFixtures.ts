import { CUSTOM_SCENARIO_ID, DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import type { MatchSpec, Seat } from "../multiplayer/Types";

/**
 * A five-year San Francisco custom game: the shape of the original co-op sandbox, with one
 * mixed fleet that has spare gas to trade and wind and sun that run short.
 */
export const COOP_TEST_SPEC: MatchSpec = {
  scenarioId: CUSTOM_SCENARIO_ID,
  difficulty: "Employee",
  customScenario: {
    ...DEFAULT_CUSTOM_SCENARIO,
    locationId: "SF",
    durationMonths: 60,
    startingCustomers: 100000,
    cash: 200e6,
    facilities: [
      { name: "Wind", fuel: "Wind", peakW: 60e6 },
      { name: "Solar", fuel: "Sun", peakW: 50e6 },
      { name: "Natural Gas CC", fuel: "Natural Gas", peakW: 50e6 },
    ],
  },
};

export const coopSeats = (count: number, prefix = ""): Seat[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `Player ${i}`,
  }));
