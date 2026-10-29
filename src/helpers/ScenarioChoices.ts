import { DifficultyType, GameType, ScenarioChoiceType } from "../Types";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { bulkWinterizationQuote } from "./Hazards";
import { MINUTES_PER_MONTH } from "./DateTime";
import { formatMoneyConcise } from "./Format";
import { relocateOfficialArcMonth } from "./ScenarioArcTiming";
import { scenarioRules } from "./ScenarioRules";
import { getScenario } from "../data/Scenarios";
import { ruleConditionMet } from "./ScenarioRuleRuntime";
import { ruleChoices } from "./ScenarioRuleDependencies";
import type { CompiledRuleChoice } from "../data/ScenarioRules";
import { compileOfficialArcChoices } from "./ScenarioRuleChoices";
import type { CompiledScenarioRules } from "../data/ScenarioRules";

const catalogChoices = new Map<string, CompiledRuleChoice[]>();

/** Read launch-bound choices from the shared compiled rules. */
export function scenarioChoicesForGame(game: GameType): {
  choices: CompiledRuleChoice[];
  rules?: CompiledScenarioRules;
} {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  const rules = scenarioRules(scenario, game);
  if (rules) return { choices: ruleChoices(rules), rules };
  if (
    !scenario ||
    !SCENARIO_CHOICES.some((choice) => choice.scenarioId === game.scenarioId)
  )
    return { choices: [] };
  const key = `${game.scenarioId}:${game.difficulty}:${game.seed}:${game.startingYear}`;
  let choices = catalogChoices.get(key);
  if (!choices) {
    choices = compileOfficialArcChoices(
      {
        namespace: {
          kind: "official",
          scenarioId: scenario.id,
          arcId: "catalog",
        },
        difficulty: game.difficulty,
        seed: game.seed,
        startingYear: game.startingYear,
        durationMonths: scenario.durationMonths,
        startingAssetIds: scenario.facilities.flatMap((asset) =>
          asset.assetId ? [asset.assetId] : [],
        ),
        receivingScenario: scenario,
      },
      [{ scenarioId: scenario.id, includeChoices: true }],
    );
    catalogChoices.set(key, choices);
  }
  return {
    choices,
    rules: {
      runtimeVersion: 1,
      namespace: {
        kind: "official",
        scenarioId: scenario.id,
        arcId: "catalog",
      },
      difficulty: game.difficulty,
      seed: game.seed,
      startingYear: game.startingYear,
      durationMonths: scenario.durationMonths,
      startingPeakW: 0,
      startingAssetIds: scenario.facilities.flatMap((asset) =>
        asset.assetId ? [asset.assetId] : [],
      ),
      officialArcs: [{ scenarioId: scenario.id, includeChoices: true }],
      choices: [],
      arcChoices: choices,
      events: [],
      loads: [],
      objectives: [],
      debriefReports: [],
    },
  };
}

/** The UI adapter is ephemeral; the saved definition stays plain data. */
export function scenarioRuleChoiceView(
  choice: CompiledRuleChoice,
  scenarioId: number,
): ScenarioChoiceType {
  return {
    id: choice.key,
    scenarioId,
    atMonth: choice.dueMonth,
    title: choice.title,
    message: choice.prompt,
    options: choice.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      message: option.message,
      cost: () => option.cost,
      upfrontGrant: () => option.grant,
      meaningful: option.meaningful,
    })),
  };
}

export function pendingScenarioRuleChoice(
  game: GameType,
  automatic = false,
): CompiledRuleChoice | undefined {
  const { choices, rules } = scenarioChoicesForGame(game);
  if (game.storyEffectsDisabled) return undefined;
  const choice = choices.find(
    (choice) =>
      !!choice.automatic === automatic &&
      game.date.monthsElapsed >= choice.dueMonth &&
      !game.worldEvents.occurrences.some((event) => event.key === choice.key) &&
      (!choice.requiresChoice ||
        (!!rules &&
          ruleConditionMet(
            choice.requiresChoice,
            rules,
            game.worldEvents.occurrences,
          ))),
  );
  if (!choice || !isBulkWinterizationChoice(choice)) return choice;
  const quote = bulkWinterizationQuote(game);
  const count = quote.facilities.length;
  return {
    ...choice,
    prompt: count
      ? `${count} unprotected ${count === 1 ? "plant remains" : "plants remain"}. Retrofit them now, or manage upgrades individually. Already protected plants and work in progress are excluded.`
      : "Every eligible plant is already winterized or being upgraded. New construction needs its own cold-weather package.",
    options: [...choice.options]
      .sort((a, b) =>
        a.id === "winterize" ? -1 : b.id === "winterize" ? 1 : 0,
      )
      .map((option) =>
        option.id === "winterize"
          ? {
              ...option,
              cost: quote.cost,
              label: count ? "Retrofit remaining plants" : "Already prepared",
              description: count
                ? "Permanent winterization halves each plant’s freeze output loss. Staged installation keeps 90% of capacity available for one month. Future builds are not included."
                : "No work or payment needed. Existing protection stays with each plant.",
              message: count
                ? `Winterization started on ${count} ${count === 1 ? "plant" : "plants"}. Installation takes a month with 90% of capacity available.`
                : "Existing winterization retained; no additional work needed.",
              ...(count ? {} : { meaningful: false as const }),
            }
          : {
              ...option,
              description:
                "Keep cash and arrange individual upgrades or more capacity. Existing winterization still protects its plants.",
            },
      ),
  };
}

/** Trusted detached source, including imported official arcs. */
export function isBulkWinterizationChoice(choice: CompiledRuleChoice): boolean {
  return (
    choice.source?.scenarioId === 107 &&
    choice.source.choiceId === "winterization"
  );
}

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
  if (definitions === SCENARIO_CHOICES) {
    const choice = pendingScenarioRuleChoice(game);
    return choice ? scenarioRuleChoiceView(choice, game.scenarioId) : undefined;
  }
  return definitions.find(
    (choice) =>
      choice.scenarioId === game.scenarioId &&
      game.date.minute >=
        relocateOfficialArcMonth(choice.scenarioId, choice.atMonth, "choice") *
          MINUTES_PER_MONTH &&
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
