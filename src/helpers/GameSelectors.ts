import { getScenario, SCENARIOS } from "../data/Scenarios";
import { GameType, ScenarioType, TickPresentFutureType } from "../Types";
import { getTimeFromTimeline } from "./DateTime";

/**
 * Plain reads of game state that many screens repeat. They're functions of the game rather than
 * Redux selectors so the reducer can call them on draft state too.
 */

/** The timeline tick for the game's current minute, or null before a timeline exists. */
export function currentTick(
  game: Pick<GameType, "date" | "timeline">,
): TickPresentFutureType | null {
  return getTimeFromTimeline(game.date.minute, game.timeline);
}

/** Cash on hand now, or 0 before a timeline exists. */
export function currentCash(game: Pick<GameType, "date" | "timeline">): number {
  return currentTick(game)?.cash ?? 0;
}

/** What the player's plants and storage are putting on the grid now, or 0 before a timeline exists. */
export function currentGenerationW(
  game: Pick<GameType, "date" | "timeline">,
): number {
  const now = currentTick(game);
  if (!now) return 0;
  return (
    Object.values(now.supplyByFuel).reduce<number>(
      (sum, watts) => sum + (watts || 0),
      0,
    ) + (now.storageDischargeW || 0)
  );
}

/** The scenario being played, including a custom one, or undefined for an unknown ID. */
export function activeScenario(
  game: Pick<GameType, "scenarioId" | "customScenario">,
): ScenarioType | undefined {
  return getScenario(game.scenarioId, game.customScenario);
}

/** The scenario being played, falling back to the first scenario for an unknown ID. */
export function activeScenarioOrDefault(
  game: Pick<GameType, "scenarioId" | "customScenario">,
): ScenarioType {
  return activeScenario(game) || SCENARIOS[0];
}
