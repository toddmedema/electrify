import { DIFFICULTY_IDS, MONTHS, difficultyLabel } from "../Constants";
import { formatNumber } from "../helpers/Format";
import { getScenario } from "../data/Scenarios";
import { POLICIES } from "../data/Policies";
import { combineStoryEffects } from "../data/WorldEvents";
import type {
  CompiledRuleEvent,
  CompiledScenarioRules,
  ResolvedRuleSelector,
  RuleCondition,
  RuleObjective,
  RuleReport,
} from "../data/ScenarioRules";
import type { DifficultyType, PolicyId, ScenarioType } from "../Types";
import { scenarioObjectiveDefinitions } from "../helpers/ObjectiveRules";
import { objectiveDefinition } from "../helpers/ScenarioObjectives";
import {
  objectiveTargetText,
  objectiveWindowText,
} from "../helpers/ObjectivePresentation";
import { getScenarioLocation } from "../helpers/Locations";
import { scenarioEffectsSummary } from "../helpers/ScenarioEffectsSummary";
import {
  createScenarioRuleChoiceGraph,
  resolveScenarioRuleChoice,
  ruleChoices,
  scenarioRuleChoiceEnvelope,
  scenarioRuleConditionsCanCoexist,
  type ScenarioRuleChoiceGraph,
} from "../helpers/ScenarioRuleDependencies";
import {
  scenarioRuleCompositionRanges,
  scenarioRulePossibleAt,
  scenarioRuleGuaranteedAt,
} from "../helpers/ScenarioRuleComposition";
import { validScenarioMod } from "../helpers/ScenarioMod";
import { inheritedModObjectives, modAuthoringScenarios } from "./ModScenario";
import { modStaticCostFactors } from "../helpers/ModStaticCosts";
import { packageDigest, validateMod, ModValidationError } from "./ModSchema";
import { validatePublicationDescription } from "./ModPublication";
import type { ModDiagnostic, ModPackage } from "./ModSchema";

export interface ModFactRow {
  label: string;
  value: string;
  details?: string[];
}
export interface ModFactSection {
  id: string;
  title: string;
  description?: string;
  rows: ModFactRow[];
}
export interface ModRuleFacts {
  title: string;
  description: string;
  sections: ModFactSection[];
  diagnostics: ModDiagnostic[];
}
export interface ModAuthorReport extends ModRuleFacts {
  valid: boolean;
  packageDigest?: string;
  difficulties: Partial<Record<DifficultyType, ModRuleFacts>>;
  inheritedObjectives: RuleObjective[];
}
const number = (value: number) =>
  formatNumber(value, { maximumSignificantDigits: 12 });
const money = (value: number) => `$${number(value)}`;
const range = (min: number, max: number) =>
  min === max ? number(min) : `${number(min)}–${number(max)}`;
const sortedEvents = (rules: CompiledScenarioRules) =>
  [...rules.events, ...(rules.arcEvents ?? [])].sort(
    (a, b) =>
      a.startMonth - b.startMonth ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
const date = (month: number, year: number) =>
  `${MONTHS[month % 12]} ${year + Math.floor(month / 12)}`;
const at = (month: number, year: number) =>
  `Month ${month + 1} · ${date(month, year)}`;
const window = (from: number, through: number, year: number) =>
  from === through
    ? at(from, year)
    : `Months ${from + 1}–${through + 1} · ${date(from, year)}–${date(through, year)}`;

export function modSelectorDescription(selector: ResolvedRuleSelector): string {
  const fuel = "fuel" in selector && selector.fuel ? `${selector.fuel} ` : "";
  switch (selector.selector) {
    case "largestOperating":
      return `Largest operating ${fuel}generator at onset; equal capacity ties use stable facility ID.`;
    case "oldestOperating":
      return `${selector.count} oldest operating ${fuel}generators at onset; ties use stable facility ID.`;
    case "seededOperatingCapacityShare":
      return `Seeded operating ${fuel}generators covering at least ${number(selector.targetCapacityShare * 100)}% of operating capacity at onset; the same original generators stay selected after the event starts.`;
    case "operatingAtLeastAge":
      return `All operating ${fuel}generators aged at least ${selector.minAgeYears} years at onset.`;
    case "startingAsset":
      return `Original starting asset ${selector.assetId}; replacements are unaffected.`;
  }
}
function conditionText(
  rules: CompiledScenarioRules,
  condition?: RuleCondition,
): string | undefined {
  if (!condition) return undefined;
  const choice = resolveScenarioRuleChoice(condition, rules);
  return `If ${choice?.title ?? condition.choiceId}: ${condition.optionIds.map((id) => choice?.options.find((option) => option.id === id)?.label ?? id).join(" or ")}`;
}
const PLAYER_REPORTS: Record<
  RuleReport["kind"],
  { label: string; definition: string }
> = {
  reliability: {
    label: "Reliability review",
    definition:
      "Completed-month customer electricity delivered compared with customer demand.",
  },
  affectedFacilities: {
    label: "Affected facilities",
    definition:
      "Recorded original affected assets; replacements do not inherit damage.",
  },
  fuelMix: {
    label: "Fuel mix",
    definition:
      "Recorded local fuel-delivered electricity; imports and storage have no fuel provenance.",
  },
  firmCoverage: {
    label: "Firm capacity",
    definition:
      "Owned dispatchable generator capacity compared with recorded peak demand.",
  },
  storageCoverage: {
    label: "Storage capacity",
    definition:
      "Owned storage power and energy compared with recorded peak demand.",
  },
  profitLoss: {
    label: "Financial review",
    definition:
      "Recorded electricity revenues and expenses over the observation window.",
  },
  dataCenter: {
    label: "Connection review",
    definition:
      "Recorded demand, reliability and customers after the connection decision.",
  },
  deepFreeze: {
    label: "Freeze recovery review",
    definition:
      "Recorded reliability before, during and after the freeze, with the company's winterization choice.",
  },
};
function reportText(report: RuleReport, year: number, author: boolean): string {
  const wording = PLAYER_REPORTS[report.kind];
  return `${report.label ?? wording.label}${author ? ` (${report.kind})` : ""}${"fromMonth" in report ? ` · ${window(report.fromMonth, report.throughMonth, year)}` : ""} · ${wording.definition}${author && "eventId" in report ? ` Event: ${report.eventId}.` : ""}`;
}
function eventEffects(event: CompiledRuleEvent, author = false): string[] {
  return [
    ...scenarioEffectsSummary(event.effects, true),
    ...(author ? [] : event.targets).map(
      (target) =>
        `${modSelectorDescription(target.target)} Output multiplier ×${number(target.outputMultiplier)}.`,
    ),
    ...event.transactions.map(
      (transaction) =>
        `One-time ${transaction.kind}: ${money(transaction.amount)} per company.`,
    ),
  ];
}

/** Branch bounds use the dependency owner and the live engine's additive effect combiner. */
function monthlyAdditiveRanges(
  rules: CompiledScenarioRules,
  month: number,
  graph: ScenarioRuleChoiceGraph,
  events: CompiledRuleEvent[],
) {
  const possible = events.filter((event) =>
    scenarioRulePossibleAt(event, month, rules.durationMonths),
  );
  return (["temperatureOffsetC", "operatingExpensePerMonth"] as const).flatMap(
    (field) => {
      const entries = possible.filter(
        (event) => event.effects[field] !== undefined,
      );
      if (!entries.length) return [];
      const combine = (left: number, right: number) =>
        combineStoryEffects([
          { effects: { [field]: left } },
          { effects: { [field]: right } },
        ])[field] ?? 0;
      const bounds = scenarioRuleChoiceEnvelope(
        graph,
        month,
        entries.map((event) => {
          const value = event.effects[field]!;
          const guaranteed = scenarioRuleGuaranteedAt(
            event,
            month,
            rules.durationMonths,
          );
          return {
            requiresChoice: event.requiresChoice,
            min: guaranteed ? value : Math.min(0, value),
            max: guaranteed ? value : Math.max(0, value),
            positiveMin: 0,
          };
        }),
        {
          neutral: () => ({ min: 0, max: 0, positiveMin: 0 }),
          combine: (a, b) => ({
            min: combine(a.min, b.min),
            max: combine(a.max, b.max),
            positiveMin: 0,
          }),
        },
      );
      return [
        field === "temperatureOffsetC"
          ? `Temperature: ${range(bounds.min, bounds.max)} °C`
          : `Operating expense: $${range(bounds.min, bounds.max)}/month`,
      ];
    },
  );
}

const eventReference = (event: CompiledRuleEvent) =>
  event.source
    ? `arc ${event.source.scenarioId}/${event.source.phaseId}`
    : event.id;

/** Complete declarations appear once; monthly references never guess onset-selected identities. */
function selectorFacts(
  rules: CompiledScenarioRules,
  graph: ScenarioRuleChoiceGraph,
  events: CompiledRuleEvent[],
) {
  const declarations = events
    .filter((event) => event.targets.length)
    .map((event) => {
      const reference = eventReference(event);
      const throughMonth = event.durationUntilEnd
        ? rules.durationMonths - 1
        : Math.min(
            rules.durationMonths - 1,
            event.possibleStartMonths.to + event.durationMonths - 1,
          );
      const condition =
        conditionText(rules, event.requiresChoice) ?? "Unconditional.";
      const activeWindow = window(
        event.possibleStartMonths.from,
        throughMonth,
        rules.startingYear,
      );
      const targets = event.targets.map(
        (target) =>
          `${number(target.outputMultiplier * 100)}% output · ${modSelectorDescription(target.target)}`,
      );
      return {
        event,
        reference,
        row: {
          label: reference,
          value: `${activeWindow} · ${condition}`,
          details: targets,
        },
      };
    });
  return {
    rows: declarations.map(({ row }) => row),
    atMonth(month: number): string[] {
      const possible = declarations.filter(
        ({ event }) =>
          scenarioRulePossibleAt(event, month, rules.durationMonths) &&
          scenarioRuleConditionsCanCoexist(
            graph,
            [event.requiresChoice],
            month,
          ),
      );
      const guaranteed = ({ event }: (typeof declarations)[number]) =>
        scenarioRuleGuaranteedAt(event, month, rules.durationMonths);
      const active = possible
        .filter(guaranteed)
        .map(({ reference }) => reference);
      const uncertain = possible
        .filter((declaration) => !guaranteed(declaration))
        .map(({ reference }) => reference);
      return [
        ...(active.length ? [`Output limits: ${active.join(", ")}`] : []),
        ...(uncertain.length
          ? [`Possible output limits: ${uncertain.join(", ")} (start varies)`]
          : []),
      ];
    },
  };
}

function factorLabel(path: string): string {
  const [field, fuel, facility] = path.split(".");
  switch (field) {
    case "demandMultiplier":
      return "Demand";
    case "hydroRunoffMultiplier":
      return "Hydro inflow";
    case "fuelPriceMultipliers":
      return `${fuel} fuel price`;
    case "buildCostMultipliersByFuel":
      return `${facility ?? fuel} construction cost`;
    case "operatingCostMultipliersByFuel":
      return `${facility ?? fuel} operating cost`;
    case "facilityOutputMultipliersByFuel":
      return `${fuel} output`;
    default:
      return path;
  }
}

/** Identical consecutive months need one row, while every change retains its exact boundary. */
function groupMonthlyFacts(rows: ModFactRow[], year: number): ModFactRow[] {
  const grouped: ModFactRow[] = [];
  let from = 0;
  rows.forEach((row, month) => {
    if (month && row.value === rows[month - 1].value) {
      grouped[grouped.length - 1].label = window(from, month, year);
    } else {
      from = month;
      grouped.push({ ...row });
    }
  });
  return grouped;
}

function facts(
  scenario: ScenarioType,
  author: boolean,
  diagnostics: ModDiagnostic[] = [],
): ModRuleFacts {
  const mod = scenario.mod;
  if (!mod || !validScenarioMod(mod, scenario))
    throw new Error("Only a validated mod snapshot can describe its rules.");
  const rules = mod.rules;
  const location = getScenarioLocation(scenario);
  const mode = mod.source.objectiveMode;
  // A guest uses the host's validated snapshot without loading simulation data or forecasting.
  const peak = rules.startingPeakW > 0 ? rules.startingPeakW : undefined;
  const sections: ModFactSection[] = [
    {
      id: "setup",
      title: "Resolved setup",
      rows: [
        {
          label: "Base",
          value:
            getScenario(mod.parameters.baseScenarioId)?.name ?? "Custom game",
        },
        { label: "Location", value: location?.name ?? "Unavailable" },
        {
          label: "Era and duration",
          value: `${window(0, scenario.durationMonths - 1, scenario.startingYear)} · ${scenario.durationMonths} months`,
        },
        {
          label: "Difficulty",
          value: author
            ? `${difficultyLabel(rules.difficulty)} (${rules.difficulty})`
            : difficultyLabel(rules.difficulty),
        },
        {
          label: "Starting customers",
          value: number(mod.parameters.startingCustomers),
        },
        {
          label: "Starting peak demand",
          value:
            peak === undefined
              ? "Preparing baseline forecast…"
              : `${number(peak / 1e6)} MW`,
        },
        {
          label: "Starting cash and billed rate",
          value: `${money(scenario.cash)} · ${money(scenario.dollarsPerkWh)}/kWh`,
        },
        { label: "Eligibility", value: "Modded · Unranked · No achievements" },
      ],
    },
  ];
  sections.push({
    id: "objectives",
    title: "Scenario objectives",
    rows: [
      {
        label: "Objective intent",
        value:
          mode === "replace"
            ? "Replace the base scenario's goals with the listed goals."
            : "Use the default goals.",
      },
      ...scenarioObjectiveDefinitions(scenario).map((objective) => ({
        label: objective.label,
        value: `${objective.required === false ? "Optional" : "Required"}${objective.inherited ? " · Inherited" : ""} · ${objectiveTargetText(objective)}`,
        details: [
          objectiveDefinition(objective.metric),
          objectiveWindowText(
            objective,
            scenario.startingYear,
            scenario.durationMonths,
          ),
        ],
      })),
      ...(scenarioObjectiveDefinitions(scenario).length === 0
        ? [
            {
              label: "Resolved goals",
              value:
                "No scenario goals. Reach the final month; ordinary game failures still apply.",
            },
          ]
        : []),
    ],
  });
  sections.push({
    id: "fleet",
    title: "Starting fleet",
    rows: scenario.facilities.map((asset) => ({
      label: asset.name ?? asset.fuel ?? "Asset",
      value: `${asset.peakW === undefined ? "" : `${number(asset.peakW / 1e6)} MW`}${asset.peakWh === undefined ? "" : `${asset.peakW === undefined ? "" : " · "}${number(asset.peakWh / 1e6)} MWh`}`,
      details: [
        `Starting-asset ID: ${asset.assetId}`,
        `Age at start: ${number(asset.initialAgeYears ?? 0)} years`,
        ...(asset.initialReservoirFraction === undefined
          ? []
          : [
              `Initial reservoir: ${number(asset.initialReservoirFraction * 100)}%`,
            ]),
      ],
    })),
  });
  sections.push({
    id: "modifiers",
    title: "Static modifiers",
    rows: [
      ...Object.entries(mod.facilities ?? {}).flatMap(([name, values]) =>
        Object.entries(values).map(([field, value]) => ({
          label: `${name} ${{ buildCost: "construction cost", annualOperatingCost: "annual operating cost", yearsToBuild: "construction time" }[field] ?? field}`,
          value: `×${number(value)} · applies to starting facilities and future purchases; timed construction changes leave committed purchases unchanged`,
        })),
      ),
      ...Object.entries(mod.programs ?? {}).map(([name, value]) => ({
        label: `${POLICIES[name as PolicyId].name} program cost`,
        value: `×${number(value!)}`,
      })),
      {
        label: "Initial carbon fee",
        value: `${money(scenario.feePerKgCO2e * 1000)}/tonne CO₂e`,
      },
    ],
  });
  const events = sortedEvents(rules).filter(
    (event) => author || event.visibility === "forecast",
  );
  const choices = ruleChoices(rules);
  const timeline: { month: number; key: string; row: ModFactRow }[] =
    events.map((event) => ({
      month: event.startMonth,
      key: event.key,
      row: {
        label: `${at(event.startMonth, scenario.startingYear)} · ${event.title}`,
        value: author ? event.message : (event.preview ?? event.message),
        details: [
          ...(author
            ? [
                `ID: ${eventReference(event)} · ${event.visibility === "surprise" ? "Hidden from players" : "Announced"}`,
              ]
            : []),
          ...(event.possibleStartMonths.from === event.possibleStartMonths.to
            ? []
            : [
                `Possible onset: ${window(event.possibleStartMonths.from, event.possibleStartMonths.to, scenario.startingYear)}; the seed chooses one opening.`,
              ]),
          ...(event.durationMonths
            ? [
                `Active ${event.durationUntilEnd ? "through the end of the run" : `for ${event.durationMonths} ${event.durationMonths === 1 ? "month" : "months"}, including its opening month`}.`,
              ]
            : []),
          ...(conditionText(rules, event.requiresChoice)
            ? [conditionText(rules, event.requiresChoice)!]
            : []),
          ...eventEffects(event, author),
          ...(author ? [] : rules.loads)
            .filter((load) => load.eventId === event.id)
            .map(
              (load) =>
                `Permanent ${load.demandType} load: ${number(load.peakW / 1e6)} MW from ${at(load.startMonth, scenario.startingYear)}; load factor ${number(load.loadFactor)}.`,
            ),
          ...(!author && event.source
            ? (scenario.loadAdditions ?? [])
                .filter(
                  (load) =>
                    load.id?.startsWith(
                      `custom-${event.source!.scenarioId}-`,
                    ) &&
                    (load.startsYear - scenario.startingYear) * 12 +
                      (load.startsMonth ?? 1) -
                      1 >=
                      event.possibleStartMonths.from &&
                    (load.startsYear - scenario.startingYear) * 12 +
                      (load.startsMonth ?? 1) -
                      1 <=
                      event.possibleStartMonths.to,
                )
                .map(
                  (load) =>
                    `Permanent ${load.demandType} load: ${number(load.peakW / 1e6)} MW from ${load.startsYear}-${String(load.startsMonth ?? 1).padStart(2, "0")}; load factor ${number(load.loadFactor)}.`,
                )
            : []),
          ...(author
            ? []
            : [event.report, event.endReport, ...(event.reports ?? [])]
          ).flatMap((report) =>
            report
              ? [`Report: ${reportText(report, scenario.startingYear, author)}`]
              : [],
          ),
        ],
      },
    }));
  choices.forEach((choice) =>
    timeline.push({
      month: choice.dueMonth,
      key: choice.key,
      row: {
        label: `${at(choice.dueMonth, scenario.startingYear)} · ${choice.title}`,
        value: choice.automatic
          ? `Resolved automatically: ${choice.options.find((option) => option.id === choice.freeOptionId)?.label}`
          : "Each company chooses before this month is simulated.",
        details: [
          ...(author
            ? [
                `Choice ID: ${choice.source ? `arc ${choice.source.scenarioId} / ${choice.source.choiceId}` : choice.id}`,
              ]
            : []),
          ...(conditionText(rules, choice.requiresChoice)
            ? [conditionText(rules, choice.requiresChoice)!]
            : []),
          ...choice.options.map(
            (option) =>
              `${option.label}${author ? ` [${option.id}]` : ""}: ${author ? "" : `${option.description} `}${
                [
                  ...(option.cost ? [`Pay ${money(option.cost)}`] : []),
                  ...(option.grant ? [`Receive ${money(option.grant)}`] : []),
                ].join("; ") || "No payment"
              } per company.${option.replaceLoad ? ` Replaces ${option.replaceLoad.arc === undefined ? "" : `arc ${option.replaceLoad.arc} / `}${option.replaceLoad.loadId} with ${option.replaceLoad.with.map((load) => `${number(load.peakW / 1e6)} MW from month ${load.startMonth + 1}`).join(", ")}.` : ""}`,
          ),
        ],
      },
    }),
  );
  sections.push({
    id: "timeline",
    title: author
      ? "Complete event and decision timeline"
      : "Announced events and decisions",
    rows: timeline
      .sort((a, b) => a.month - b.month || (a.key < b.key ? -1 : 1))
      .map((entry) => entry.row),
  });
  if (author) {
    const graph = createScenarioRuleChoiceGraph(rules);
    const selectors = selectorFacts(rules, graph, events);
    sections.push({
      id: "selectors",
      title: "Affected generators",
      rows: selectors.rows,
    });
    sections.push({
      id: "monthly",
      title: "Combined effects by month",
      description: `Ranges cover all seeds and choices.${selectors.rows.length ? " Output limits follow the conditions in Affected generators." : ""}`,
      rows: groupMonthlyFacts(
        scenarioRuleCompositionRanges(
          rules,
          modStaticCostFactors(mod.facilities),
        ).map(({ month, factors }) => {
          const additive = monthlyAdditiveRanges(rules, month, graph, events);
          const monthlySelectors = selectors.atMonth(month);
          return {
            label: at(month, scenario.startingYear),
            value:
              factors.length || additive.length || monthlySelectors.length
                ? [
                    ...factors.map(
                      (factor) =>
                        `${factorLabel(factor.path)}: ×${range(factor.min, factor.max)}`,
                    ),
                    ...additive,
                    ...monthlySelectors,
                  ].join("\n")
                : "No multiplier changes.",
          };
        }),
        scenario.startingYear,
      ),
    });
    const loads = [
      ...rules.loads,
      ...choices.flatMap((choice) =>
        choice.options.flatMap((option) => option.replaceLoad?.with ?? []),
      ),
    ];
    sections.push({
      id: "loads",
      title: "Resolved permanent loads",
      rows: [
        ...loads.map((load) => ({
          label: load.id ?? load.eventId,
          value: `${number(load.peakW / 1e6)} MW ${load.demandType} · from ${at(load.startMonth, scenario.startingYear)} · load factor ${number(load.loadFactor * 100)}%`,
          details: conditionText(rules, load.requiresChoice)
            ? [conditionText(rules, load.requiresChoice)!]
            : [],
        })),
        ...(scenario.loadAdditions ?? []).map((load) => ({
          label: load.id ?? "Bundled load",
          value: `${number(load.peakW / 1e6)} MW ${load.demandType} · from ${load.startsYear}-${String(load.startsMonth ?? 1).padStart(2, "0")} · load factor ${number(load.loadFactor * 100)}%`,
        })),
      ],
    });
    sections.push({
      id: "dependencies",
      title: "Choice dependency graph",
      rows: graph.nodes.map((node) => ({
        label: node.choice.source
          ? `arc ${node.choice.source.scenarioId} / ${node.choice.source.choiceId}`
          : node.choice.id,
        value: `${conditionText(rules, node.choice.requiresChoice) ?? "Unconditional"} · ${node.reachable ? "reachable" : "unreachable"}`,
        details: node.choice.options.map(
          (option) =>
            `Option ID: ${option.id}${node.choice.automatic && option.id === node.choice.freeOptionId ? " · automatic free response" : ""}`,
        ),
      })),
    });
    sections.push({
      id: "carbon",
      title: "Absolute carbon-fee overrides",
      rows: events
        .filter((event) => event.effects.carbonFeePerKgCO2e !== undefined)
        .map((event) => ({
          label: event.id,
          value: `${window(event.possibleStartMonths.from, Math.min(rules.durationMonths - 1, event.possibleStartMonths.to + event.durationMonths - 1), rules.startingYear)} · ${money(event.effects.carbonFeePerKgCO2e! * 1000)}/tonne CO₂e`,
          details: [
            "Absolute override while active; it does not add to the initial fee.",
            ...(conditionText(rules, event.requiresChoice)
              ? [conditionText(rules, event.requiresChoice)!]
              : []),
          ],
        })),
    });
    sections.push({
      id: "reports",
      title: "Outcome reports",
      rows: [
        ...events.flatMap((event) => [
          event.report,
          event.endReport,
          ...(event.reports ?? []),
        ]),
        ...rules.debriefReports,
      ].flatMap((report) =>
        report
          ? [
              {
                label: report.id,
                value: reportText(report, scenario.startingYear, true),
              },
            ]
          : [],
      ),
    });
    sections.push({
      id: "identity",
      title: "Resolved identities",
      rows: [
        { label: "Package digest", value: mod.packageDigest },
        { label: "Runtime digest", value: mod.runtimeDigest },
        { label: "Seed", value: String(mod.parameters.seed) },
      ],
    });
  }
  return {
    title: scenario.name,
    description: mod.source.description,
    sections: author
      ? sections.filter((section) => section.rows.length)
      : sections,
    diagnostics,
  };
}
export function modPlayerFacts(
  scenario: ScenarioType,
  options: {
    diagnostics?: ModDiagnostic[];
  } = {},
): ModRuleFacts {
  return facts(scenario, false, modPlayerDiagnostics(options.diagnostics));
}

/** Compiler diagnostics can name private events; only the explicit author tool exposes them. */
export function modPlayerDiagnostics(
  diagnostics: readonly ModDiagnostic[] = [],
): ModDiagnostic[] {
  const publicWarnings = new Set([
    "short-opening",
    "expensive-opening",
    "trivial-retirement",
  ]);
  const publicVersions: Record<string, { path: string; message: string }> = {
    "schema-version": {
      path: "schemaVersion",
      message: "schemaVersion must be 1. Export a new authoring template.",
    },
    "game-api": {
      path: "gameApi",
      message:
        "gameApi must be 1. This package targets an unsupported game contract.",
    },
  };
  const safe = diagnostics.map((diagnostic): ModDiagnostic =>
    (diagnostic.severity === "warning" &&
      publicWarnings.has(diagnostic.code)) ||
    (diagnostic.path === publicVersions[diagnostic.code]?.path &&
      diagnostic.message === publicVersions[diagnostic.code]?.message)
      ? diagnostic
      : {
          code: `authoring-${diagnostic.severity}`,
          path: "scenario",
          severity: diagnostic.severity,
          message:
            diagnostic.severity === "error"
              ? "This package needs an authoring correction before play. Open Author report for details."
              : "This package has authoring warnings. Open Author report for details.",
        },
  );
  return [
    ...new Map(
      safe.map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]),
    ).values(),
  ];
}
export function buildModAuthorReport(input: unknown): ModAuthorReport {
  const { scenarios, diagnostics } = modAuthoringScenarios(input);
  const difficulties: Partial<Record<DifficultyType, ModRuleFacts>> = {};
  for (const difficulty of DIFFICULTY_IDS)
    if (
      scenarios[difficulty] &&
      validScenarioMod(scenarios[difficulty]!.mod, scenarios[difficulty]!)
    )
      difficulties[difficulty] = facts(
        scenarios[difficulty]!,
        true,
        diagnostics,
      );
  const selected = difficulties.Employee ?? Object.values(difficulties)[0];
  let pack: ModPackage | undefined;
  try {
    pack = validateMod(input);
  } catch (_error) {
    /* Aggregated diagnostics already belong to the resolver. */
  }
  const base =
    pack?.baseScenarioId === undefined
      ? undefined
      : getScenario(pack.baseScenarioId);
  const inheritedObjectives = base
    ? inheritedModObjectives(
        base,
        pack?.scenario?.startingYear ?? base.startingYear,
      )
    : [];
  const report: ModAuthorReport = {
    title: pack?.title ?? "Author validation report",
    description: pack?.description ?? "",
    sections: [
      ...(selected?.sections ?? []),
      {
        id: "inherited",
        title: "Inherited objectives: replace-ready JSON",
        rows: inheritedObjectives.map((objective) => ({
          label: objective.id,
          value: JSON.stringify(objective),
          details: [objectiveDefinition(objective.metric)],
        })),
      },
      {
        id: "difficulties",
        title: "Difficulty validation",
        rows: DIFFICULTY_IDS.map((difficulty) => ({
          label: difficulty,
          value: difficulties[difficulty]
            ? "Resolved; inspect this difficulty's complete facts."
            : "Unavailable because validation failed.",
        })),
      },
    ].filter((section) => section.rows.length),
    diagnostics,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    difficulties,
    inheritedObjectives,
    ...(pack ? { packageDigest: packageDigest(pack) } : {}),
  };
  return report;
}

/** Rebuilt from validated public facts on every upload; private author sections never enter Steam. */
export function buildModPublication(input: unknown): {
  packageDigest: string;
  description: string;
} {
  const pack = validateMod(input);
  const { scenarios, diagnostics } = modAuthoringScenarios(pack);
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    !scenarios.Employee
  )
    throw new ModValidationError(diagnostics);
  const player = modPlayerFacts(scenarios.Employee);
  const setup = player.sections.find((section) => section.id === "setup")!;
  const goals = player.sections.find((section) => section.id === "objectives")!;
  const timeline = player.sections.find(
    (section) => section.id === "timeline",
  )!;
  const lines = [
    "Rules",
    `Base: ${setup.rows.find((row) => row.label === "Base")!.value}`,
    `Duration: ${scenarios.Employee.durationMonths} months. Event/choice values shown for ${difficultyLabel("Employee")}; choose a difficulty before launch.`,
    "Objectives:",
    ...goals.rows.flatMap((row) => [
      `- ${row.label}: ${row.value}`,
      ...(row.details ?? []).map((detail) => `  ${detail}`),
    ]),
    "Announced events and decisions:",
    ...(timeline.rows.length
      ? timeline.rows.flatMap((row) => [
          `- ${row.label}: ${row.value}`,
          ...(row.details ?? []).map((detail) => `  ${detail}`),
        ])
      : ["- No announced events or decisions."]),
  ];
  return {
    packageDigest: packageDigest(pack),
    description: validatePublicationDescription(
      `${player.description}\n\n${lines.join("\n")}`,
      pack,
    ),
  };
}
