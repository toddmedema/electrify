import { GameType, ScenarioChoiceType } from "../Types";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { MINUTES_PER_MONTH } from "./DateTime";
/** Due choices remain pending until explicitly answered, including after loading a save.
 * Array order breaks ties so simultaneous choices appear sequentially. */
export function pendingScenarioChoice(
  game: GameType,
  definitions: ScenarioChoiceType[] = SCENARIO_CHOICES,
) {
  if (game.storyEffectsDisabled) return undefined;
  return definitions.find(
    (choice) =>
      choice.scenarioId === game.scenarioId &&
      game.date.minute >= choice.atMonth * MINUTES_PER_MONTH &&
      !game.worldEvents.occurrences.some((event) => event.key === choice.id),
  );
}
export function validScenarioResponse(
  value: unknown,
): value is { decisionId: string; optionId: string } {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.decisionId === "string" &&
    typeof response.optionId === "string"
  );
}
