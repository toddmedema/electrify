import { TICKS_PER_YEAR } from "../Constants";
import { getStartingCustomers } from "../data/LocationProfiles";
import { CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { getScenarioLocation } from "./Locations";
import gameReducer, {
  delta,
  generateNewTimeline,
  initGame,
  start,
} from "../reducers/Game";
import { DifficultyType, ScenarioType, TickPresentFutureType } from "../Types";

export interface CustomGameForecastRequest {
  requestId: number;
  scenario: ScenarioType;
  difficulty: DifficultyType;
  seed: number;
}

export interface YearOneOutlook {
  demandServed: number;
  worstShortfallW: number;
}

export type CustomGameForecastResponse =
  | {
      requestId: number;
      outlook: YearOneOutlook;
    }
  | {
      requestId: number;
      error: string;
    };

/** Reduces an exact game forecast to the two setup decisions a player needs. */
export function summarizeYearOneOutlook(
  timeline: readonly TickPresentFutureType[],
): YearOneOutlook {
  let demand = 0;
  let served = 0;
  let worstShortfallW = 0;
  timeline.forEach((tick) => {
    demand += Math.max(0, tick.demandW);
    served += Math.max(0, Math.min(tick.supplyW, tick.demandW));
    worstShortfallW = Math.max(worstShortfallW, tick.demandW - tick.supplyW);
  });
  return {
    demandServed: demand > 0 ? Math.min(1, served / demand) : 1,
    // Fractions of a watt are forecast arithmetic, not a meaningful shortage.
    worstShortfallW: worstShortfallW < 1 ? 0 : worstShortfallW,
  };
}

/**
 * Runs the same initialization, facility resolution and dispatch forecast as a real custom game.
 * Its caller owns loading weather/economic data into an isolated execution context first.
 */
export function forecastCustomGameYearOne(
  scenario: ScenarioType,
  difficulty: DifficultyType,
  seed: number,
): YearOneOutlook {
  const location = getScenarioLocation(scenario);
  if (!location) {
    throw new Error("The custom setup has no playable location");
  }
  const customers =
    scenario.startingCustomers || getStartingCustomers(location);
  let game = gameReducer(undefined, start(CUSTOM_SCENARIO_ID));
  game = gameReducer(
    game,
    delta({
      customScenario: scenario,
      difficulty,
    }),
  );
  game = gameReducer(
    game,
    initGame({
      facilities: scenario.facilities,
      cash: scenario.cash,
      customers,
      location,
      seed,
    }),
  );
  const opening = game.timeline[0];
  const timeline = generateNewTimeline(
    game,
    opening.cash,
    opening.customers,
    TICKS_PER_YEAR,
  );
  return summarizeYearOneOutlook(timeline);
}
