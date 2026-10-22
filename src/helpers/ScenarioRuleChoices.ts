import {
  catalogChoiceKey,
  SCENARIO_CHOICE_RULES,
  type CatalogScenarioChoice,
} from "../data/ScenarioChoiceRules";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { SCENARIOS } from "../data/Scenarios";
import type {
  CompiledRuleChoice,
  CompiledRuleLoad,
  CompiledRuleOption,
  RuleArc,
  RuleLoad,
  RuleChoice,
} from "../data/ScenarioRules";
import type { ScenarioType } from "../Types";
import { MONTH_NAMES } from "../Constants";
import {
  officialArcLoadScale,
  officialArcMoneyAmount,
  type OfficialArcCompileParameters,
} from "./ScenarioRuleArcs";
import { relocateOfficialArcMonth } from "./ScenarioArcTiming";
import { formatMoneyConcise, formatWatts } from "./Format";
import { ruleNumber } from "./ScenarioRules";
import { ID_PATTERN, isRuleJson, ruleDiagnostics } from "./ScenarioRulesSchema";

const byId = <T extends { id: string }>(a: T, b: T) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const detach = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const idFor = (source: CatalogScenarioChoice) =>
  `arc-${source.scenarioId}-${source.choice.id}`;

/** Generic author units let the shared contract validate every scaled value and text field. */
export function arcChoiceDefinition(choice: CompiledRuleChoice): RuleChoice {
  return {
    id: choice.id,
    dueMonth: choice.dueMonth + 1,
    title: choice.title,
    prompt: choice.prompt,
    ...(choice.requiresChoice ? { requiresChoice: choice.requiresChoice } : {}),
    options: choice.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      message: option.message,
      ...(option.grant > 0
        ? { grantDollars: option.grant }
        : { costDollars: option.cost }),
      ...(option.replaceLoad
        ? {
            replaceLoad: {
              ...(option.replaceLoad.arc === undefined
                ? {}
                : { arc: option.replaceLoad.arc }),
              loadId: option.replaceLoad.loadId,
              with: option.replaceLoad.with.map((load) => ({
                id: load.id,
                startMonth: load.startMonth + 1,
                demandType: load.demandType as "Data Centers" | "Mining",
                loadFactor: load.loadFactor,
                peakMW: load.peakW / 1e6,
                ...(load.supplementsBackground === undefined
                  ? {}
                  : { supplementsBackground: load.supplementsBackground }),
              })),
            },
          }
        : {}),
      ...(option.eventIds ? { eventIds: option.eventIds } : {}),
    })),
  };
}

function calendar(month: number, year: number): string {
  return `${MONTH_NAMES[month % 12]} ${year + Math.floor(month / 12)}`;
}

/** Catalog copy contains historical dates; packages never get text substitution operations. */
function relocateYears(text: string, years: number): string {
  return text.replace(/\b(?:19|20)\d{2}\b/g, (year) =>
    String(Number(year) + years),
  );
}

function description(option: CompiledRuleOption): CompiledRuleOption {
  return {
    ...option,
    description: option.description
      .replaceAll("{grant}", formatMoneyConcise(option.grant))
      .replaceAll("{cost}", formatMoneyConcise(option.cost)),
  };
}

function connectionCopy(
  option: CompiledRuleOption,
  source: ScenarioType,
  receiving: ScenarioType,
  sourceLoadId: string | undefined,
): CompiledRuleOption | undefined {
  const campus = source.loadAdditions?.find((load) => load.id === sourceLoadId);
  if (!campus) return undefined;
  const month = relocateOfficialArcMonth(
    source.id,
    (campus.startsYear - source.startingYear) * 12 +
      (campus.startsMonth ?? 1) -
      1,
    "load",
  );
  const peak = formatWatts(
    campus.peakW * officialArcLoadScale(source, receiving),
  );
  const date = calendar(month, receiving.startingYear);
  if (!option.replaceLoad && option.grant > 0)
    return {
      ...option,
      description: `Receive ${formatMoneyConcise(option.grant)} to connect all ${peak} in ${date}.`,
      message: `Funding received. Connect ${peak} in ${date}.`,
    };
  if (option.replaceLoad?.with.length === 2) {
    const schedules = [...option.replaceLoad.with].sort(
      (a, b) => a.startMonth - b.startMonth || byId(a, b),
    );
    const phases = schedules
      .map(
        (load) =>
          `${formatWatts(load.peakW)} in ${calendar(load.startMonth, receiving.startingYear)}`,
      )
      .join(" and ");
    return {
      ...option,
      description: `Forgo funding. Connect ${phases}, delaying half the sales.`,
      message: `Connect ${phases}. No funding received.`,
    };
  }
  return undefined;
}

/**
 * Compile catalog choices directly from common data. This never calls cost/grant callbacks,
 * and the returned snapshot contains no lookup back into the current catalog or library.
 */
export function compileOfficialArcChoices(
  params: OfficialArcCompileParameters,
  arcs: readonly RuleArc[],
): CompiledRuleChoice[] {
  const diagnostics = params.diagnostics ?? [];
  const choices: CompiledRuleChoice[] = [];
  const fail = (scenarioId: number, detail: string) =>
    diagnostics.push({
      code: "unsupported-choice-adaptation",
      path: `rules.officialArcs[${scenarioId}]`,
      severity: "error",
      message: detail,
    });
  const within = (scenarioId: number, month: number, path: string) => {
    if (month < 0 || month >= params.durationMonths)
      diagnostics.push({
        code: "outside-term",
        path,
        severity: "error",
        message: `Arc ${scenarioId} requires month ${month + 1}, outside this ${params.durationMonths}-month run. Extend the term or remove this arc.`,
      });
  };
  for (const arc of [...arcs].sort((a, b) => a.scenarioId - b.scenarioId)) {
    const scenario = SCENARIOS.find(
      (item) => item.id === arc.scenarioId && !item.tutorialSteps,
    );
    if (!scenario) {
      fail(
        arc.scenarioId,
        `Arc ${arc.scenarioId} has no importable source scenario.`,
      );
      continue;
    }
    const definitions = SCENARIO_CHOICE_RULES.filter(
      (item) => item.scenarioId === arc.scenarioId,
    );
    // Until the legacy presentation adapter retires, do not silently drop an unconverted choice.
    for (const legacy of SCENARIO_CHOICES.filter(
      (item) => item.scenarioId === arc.scenarioId,
    ))
      if (!definitions.some((entry) => catalogChoiceKey(entry) === legacy.id))
        fail(
          arc.scenarioId,
          `Choice ${legacy.id} has no declarative adaptation. Remove this arc until its choice is supported.`,
        );
    const imported = params.namespace.kind === "mod";
    if (
      params.namespace.kind === "official" &&
      params.namespace.scenarioId !== arc.scenarioId
    ) {
      fail(
        arc.scenarioId,
        "An official choice must belong to its trusted source scenario.",
      );
      continue;
    }
    const money = (amount: number) =>
      imported
        ? officialArcMoneyAmount(amount, scenario, params.receivingScenario)
        : amount;
    const loadScale = imported
      ? officialArcLoadScale(scenario, params.receivingScenario)
      : 1;
    const yearShift = params.startingYear - scenario.startingYear;
    for (const entry of definitions) {
      const definition = entry.choice;
      const dueMonth = relocateOfficialArcMonth(
        entry.scenarioId,
        definition.dueMonth - 1,
        "choice",
      );
      const id = idFor(entry);
      within(
        entry.scenarioId,
        dueMonth,
        `rules.officialArcs[${entry.scenarioId}].choices.${definition.id}.dueMonth`,
      );
      if (
        definition.requiresChoice ||
        definition.options.some((option) => option.eventIds?.length)
      ) {
        fail(
          entry.scenarioId,
          `Choice ${definition.id} needs an explicit conditional-event adaptation.`,
        );
        continue;
      }
      const options = [...definition.options]
        .sort(byId)
        .map((option): CompiledRuleOption => {
          const cost = money(
            ruleNumber(option.costDollars ?? 0, params.difficulty),
          );
          const grant = money(
            ruleNumber(option.grantDollars ?? 0, params.difficulty),
          );
          const result: CompiledRuleOption = {
            id: option.id,
            label: option.label,
            description: imported
              ? relocateYears(option.description, yearShift)
              : option.description,
            message: imported
              ? relocateYears(option.message, yearShift)
              : option.message,
            cost,
            grant,
            ...(option.meaningful === false ? { meaningful: false } : {}),
          };
          if (option.replaceLoad) {
            const sourceLoad = scenario.loadAdditions?.find(
              (load) => load.id === option.replaceLoad!.loadId,
            );
            if (!sourceLoad)
              fail(
                entry.scenarioId,
                `Choice ${definition.id} references a missing source load ${option.replaceLoad.loadId}.`,
              );
            else {
              const startMonth =
                (sourceLoad.startsYear - scenario.startingYear) * 12 +
                (sourceLoad.startsMonth ?? 1) -
                1;
              if (startMonth <= dueMonth)
                fail(
                  entry.scenarioId,
                  `Choice ${definition.id} cannot replace load ${sourceLoad.id} after it starts.`,
                );
            }
            const withLoads: CompiledRuleLoad[] = option.replaceLoad.with.map(
              (load: RuleLoad) => {
                const startMonth = relocateOfficialArcMonth(
                  entry.scenarioId,
                  load.startMonth - 1,
                  "load",
                );
                within(
                  entry.scenarioId,
                  startMonth,
                  `rules.officialArcs[${entry.scenarioId}].choices.${definition.id}.replaceLoad.${load.id}.startMonth`,
                );
                if (load.peakMW === undefined)
                  fail(
                    entry.scenarioId,
                    `Choice ${definition.id} needs a source-grid peak to adapt load ${load.id}.`,
                  );
                if (startMonth <= dueMonth)
                  fail(
                    entry.scenarioId,
                    `Choice ${definition.id} must schedule replacement ${load.id} after its decision.`,
                  );
                return {
                  id: load.id,
                  eventId: id,
                  startMonth,
                  label: load.demandType,
                  demandType: load.demandType,
                  startsYear: params.startingYear + Math.floor(startMonth / 12),
                  startsMonth: (startMonth % 12) + 1,
                  peakW: (load.peakMW ?? 0) * 1e6 * loadScale,
                  loadFactor: load.loadFactor,
                  ...(load.supplementsBackground === undefined
                    ? {}
                    : { supplementsBackground: load.supplementsBackground }),
                };
              },
            );
            result.replaceLoad = {
              arc: entry.scenarioId,
              loadId: option.replaceLoad.loadId,
              with: withLoads,
            };
          }
          if (imported && entry.scenarioId === 106) {
            const copied = connectionCopy(
              result,
              scenario,
              params.receivingScenario,
              definition.options.find((item) => item.replaceLoad)?.replaceLoad
                ?.loadId,
            );
            if (!copied)
              fail(
                entry.scenarioId,
                `Choice ${definition.id}/${option.id} cannot describe its relocated connection faithfully.`,
              );
            else return description(copied);
          }
          return description(result);
        });
      const freeOptionId = options.find((option) => option.cost === 0)?.id;
      if (!freeOptionId) {
        fail(
          entry.scenarioId,
          `Choice ${definition.id} needs a free option on ${params.difficulty}.`,
        );
        continue;
      }
      const compiled: CompiledRuleChoice = {
        id,
        key: imported
          ? `mod:${params.namespace.kind === "mod" ? params.namespace.id : ""}:arc:${entry.scenarioId}:choice:${definition.id}`
          : catalogChoiceKey(entry),
        dueMonth,
        title: definition.title,
        prompt: imported
          ? relocateYears(definition.prompt, yearShift)
          : definition.prompt,
        options,
        freeOptionId,
        ...(arc.includeChoices ? {} : { automatic: true }),
        source: {
          scenarioId: entry.scenarioId,
          arcId: entry.arcId,
          choiceId: definition.id,
        },
      };
      diagnostics.push(
        ...ruleDiagnostics({
          objectives: [],
          choices: [arcChoiceDefinition(compiled)],
        }).map((diagnostic) => ({
          ...diagnostic,
          path: diagnostic.path.replace(
            "choices[0]",
            `rules.officialArcs[${entry.scenarioId}].choices.${definition.id}`,
          ),
        })),
      );
      choices.push(compiled);
    }
  }
  if (
    !params.diagnostics &&
    diagnostics.some((diagnostic) => diagnostic.severity === "error")
  )
    throw new Error(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join("\n"),
    );
  return detach(
    choices.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  );
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Source extensions are checked without loading or re-executing installed catalog content. */
export function validOfficialArcChoiceMetadata(value: unknown): boolean {
  if (!record(value) || !isRuleJson(value) || !record(value.source))
    return false;
  const source = value.source;
  return (
    Object.keys(source).every((key) =>
      ["scenarioId", "arcId", "choiceId"].includes(key),
    ) &&
    typeof source.scenarioId === "number" &&
    [106, 107, 111].includes(source.scenarioId) &&
    typeof source.arcId === "string" &&
    ID_PATTERN.test(source.arcId) &&
    typeof source.choiceId === "string" &&
    ID_PATTERN.test(source.choiceId) &&
    (value.automatic === undefined || value.automatic === true) &&
    Array.isArray(value.options) &&
    value.options.every(
      (option: unknown) =>
        record(option) &&
        (option.meaningful === undefined || option.meaningful === false),
    )
  );
}

/** Generated stable references for author validation and the eventual arc reference table. */
export function officialArcChoiceReferences() {
  return SCENARIO_CHOICE_RULES.map((entry) => ({
    scenarioId: entry.scenarioId,
    arcId: entry.arcId,
    choiceId: entry.choice.id,
    key: catalogChoiceKey(entry),
    dueMonth:
      relocateOfficialArcMonth(
        entry.scenarioId,
        entry.choice.dueMonth - 1,
        "choice",
      ) + 1,
    optionIds: entry.choice.options.map((option) => option.id).sort(),
    loadIds: [
      ...new Set(
        entry.choice.options.flatMap((option) =>
          option.replaceLoad
            ? [
                option.replaceLoad.loadId,
                ...option.replaceLoad.with.map((load) => load.id),
              ]
            : [],
        ),
      ),
    ].sort(),
  })).sort(
    (a, b) =>
      a.scenarioId - b.scenarioId ||
      (a.choiceId < b.choiceId ? -1 : a.choiceId > b.choiceId ? 1 : 0),
  );
}
