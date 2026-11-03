import { officialScenarioRules } from "./ScenarioRules";
import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";
import type {
  CompiledRuleEvent,
  CompiledScenarioRules,
  RuleDiagnostic,
  RuleReport,
} from "../data/ScenarioRules";
import { SCENARIOS } from "../data/Scenarios";
import { getStartingCustomers } from "../data/LocationProfiles";
import { inEraMoney } from "../data/FuelPrices";
import type {
  ConceptNameType,
  DifficultyType,
  GameEventImportanceType,
  GameEventKindType,
  ScenarioType,
  StoryActionTargetType,
} from "../Types";
import { getScenarioLocation } from "./Locations";
import { isRuleJson, UNSAFE_TEXT, UNSAFE_MARKUP } from "./ScenarioRulesSchema";
export { relocateOfficialArcMonth } from "./ScenarioArcTiming";

export interface OfficialArcSource {
  scenarioId: number;
  arcId: string;
  phaseId: string;
  previewTitle?: string;
  /** Catalog-owned RNG address; packages cannot author this field. */
  drawKey?: string;
  kind?: GameEventKindType;
  concept?: ConceptNameType;
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
  turningPointPriority?: number;
}

export interface CompiledOfficialArcEvent extends CompiledRuleEvent {
  source: OfficialArcSource;
  reports?: RuleReport[];
  protection?: { kind: "deepFreezeWinterization" };
}

export interface OfficialArcCompileParameters {
  namespace: CompiledScenarioRules["namespace"];
  difficulty: DifficultyType;
  seed: number;
  startingYear: number;
  durationMonths: number;
  startingAssetIds: readonly string[];
  receivingScenario: ScenarioType;
  diagnostics?: RuleDiagnostic[];
}

/** Use the same demand owner as Custom Game; authored campus loads scale with grid size. */
export function officialArcLoadScale(
  source: ScenarioType,
  receiving: ScenarioType,
): number {
  const demand = (scenario: ScenarioType) =>
    (scenario.startingCustomers ??
      getStartingCustomers(getScenarioLocation(scenario))) *
    (scenario.startingDemandScale ?? 1);
  return demand(receiving) / demand(source);
}

/** Fixed company budgets change with receiving-grid size and era, never percentage shocks. */
export function officialArcMoneyAmount(
  amount: number,
  source: ScenarioType,
  receiving: ScenarioType,
): number {
  return inEraMoney(
    amount * officialArcLoadScale(source, receiving),
    receiving.startingYear,
    source.startingYear,
  );
}

const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const eventId = (scenarioId: number, phaseId: string) =>
  `arc-${scenarioId}-${phaseId}`;

/** Catalog definitions use the common compiler. Adapt only receiving-grid units, keys and copy. */
export function compileOfficialArcEvents(
  params: OfficialArcCompileParameters,
  scenarioIds: readonly number[],
): CompiledOfficialArcEvent[] {
  const results: CompiledOfficialArcEvent[] = [];
  const diagnostics = params.diagnostics ?? [];
  for (const scenarioId of [...new Set(scenarioIds)].sort((a, b) => a - b)) {
    const source = SCENARIOS.find(
      (scenario) => scenario.id === scenarioId && !scenario.tutorialSteps,
    );
    const shared =
      source &&
      officialScenarioRules(source, params, {
        startingYear: params.startingYear,
      });
    if (!source || !shared) {
      diagnostics.push({
        code: "unknown-arc",
        path: `rules.officialArcs[${scenarioId}]`,
        severity: "error",
        message: `Official arc ${scenarioId} is not an importable challenge.`,
      });
      continue;
    }
    const imported = params.namespace.kind === "mod";
    const location = getScenarioLocation(
      imported ? params.receivingScenario : source,
    )!;
    for (const compiled of shared.events) {
      const { report, reports, ...base } = detached(compiled);
      const phaseId = compiled.source!.phaseId;
      const id = eventId(scenarioId, phaseId);
      const effects = { ...compiled.effects };
      if (imported && effects.operatingExpensePerMonth !== undefined)
        effects.operatingExpensePerMonth = officialArcMoneyAmount(
          effects.operatingExpensePerMonth,
          source,
          params.receivingScenario,
        );
      const changes = scenarioEffectsSummary(effects);
      const event: CompiledOfficialArcEvent = {
        ...base,
        effects,
        id,
        key: imported
          ? `mod:${params.namespace.kind === "mod" ? params.namespace.id : ""}:arc:${scenarioId}:${compiled.source!.arcId}:${phaseId}`
          : compiled.key,
        title: imported
          ? compiled.title.replace(
              /\b(?:19|20)\d{2}\b/g,
              String(
                params.startingYear + Math.floor(compiled.startMonth / 12),
              ),
            )
          : compiled.title,
        message: imported
          ? `${location.name}: ${changes.length ? changes.join("; ") + "." : "Review your supply and reserves before the upcoming scenario event."}`
          : compiled.message,
        durationMonths: Math.max(
          0,
          Math.min(
            compiled.durationMonths,
            params.durationMonths - compiled.startMonth,
          ),
        ),
        source: detached(compiled.source!),
      };
      const observations = [
        ...(reports ?? []),
        ...(report ? [report] : []),
      ].map((observation) => ({
        ...observation,
        id: observation.id.startsWith(`arc-${scenarioId}-`)
          ? observation.id
          : `arc-${scenarioId}-${observation.id}`,
        ...(observation.kind === "affectedFacilities"
          ? { eventId: eventId(scenarioId, observation.eventId) }
          : {}),
      }));
      if (observations.length) event.reports = observations;
      for (const operation of event.targets)
        if (
          operation.target.selector === "startingAsset" &&
          !params.startingAssetIds.includes(operation.target.assetId)
        )
          diagnostics.push({
            code: "missing-starting-asset",
            path: `rules.officialArcs[${scenarioId}]`,
            severity: "error",
            message: `Sudden Nuclear Shutdown requires starting asset ${operation.target.assetId}. Choose its original base scenario or remove this arc.`,
          });
      if (event.possibleStartMonths.to >= params.durationMonths)
        diagnostics.push({
          code: "outside-term",
          path: `rules.officialArcs[${scenarioId}].${phaseId}`,
          severity: "error",
          message: `${event.title} can occur in month ${event.possibleStartMonths.to + 1}, after this run ends in month ${params.durationMonths}. Extend the term or remove this arc.`,
        });
      if (
        event.possibleStartMonths.to + compiled.durationMonths >
          params.durationMonths &&
        compiled.durationMonths > 0
      )
        diagnostics.push({
          code: "duration-truncated",
          path: `rules.officialArcs[${scenarioId}].${phaseId}.durationMonths`,
          severity: "warning",
          message: `${event.title}'s duration is truncated at the end of the run.`,
        });
      results.push(event);
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
  return detached(
    results.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  );
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const IMPORTABLE_ARCS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115, 116,
];

function validActionTarget(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.card === "EVENTS") return only(value, ["card"]);
  if (value.card === "FACILITIES")
    return (
      only(value, ["card", "view"]) &&
      (value.view === undefined ||
        value.view === "FLEET" ||
        value.view === "BUILD_GENERATORS")
    );
  return (
    value.card === "INSIGHTS" &&
    only(value, ["card", "layer"]) &&
    (value.layer === undefined ||
      ["FINANCES", "SUPPLY_DEMAND", "FUEL_PRICES"].includes(
        String(value.layer),
      ))
  );
}

/** Strict detached metadata validation, without looking up installed or current catalog content. */
export function validOfficialArcMetadata(value: unknown): boolean {
  if (!record(value) || !isRuleJson(value) || !record(value.source))
    return false;
  const source = value.source;
  if (
    !only(source, [
      "scenarioId",
      "arcId",
      "phaseId",
      "previewTitle",
      "drawKey",
      "kind",
      "concept",
      "importance",
      "actionTarget",
      "turningPointPriority",
    ]) ||
    !IMPORTABLE_ARCS.includes(Number(source.scenarioId)) ||
    typeof source.scenarioId !== "number" ||
    (source.scenarioId === 111 && source.arcId !== "wildfire-intertie") ||
    !identifier(source.arcId) ||
    !identifier(source.phaseId) ||
    (source.previewTitle !== undefined &&
      (typeof source.previewTitle !== "string" ||
        source.previewTitle.trim().length === 0 ||
        source.previewTitle.length > 120 ||
        UNSAFE_TEXT.test(source.previewTitle) ||
        UNSAFE_MARKUP.test(source.previewTitle))) ||
    (source.kind !== undefined && source.kind !== "WORLD_EVENT") ||
    (source.concept !== undefined &&
      ![
        "fuel",
        "danger",
        "build",
        "customers",
        "supply",
        "goal",
        "generator",
        "blackout",
        "weather",
        "forecast",
      ].includes(String(source.concept))) ||
    (source.importance !== undefined &&
      !["ROUTINE", "NOTABLE", "CRITICAL"].includes(
        String(source.importance),
      )) ||
    (source.actionTarget !== undefined &&
      !validActionTarget(source.actionTarget)) ||
    (source.turningPointPriority !== undefined &&
      (typeof source.turningPointPriority !== "number" ||
        !Number.isFinite(source.turningPointPriority) ||
        source.turningPointPriority < 0 ||
        source.turningPointPriority > 1000))
  )
    return false;
  if (
    source.drawKey !== undefined &&
    !(
      source.scenarioId === 104 &&
      source.arcId === "hurricane-2008" &&
      source.phaseId === "landfall"
    )
  )
    return false;
  if (
    source.drawKey !== undefined &&
    source.drawKey !==
      `story:${source.scenarioId}:${source.arcId}:${source.phaseId}`
  )
    return false;
  if (value.protection !== undefined) {
    if (!record(value.protection) || !only(value.protection, ["kind"]))
      return false;
    if (!(
      value.protection.kind === "deepFreezeWinterization" &&
      source.scenarioId === 107 &&
      source.phaseId === "uri"
    ))
      return false;
  }
  // Generic compiled-event/report validation owns effects, targets and report quantities.
  return (
    value.reports === undefined ||
    (Array.isArray(value.reports) && value.reports.length <= 4)
  );
}
