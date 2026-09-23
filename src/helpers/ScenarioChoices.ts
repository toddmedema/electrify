import { DifficultyType, GameType, ScenarioChoiceType } from "../Types";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { MINUTES_PER_MONTH } from "./DateTime";
import { formatMoneyConcise } from "./Format";
import { wildfirePreparednessChoice } from "./Wildfire";

/** Keep the price and consequence in one sentence, using the active difficulty's terms. */
export function scenarioChoiceDescription(
  option: ScenarioChoiceType["options"][number],
  difficulty: DifficultyType,
) {
  const cost = option.cost(difficulty);
  const grant = option.upfrontGrant?.(difficulty) ?? 0;
  const description =
    option.description ??
    (grant > 0
      ? "Receive {grant} in one-time funding."
      : cost > 0
        ? "Spend {cost} upfront."
        : "No upfront cost.");
  return description
    .replaceAll("{cost}", formatMoneyConcise(cost))
    .replaceAll("{grant}", formatMoneyConcise(grant));
}
/** Due choices remain pending until explicitly answered, including after loading a save.
 * Array order breaks ties so simultaneous choices appear sequentially. */
export function pendingScenarioChoice(
  game: GameType,
  definitions: ScenarioChoiceType[] = SCENARIO_CHOICES,
) {
  if (game.storyEffectsDisabled) return undefined;
  const authored = definitions.find(
    (choice) =>
      choice.scenarioId === game.scenarioId &&
      game.date.minute >= choice.atMonth * MINUTES_PER_MONTH &&
      !game.worldEvents.occurrences.some((event) => event.key === choice.id),
  );
  if (authored) return authored;
  // Recurring, season-scoped wildfire preparedness for eligible custom games. It is built from
  // live game state (system size, location) rather than the authored table, and is answered at
  // most once per season through the same replayable chooseScenarioResponse action.
  return wildfirePreparednessChoice(game);
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
