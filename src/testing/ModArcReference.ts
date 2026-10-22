import type { CompiledRuleChoice } from "../data/ScenarioRules";
import { SCENARIOS } from "../data/Scenarios";
import { MOD_SCENARIO_IDS, validateMod } from "../mods/ModSchema";
import { modResolvedSetup, modScenario } from "../mods/ModScenario";
import { getScenarioLocation } from "../helpers/Locations";
import { ruleChoices } from "../helpers/ScenarioRuleDependencies";
import { SCENARIO_PREPARATION_MONTHS } from "../data/ScenarioPreparation";
import { loadSimData } from "./SimData";

export interface ArcReference {
  id: number;
  name: string;
  preparationMonths: number;
  phases: {
    id: string;
    offset: { from: number; to: number };
    durationMonths: number;
    untilEnd: boolean;
  }[];
  choices: {
    id: string;
    dueMonth: number;
    options: string[];
    automaticResponse: string;
  }[];
  loads: { id: string; month: number; branch?: string }[];
}

const referenceId = (choice: CompiledRuleChoice) =>
  choice.source?.choiceId ?? choice.id;

/** Read actual detached imports; the document never keeps a parallel arc schedule. */
export function modArcReferences(): ArcReference[] {
  return MOD_SCENARIO_IDS.map((scenarioId) => {
    const source = SCENARIOS.find((scenario) => scenario.id === scenarioId);
    if (!source) throw new Error(`Missing importable scenario ${scenarioId}.`);
    const pack = validateMod({
      schemaVersion: 1,
      gameApi: 1,
      id: `reference-${scenarioId}`,
      title: `Reference ${scenarioId}`,
      creator: "Electrify authoring tools",
      version: "1",
      description: "Resolve the current bundled arc for the author reference.",
      seed: 12345,
      baseScenarioId: scenarioId,
      scenario: { durationMonths: 1200 },
      objectives: { mode: "none" },
      officialArcs: [{ scenarioId, includeChoices: true }],
    });
    const setup = modResolvedSetup(pack);
    const location = getScenarioLocation(setup);
    if (!location) throw new Error(`Scenario ${scenarioId} has no location.`);
    loadSimData(location);
    const scenario = modScenario(pack, undefined, "Employee");
    const rules = scenario.mod!.rules;
    const withoutChoices = modScenario(
      {
        ...pack,
        officialArcs: [{ scenarioId, includeChoices: false }],
      },
      undefined,
      "Employee",
    ).mod!.rules;
    const sourceLoads = new Map(
      (source.loadAdditions ?? []).map((load) => [load.id, load]),
    );
    const choices = ruleChoices(rules);
    const automatic = ruleChoices(withoutChoices);
    const loadRows = [
      ...(scenario.loadAdditions ?? []).map((load) => {
        const prefix = `custom-${scenarioId}-`;
        const id = load.id?.startsWith(prefix)
          ? load.id.slice(prefix.length)
          : (load.id ?? "initial-load");
        if (!sourceLoads.has(id))
          throw new Error(`Imported load ${id} has no catalog identity.`);
        return {
          id,
          month:
            (load.startsYear - scenario.startingYear) * 12 +
            (load.startsMonth ?? 1),
        };
      }),
      ...choices.flatMap((choice) =>
        choice.options.flatMap((option) =>
          (option.replaceLoad?.with ?? []).map((load) => ({
            id: load.id ?? load.eventId,
            month: load.startMonth + 1,
            branch: `${referenceId(choice)}/${option.id}`,
          })),
        ),
      ),
    ];
    return {
      id: scenarioId,
      name: source.name,
      preparationMonths: SCENARIO_PREPARATION_MONTHS[scenarioId] ?? 0,
      phases: [...rules.events, ...(rules.arcEvents ?? [])]
        .filter((event) => event.source?.scenarioId === scenarioId)
        .map((event) => ({
          id: event.source!.phaseId,
          offset: { ...event.possibleStartMonths },
          durationMonths: event.durationMonths,
          untilEnd: !!event.durationUntilEnd,
        }))
        .sort(
          (a, b) => a.offset.from - b.offset.from || a.id.localeCompare(b.id),
        ),
      choices: choices.map((choice) => {
        const free = automatic.find((entry) => entry.key === choice.key);
        if (!free?.automatic)
          throw new Error(
            `Arc ${scenarioId} has no automatic free resolution.`,
          );
        return {
          id: referenceId(choice),
          dueMonth: choice.dueMonth + 1,
          options: choice.options.map((option) => option.id),
          automaticResponse: free.freeOptionId,
        };
      }),
      loads: loadRows.sort(
        (a, b) => a.month - b.month || a.id.localeCompare(b.id),
      ),
    };
  });
}

export function formatModArcReference(arcs: ArcReference[]): string {
  const range = (from: number, to: number) =>
    from === to ? String(from) : `${from}–${to}`;
  const escape = (text: string) => text.replaceAll("|", "\\|");
  return [
    "# Imported official arc reference",
    "",
    "Generated from the actual package resolver and detached imported rules. Regenerate with `npm run mods:arcs`; use `-- --check` to detect drift.",
    "",
    "Offsets are zero-based from the receiving January opening, including each arc's preparation lead. Playable months are offsets +1. Seeded ranges list every possible opening, not just the reference seed. Source loads already include their preparation lead. Effect magnitudes and duration values below resolve on Easy (Employee); use the author report for every difficulty's complete facts and your receiving grid's load MW and money.",
    "",
    "Choice references use `{arc: scenarioId, choiceId, optionIds}`. Load references use `{arc: scenarioId, loadId}`; load IDs below are the stable catalog IDs, before internal runtime prefixes. `includeChoices: false` commits the listed zero-cost response automatically, including a grant when that response carries one. It does not remove the associated rules.",
    "",
    ...arcs.flatMap((arc) => [
      `## ${arc.id} · ${escape(arc.name)}`,
      "",
      `Preparation lead: ${arc.preparationMonths} months.`,
      "",
      ...(arc.phases.length
        ? [
            "| Phase ID | Relocated offset | Playable month | Active duration (Easy) |",
            "| --- | --- | --- | --- |",
            ...arc.phases.map(
              (phase) =>
                `| \`${phase.id}\` | ${range(phase.offset.from, phase.offset.to)} | ${range(phase.offset.from + 1, phase.offset.to + 1)} | ${phase.untilEnd ? "Through run end" : phase.durationMonths ? `${phase.durationMonths} month${phase.durationMonths === 1 ? "" : "s"}` : "Message opening only"} |`,
            ),
          ]
        : [
            "This arc has no timed phases; its load and decision are listed below.",
          ]),
      "",
      ...(arc.choices.length
        ? [
            "| Choice ID | Due month | Option IDs | Automatic response without choices |",
            "| --- | --- | --- | --- |",
            ...arc.choices.map(
              (choice) =>
                `| \`${choice.id}\` | ${choice.dueMonth} | ${choice.options.map((id) => `\`${id}\``).join(", ")} | \`${choice.automaticResponse}\` |`,
            ),
          ]
        : ["This arc has no consequential choices."]),
      "",
      ...(arc.loads.length
        ? [
            "| Load ID | Starts in playable month | Branch |",
            "| --- | --- | --- |",
            ...arc.loads.map(
              (load) =>
                `| \`${load.id}\` | ${load.month} | ${load.branch ? `\`${load.branch}\`` : "Base schedule; a named choice may replace it"} |`,
            ),
          ]
        : ["This arc introduces no permanent industrial load."]),
      "",
    ]),
  ].join("\n");
}
