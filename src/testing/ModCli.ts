import type { DifficultyType } from "../Types";
import { DIFFICULTY_IDS } from "../Constants";
import { getScenarioLocation } from "../helpers/Locations";
import {
  resolveScenarioRuleChoice,
  ruleChoices,
} from "../helpers/ScenarioRuleDependencies";
import { ID_PATTERN, isRuleJson } from "../helpers/ScenarioRulesSchema";
import {
  objectiveObservedText,
  objectiveStatusText,
  objectiveTargetText,
  objectiveWindowText,
} from "../helpers/ObjectivePresentation";
import { modResolvedSetup, modScenario } from "../mods/ModScenario";
import { validateMod } from "../mods/ModSchema";
import type { ModPackage } from "../mods/ModSchema";
import type { ModAuthorReport } from "../mods/ModAuthoring";
import type { RuleCondition } from "../data/ScenarioRules";
import { loadSimData } from "./SimData";
import { runSimulation } from "./Simulator";
import type { SimOptionsType, SimResultType } from "./Simulator";

export const MAX_MOD_MATRIX_RUNS = 20;
export interface ModResponse extends Pick<RuleCondition, "arc" | "choiceId"> {
  optionId: string;
}
export interface ModSimulationOptions {
  responses?: unknown;
  freeFallback?: boolean;
  seeds?: number[];
  difficulties?: DifficultyType[];
  simulation?: Omit<
    SimOptionsType,
    | "scenarioId"
    | "scenario"
    | "seed"
    | "difficulty"
    | "scenarioResponses"
    | "scenarioResponseMode"
  >;
}
export interface ModBranchResponse extends ModResponse {
  month: number;
  automatic: boolean;
  fallback: boolean;
}
export interface ModSimulationRun {
  seed: number;
  difficulty: DifficultyType;
  packageDigest: string;
  runtimeDigest: string;
  responses: ModBranchResponse[];
  objectiveResults: SimResultType["objectiveResults"];
  outcome: SimResultType["outcome"] | "inProgress";
  outcomeMonth: number;
  warnings: string[];
  result: SimResultType;
}

/** Only bundled base selection is needed before the shared resolver can calculate real peaks. */
export function loadModCliData(input: unknown): ModPackage {
  const pack = validateMod(input);
  const location = getScenarioLocation(modResolvedSetup(pack));
  if (!location) throw new Error("This mod's base has no playable location.");
  loadSimData(location);
  return pack;
}

export function parseModResponses(value: unknown): ModResponse[] {
  if (
    !isRuleJson(value) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).join() !== "responses" ||
    !Array.isArray((value as { responses?: unknown }).responses)
  )
    throw new Error(
      'Responses must be JSON: {"responses": [{"choiceId": "...", "optionId": "...", "arc": 106}]}',
    );
  const responses = (value as { responses: unknown[] }).responses;
  return responses.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`responses[${index}] must name one choice and option.`);
    const response = value as Record<string, unknown>;
    if (
      Object.keys(response).some(
        (key) => !["arc", "choiceId", "optionId"].includes(key),
      ) ||
      typeof response.choiceId !== "string" ||
      !ID_PATTERN.test(response.choiceId) ||
      typeof response.optionId !== "string" ||
      !ID_PATTERN.test(response.optionId) ||
      (response.arc !== undefined &&
        (!Number.isSafeInteger(response.arc) || Number(response.arc) < 0))
    )
      throw new Error(
        `responses[${index}] must contain valid choiceId, optionId and optional integer arc only.`,
      );
    return {
      choiceId: response.choiceId,
      optionId: response.optionId,
      ...(response.arc === undefined ? {} : { arc: Number(response.arc) }),
    };
  });
}

export function modSimulationMatrix(
  pack: ModPackage,
  options: Pick<ModSimulationOptions, "seeds" | "difficulties">,
): { seed: number; difficulty: DifficultyType }[] {
  const seeds = options.seeds ?? [pack.seed];
  const difficulties = options.difficulties ?? ["Employee"];
  if (
    !seeds.length ||
    !difficulties.length ||
    seeds.length * difficulties.length > MAX_MOD_MATRIX_RUNS
  )
    throw new Error(
      `A mod matrix must contain 1–${MAX_MOD_MATRIX_RUNS} seed/difficulty combinations.`,
    );
  if (
    seeds.some(
      (seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff,
    ) ||
    new Set(seeds).size !== seeds.length
  )
    throw new Error("Seeds must be distinct integers from 0 to 4294967295.");
  if (
    difficulties.some((difficulty) => !DIFFICULTY_IDS.includes(difficulty)) ||
    new Set(difficulties).size !== difficulties.length
  )
    throw new Error(
      `Difficulties must be distinct values from ${DIFFICULTY_IDS.join(", ")}.`,
    );
  return seeds.flatMap((seed) =>
    difficulties.map((difficulty) => ({ seed, difficulty })),
  );
}

/** Resolve references once, then let Simulator answer through the real reducer transition. */
export function runModSimulation(
  input: unknown,
  options: ModSimulationOptions = {},
): ModSimulationRun[] {
  const pack = loadModCliData(input);
  const responses =
    options.responses === undefined
      ? undefined
      : parseModResponses(options.responses);
  const matrix = modSimulationMatrix(pack, options);
  return matrix.map(({ seed, difficulty }) => {
    // A seed trial is a separate frozen variant; the file and installed library are untouched.
    const scenario = modScenario({ ...pack, seed }, undefined, difficulty);
    const rules = scenario.mod!.rules;
    const choices = ruleChoices(rules);
    if (
      choices.some((choice) => !choice.automatic) &&
      responses === undefined &&
      !options.freeFallback
    )
      throw new Error(
        "This mod has choices. Supply --responses <file> or explicitly allow --free-fallback.",
      );
    const selected: Record<string, string> = {};
    for (const response of responses ?? []) {
      const choice = resolveScenarioRuleChoice(response, rules);
      if (!choice)
        throw new Error(
          `Unknown choice ${response.arc === undefined ? "" : `arc ${response.arc}/`}${response.choiceId}.`,
        );
      if (selected[choice.key] !== undefined)
        throw new Error(`More than one response names ${choice.key}.`);
      if (!choice.options.some((option) => option.id === response.optionId))
        throw new Error(
          `Unknown option ${response.optionId} for ${choice.key}.`,
        );
      if (choice.automatic && response.optionId !== choice.freeOptionId)
        throw new Error(
          `${choice.key} resolves automatically to ${choice.freeOptionId}; enable its choices to select another option.`,
        );
      selected[choice.key] = response.optionId;
    }
    if (
      options.simulation?.months !== undefined &&
      (!Number.isSafeInteger(options.simulation.months) ||
        options.simulation.months < 1 ||
        options.simulation.months > scenario.durationMonths)
    )
      throw new Error(
        `--months must be between 1 and the frozen term of ${scenario.durationMonths} months.`,
      );
    const result = runSimulation({
      ...options.simulation,
      scenarioId: 999,
      scenario,
      seed,
      difficulty,
      scenarioResponses: selected,
      scenarioResponseMode: options.freeFallback ? "freeFallback" : "strict",
    });
    const reached = choices
      .flatMap((choice): ModBranchResponse[] => {
        const receipt = result.storyOccurrences.find(
          (event) =>
            event.key === choice.key &&
            event.attributes.scenarioChoice === true,
        );
        return receipt
          ? [
              {
                choiceId: choice.source?.choiceId ?? choice.id,
                ...(choice.source ? { arc: choice.source.scenarioId } : {}),
                optionId: String(receipt.attributes.choice),
                month: choice.dueMonth + 1,
                automatic: receipt.attributes.automatic === true,
                fallback:
                  !choice.automatic && selected[choice.key] === undefined,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          a.month - b.month ||
          (a.arc ?? -1) - (b.arc ?? -1) ||
          (a.choiceId < b.choiceId ? -1 : a.choiceId > b.choiceId ? 1 : 0),
      );
    const warnings = (responses ?? []).flatMap((response) => {
      const choice = resolveScenarioRuleChoice(response, rules)!;
      return reached.some(
        (answer) =>
          answer.choiceId === response.choiceId && answer.arc === response.arc,
      )
        ? []
        : [`Response ${choice.key}/${response.optionId} was never reached.`];
    });
    return {
      seed,
      difficulty,
      packageDigest: scenario.mod!.packageDigest,
      runtimeDigest: scenario.mod!.runtimeDigest,
      responses: reached,
      objectiveResults: result.objectiveResults,
      outcome:
        result.outcome === "completed" &&
        result.months.length < scenario.durationMonths
          ? "inProgress"
          : result.outcome,
      outcomeMonth:
        result.bankruptAtMonth ?? result.firedAtMonth ?? result.months.length,
      warnings,
      result,
    };
  });
}

export function formatModSimulation(run: ModSimulationRun): string {
  const { result } = run;
  return [
    `${result.scenario.name} · seed ${run.seed} · ${run.difficulty}`,
    `Package digest: ${run.packageDigest}`,
    `Runtime digest: ${run.runtimeDigest}`,
    "Branch responses:",
    ...(run.responses.length
      ? run.responses.map(
          (answer) =>
            `  Month ${answer.month}: ${answer.arc === undefined ? "" : `arc ${answer.arc}/`}${answer.choiceId}/${answer.optionId}${answer.automatic ? " (automatic)" : answer.fallback ? " (free fallback)" : " (explicit)"}`,
        )
      : ["  None reached."]),
    "Objectives:",
    ...(run.objectiveResults.length
      ? run.objectiveResults.flatMap((objective) => [
          `  ${objective.label} · ${objective.required ? "Required" : "Optional"} · ${objectiveStatusText[objective.status]}`,
          `    ${objective.definition}`,
          `    ${objectiveTargetText(objective.objective)} · ${objectiveWindowText(objective.objective, result.scenario.startingYear, result.scenario.durationMonths)}`,
          `    ${objectiveObservedText(objective)}${objective.reason ? ` ${objective.reason}` : ""}`,
        ])
      : ["  No scenario goals. Ordinary game failures still apply."]),
    `Outcome: ${run.outcome} at month ${run.outcomeMonth} of ${result.scenario.durationMonths}`,
    `Invariants: ${result.violationCount === 0 ? "all passed" : `${result.violationCount} failed`}`,
    ...result.violations.map(
      (violation) =>
        `  ${violation.rule} @ ${violation.when}: ${violation.detail}`,
    ),
    ...run.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}

/** Facts are already computed by the shared authoring owner; formatting adds no judgments. */
export function formatModAuthorReport(
  report: ModAuthorReport,
  explain = false,
): string {
  const diagnostics = report.diagnostics.map(
    (diagnostic) =>
      `${diagnostic.severity.toUpperCase()} ${diagnostic.path} [${diagnostic.code}]: ${diagnostic.message}`,
  );
  const facts = (sections: ModAuthorReport["sections"]) =>
    sections.flatMap((section) => [
      section.title,
      ...(section.description ? [`  ${section.description}`] : []),
      ...section.rows.flatMap((row) => [
        `  ${row.label}: ${row.value}`,
        ...(row.details ?? []).map((detail) => `    ${detail}`),
      ]),
    ]);
  return [
    `${report.valid ? "Valid" : "Invalid"}: ${report.title}`,
    ...diagnostics,
    ...facts(report.sections),
    ...(explain
      ? Object.entries(report.difficulties).flatMap(([difficulty, value]) => [
          `Difficulty: ${difficulty}`,
          ...facts(value!.sections),
        ])
      : []),
    ...(explain && report.inheritedObjectives.length
      ? [
          "Inherited objectives (replace-ready JSON):",
          JSON.stringify(
            { mode: "replace", items: report.inheritedObjectives },
            null,
            2,
          ),
        ]
      : []),
  ].join("\n");
}
