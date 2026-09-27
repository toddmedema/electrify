import { DifficultyType, GameType, ScenarioChoiceType } from "../Types";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { MINUTES_PER_MONTH } from "./DateTime";
import { formatMoneyConcise } from "./Format";
import { wildfirePreparedness } from "./Wildfire";

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
        ? "One-time upfront cost."
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
  return definitions.find(
    (choice) =>
      choice.scenarioId === game.scenarioId &&
      game.date.minute >= choice.atMonth * MINUTES_PER_MONTH &&
      !game.worldEvents.occurrences.some((event) => event.key === choice.id),
  );
}
/** Choices the player may take up without the clock waiting on them: this season's wildfire
 * preparedness, funded from Customer programs through the same replayable action. */
export function optionalScenarioChoice(game: GameType) {
  if (game.storyEffectsDisabled) return undefined;
  return wildfirePreparedness(game)?.choice;
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
