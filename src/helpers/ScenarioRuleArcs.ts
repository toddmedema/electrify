import type {
  CompiledRuleEvent,
  CompiledScenarioRules,
  RuleDiagnostic,
  RuleReport,
} from "../data/ScenarioRules";
import {
  resolveStoryPhase,
  resolveStoryScheduleMonth,
  STORY_ARC_DEFINITIONS,
  storyPhaseKey,
} from "../data/WorldEvents";
import type {
  StoryArcDefinitionType,
  StoryContextType,
  StoryPhaseDefinitionType,
} from "../data/WorldEvents";
import { SCENARIOS } from "../data/Scenarios";
import { relocateOfficialArcMonth } from "./ScenarioArcTiming";
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
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { getScenarioLocation } from "./Locations";
import { isRuleJson } from "./ScenarioRulesSchema";
export { relocateOfficialArcMonth } from "./ScenarioArcTiming";

export interface OfficialArcSource {
  scenarioId: number;
  arcId: string;
  phaseId: string;
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
  protection?: { kind: "deepFreezeWinterization" | "wildfirePreparedness" };
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

function reportsFor(
  arc: StoryArcDefinitionType,
  phase: StoryPhaseDefinitionType,
  startMonth: number,
  events: readonly CompiledOfficialArcEvent[],
): RuleReport[] {
  const id = eventId(arc.scenarioId, phase.id);
  const window = (months = 12) => ({
    fromMonth: Math.max(0, startMonth - months),
    throughMonth: startMonth - 1,
  });
  const reliability = (months = 12): RuleReport => ({
    id: `${id}-reliability`,
    kind: "reliability",
    ...window(months),
    minDemandServedShare: 0.999,
  });
  const affected = (phaseId: string): RuleReport => ({
    id: `${id}-affected`,
    kind: "affectedFacilities",
    eventId: eventId(arc.scenarioId, phaseId),
  });
  const mix = (
    fuels: Extract<RuleReport, { kind: "fuelMix" }>["fuels"],
  ): RuleReport => ({
    id: `${id}-fuel-mix`,
    kind: "fuelMix",
    ...window(),
    fuels,
    basis: "customerDemand",
  });
  switch (`${arc.scenarioId}:${phase.id}`) {
    case "103:normalization":
      return [mix(["Natural Gas"]), reliability()];
    case "105:local-energy-review":
      return [
        mix(["Coal", "Natural Gas", "Oil", "Uranium", "Biomass"]),
        reliability(),
      ];
    case "101:integration-review":
      return [
        mix(["Sun", "Wind", "Offshore Wind", "Airborne Wind"]),
        reliability(),
        { id: `${id}-firm-coverage`, kind: "firmCoverage", ...window() },
        { id: `${id}-storage-coverage`, kind: "storageCoverage", ...window() },
      ];
    case "102:successor-review":
      return [
        mix(["Coal"]),
        reliability(),
        { id: `${id}-profit-loss`, kind: "profitLoss", ...window() },
        { id: `${id}-firm-coverage`, kind: "firmCoverage", ...window() },
      ];
    case "104:landfall":
    case "111:firestorm":
    case "102:aging-derate":
    case "110:trip":
      return [affected(phase.id)];
    case "104:restoration": {
      const onset = events.find((event) => event.source.phaseId === "landfall");
      return [affected("landfall"), reliability(onset?.durationMonths ?? 0)];
    }
    case "111:restoration-complete":
      return [affected("firestorm"), reliability(2)];
    case "107:thaw":
      // March has not completed at thaw onset. The full before/impact/after review is a debrief.
      return [reliability(1)];
    default:
      return [];
  }
}

/** Trusted callbacks are used only while compiling catalog content, never by the interpreter. */
export function compileOfficialArcEvents(
  params: OfficialArcCompileParameters,
  scenarioIds: readonly number[],
): CompiledOfficialArcEvent[] {
  const results: CompiledOfficialArcEvent[] = [];
  const diagnostics = params.diagnostics ?? [];
  for (const scenarioId of [...new Set(scenarioIds)].sort((a, b) => a - b)) {
    const source = SCENARIOS.find((scenario) => scenario.id === scenarioId);
    if (!source || source.tutorialSteps) {
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
    );
    if (!location)
      throw new Error(`Official arc ${scenarioId} has no receiving location.`);
    const context: StoryContextType = {
      seed: params.seed,
      scenarioId: imported ? 999 : scenarioId,
      difficulty: params.difficulty,
      date: getDateFromMinute(0, params.startingYear),
      location,
      snapshot: {
        deliveredWhByFuel12m: {},
        demandWh12m: 0,
        unservedWh12m: 0,
        netIncome12m: 0,
        peakDemandW12m: 0,
        firmPeakW: 0,
        storagePeakW: 0,
        storagePeakWh: 0,
        facilities: [],
      },
      ...(imported
        ? {
            customEvents: [
              {
                scenarioId,
                moneyScale: 1,
              },
            ],
          }
        : {}),
    };
    for (const arc of STORY_ARC_DEFINITIONS.filter(
      (definition) => definition.scenarioId === scenarioId,
    )) {
      const arcResults: CompiledOfficialArcEvent[] = [];
      for (const phase of arc.phases) {
        const resolved = resolveStoryPhase(arc, phase, context);
        const originalDuration =
          (resolved.endsMinute - resolved.startsMinute) / MINUTES_PER_MONTH;
        const offset =
          typeof phase.scheduleOffsetMonths === "function"
            ? phase.scheduleOffsetMonths(context)
            : (phase.scheduleOffsetMonths ?? 0);
        const shift = (month: number) =>
          relocateOfficialArcMonth(scenarioId, month + offset, "phase");
        const startMonth = shift(
          officialArcScheduleMonth(arc, phase, params.seed),
        );
        const possibleStartMonths =
          "atMonth" in phase.schedule
            ? {
                from: shift(phase.schedule.atMonth),
                to: shift(phase.schedule.atMonth),
              }
            : {
                from: shift(phase.schedule.seededMonthRange.firstMonth),
                to: shift(phase.schedule.seededMonthRange.lastMonth),
              };
        const id = eventId(scenarioId, phase.id);
        const key =
          params.namespace.kind === "mod"
            ? `mod:${params.namespace.id}:arc:${scenarioId}:${arc.id}:${phase.id}`
            : resolved.key;
        const event: CompiledOfficialArcEvent = {
          id,
          key,
          title: resolved.title ?? "Scenario event",
          message: resolved.message,
          startMonth,
          possibleStartMonths,
          durationMonths: Math.max(
            0,
            Math.min(originalDuration, params.durationMonths - startMonth),
          ),
          visibility: phase.forecastable === false ? "surprise" : "forecast",
          effects: detached(resolved.effects),
          targets: [],
          transactions: [],
          source: {
            scenarioId,
            arcId: arc.id,
            phaseId: phase.id,
            kind: resolved.kind,
            ...(resolved.concept ? { concept: resolved.concept } : {}),
            ...(resolved.importance ? { importance: resolved.importance } : {}),
            ...(resolved.actionTarget
              ? { actionTarget: detached(resolved.actionTarget) }
              : {}),
            ...(resolved.turningPointPriority !== undefined
              ? { turningPointPriority: resolved.turningPointPriority }
              : {}),
          },
        };
        if (imported && event.effects.operatingExpensePerMonth !== undefined)
          event.effects.operatingExpensePerMonth = officialArcMoneyAmount(
            event.effects.operatingExpensePerMonth,
            source,
            params.receivingScenario,
          );
        const preview = phase.preview(context, (attribute) => {
          // Current catalog previews do not draw. Keep the trusted resolver's addressed draw if one does.
          const probe: StoryPhaseDefinitionType = {
            ...phase,
            describe: (_context, random) => ({
              kind: "WORLD_EVENT",
              message: "",
              attributes: { value: random(attribute) },
            }),
          };
          return Number(
            resolveStoryPhase(arc, probe, context).attributes.value,
          );
        });
        if (preview && phase.forecastable !== false)
          event.preview = preview.message;
        if (
          (scenarioId === 104 && phase.id === "landfall") ||
          (scenarioId === 111 && phase.id === "firestorm")
        ) {
          event.targets = [
            {
              target: {
                selector: "seededOperatingCapacityShare",
                targetCapacityShare: Number(
                  resolved.attributes.targetCapacityShare,
                ),
              },
              outputMultiplier: Number(resolved.attributes.outputMultiplier),
            },
          ];
          event.source.drawKey = resolved.key;
          delete event.effects.facilityOutputMultipliersById;
          event.message =
            scenarioId === 104
              ? `Storm damage reduces affected generator output to ${Math.round(event.targets[0].outputMultiplier * 100)}% for ${originalDuration} months. Oil prices rise ${Math.round(((event.effects.fuelPriceMultipliers?.Oil ?? 1) - 1) * 100)}%.`
              : `Safety shutoffs disconnect ${Math.round((1 - (event.effects.demandMultiplier ?? 1)) * 100)}% of demand and reduce affected generator output. Repairs continue for ${originalDuration} months.`;
          if (scenarioId === 111)
            event.protection = { kind: "wildfirePreparedness" };
        }
        if (scenarioId === 102 && phase.id === "aging-derate") {
          event.targets = [
            {
              target: {
                selector: "operatingAtLeastAge",
                fuel: "Coal",
                minAgeYears: 30,
              },
              outputMultiplier: Number(resolved.attributes.outputMultiplier),
            },
          ];
          delete event.effects.facilityOutputMultipliersById;
          event.message = `Operating coal plants at least 30 years old are down to ${Math.round(event.targets[0].outputMultiplier * 100)}% output for ${originalDuration} months.`;
        }
        if (scenarioId === 102 && phase.id === "aging-warning")
          event.message =
            "Coal plants that reach 30 years of age in two years will face a temporary output limit. Prepare replacement power.";
        if (scenarioId === 110 && phase.id === "trip") {
          const assetId = source.facilities?.find(
            (facility) => facility.label === "Grand Nuclear Unit",
          )?.assetId;
          if (!assetId)
            throw new Error(
              "Nuclear trip catalog asset is missing its stable identity.",
            );
          if (!params.startingAssetIds.includes(assetId))
            diagnostics.push({
              code: "missing-starting-asset",
              path: `rules.officialArcs[${scenarioId}]`,
              severity: "error",
              message: `Sudden Nuclear Shutdown requires starting asset ${assetId}. Choose its original base scenario or remove this arc.`,
            });
          event.targets = [
            {
              target: { selector: "startingAsset", assetId },
              outputMultiplier: 0,
            },
          ];
          delete event.effects.facilityOutputMultipliersById;
          event.title = "Grand Nuclear Unit shuts down";
          event.message =
            "The original Grand Nuclear Unit is offline while it remains owned. Replace its power with generation, storage or imports.";
        }
        if (scenarioId === 107 && phase.id === "uri")
          event.protection = { kind: "deepFreezeWinterization" };
        if (
          [
            "normalization",
            "integration-review",
            "successor-review",
            "local-energy-review",
          ].includes(phase.id)
        )
          event.message =
            "Review the grid's recorded results for the previous twelve months.";
        if (scenarioId === 104 && phase.id === "restoration")
          event.message =
            "Storm repairs finish. Affected generator output and oil prices return to normal.";
        if (scenarioId === 111 && phase.id === "restoration-complete")
          event.message =
            "Safety shutoffs end and repairs finish. Affected generators return to normal.";
        if (scenarioId === 107 && phase.id === "thaw")
          event.message =
            "The freeze ends. Normal plant output and gas prices return as the cold eases.";
        if (possibleStartMonths.to >= params.durationMonths)
          diagnostics.push({
            code: "outside-term",
            path: `rules.officialArcs[${scenarioId}].${phase.id}`,
            severity: "error",
            message: `${event.title} can occur in month ${possibleStartMonths.to + 1}, after this run ends in month ${params.durationMonths}. Extend the term or remove this arc.`,
          });
        if (
          possibleStartMonths.to + originalDuration > params.durationMonths &&
          originalDuration > 0
        )
          diagnostics.push({
            code: "duration-truncated",
            path: `rules.officialArcs[${scenarioId}].${phase.id}.durationMonths`,
            severity: "warning",
            message: `${event.title}'s duration is truncated at the end of the run.`,
          });
        arcResults.push(event);
      }
      for (const event of arcResults) {
        const phase = arc.phases.find(
          (definition) => definition.id === event.source.phaseId,
        )!;
        const reports = reportsFor(arc, phase, event.startMonth, arcResults);
        if (reports.length) event.reports = reports;
      }
      results.push(...arcResults);
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
  // No authored function, source object, activation fact or installed-library reference escapes.
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
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
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
      "drawKey",
      "kind",
      "concept",
      "importance",
      "actionTarget",
      "turningPointPriority",
    ]) ||
    !IMPORTABLE_ARCS.includes(Number(source.scenarioId)) ||
    typeof source.scenarioId !== "number" ||
    !identifier(source.arcId) ||
    !identifier(source.phaseId) ||
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
      (source.scenarioId === 104 &&
        source.arcId === "hurricane-2008" &&
        source.phaseId === "landfall") ||
      (source.scenarioId === 111 &&
        source.arcId === "california-wildfire-2025" &&
        source.phaseId === "firestorm")
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
    if (
      !(
        value.protection.kind === "deepFreezeWinterization" &&
        source.scenarioId === 107 &&
        source.phaseId === "uri"
      ) &&
      !(
        value.protection.kind === "wildfirePreparedness" &&
        source.scenarioId === 111 &&
        source.phaseId === "firestorm"
      )
    )
      return false;
  }
  // Generic compiled-event/report validation owns effects, targets and report quantities.
  return (
    value.reports === undefined ||
    (Array.isArray(value.reports) && value.reports.length <= 4)
  );
}

/** Resolve the trusted linked schedule without exposing a caller-selected stream or random key. */
export function officialArcScheduleMonth(
  arc: StoryArcDefinitionType,
  phase: StoryPhaseDefinitionType,
  seed: number,
): number {
  return resolveStoryScheduleMonth(
    phase.schedule,
    seed,
    storyPhaseKey(arc.scenarioId, arc.id, phase.scheduleAddress ?? phase.id),
  );
}
