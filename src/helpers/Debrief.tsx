import {
  FacilityShoppingType,
  FuelNameType,
  GameEventType,
  MonthlyHistoryType,
  ScenarioType,
  VictoryDebriefType,
  VictoryFleetCapacityType,
  ActiveWorldEventType,
  ConceptNameType,
} from "../Types";
import {
  formatWatts,
  formatWattHours,
  formatMoneyConcise,
  formatFixed,
} from "./Format";
import { scenarioRules } from "./ScenarioRules";
import { interpretScenarioRuleReport } from "./ScenarioRuleRuntime";
import type { RuleReportMetric } from "./ScenarioRuleReports";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import cloneDeep from "lodash.clonedeep";

type FleetAssetType = Partial<FacilityShoppingType> & {
  yearsToBuildLeft?: number;
};

export function fleetCapacity(
  facilities: FleetAssetType[],
  operationalOnly = false,
): VictoryFleetCapacityType[] {
  const totals: Partial<Record<FuelNameType, number>> = {};
  facilities.forEach((facility) => {
    const fuel = facility.fuel as FuelNameType | undefined;
    if (
      !fuel ||
      !facility.peakW ||
      (operationalOnly && (facility.yearsToBuildLeft || 0) > 0)
    ) {
      return;
    }
    totals[fuel] = (totals[fuel] || 0) + facility.peakW;
  });
  return (Object.entries(totals) as [FuelNameType, number][])
    .map(([fuel, watts]) => ({ fuel, watts }))
    .sort((a, b) => b.watts - a.watts);
}

function debriefHighlights(events: GameEventType[]) {
  const seen = new Set<string>();
  const candidates = events
    .filter(
      (event) =>
        event.importance ||
        event.kind === "BLACKOUT" ||
        event.kind === "BLACKOUT_OVER" ||
        event.kind === "CONSTRUCTION",
    )
    .filter((event) => {
      if (seen.has(event.message)) {
        return false;
      }
      seen.add(event.message);
      return true;
    })
    .sort((a, b) => {
      const priority =
        (b.turningPointPriority || 0) - (a.turningPointPriority || 0);
      if (priority !== 0) {
        return priority;
      }
      const importance = { ROUTINE: 0, NOTABLE: 1, CRITICAL: 2 };
      const importanceDelta =
        importance[b.importance || "ROUTINE"] -
        importance[a.importance || "ROUTINE"];
      return importanceDelta !== 0 ? importanceDelta : b.id - a.id;
    })
    .slice(0, 3)
    // The chosen events are intentionally ranked, but the debrief reads as a timeline.
    .sort((a, b) => a.id - b.id);
  return candidates.map(({ kind, label, message, importance }) => ({
    kind,
    label,
    message,
    importance,
  }));
}

export function buildVictoryDebrief(
  scenario: ScenarioType,
  summary: MonthlyHistoryType,
  facilities: FleetAssetType[],
  events: GameEventType[],
  months: MonthlyHistoryType[] = [],
  endingRate = scenario.dollarsPerkWh,
  occurrences: ActiveWorldEventType[] = [],
  objectiveResults: ObjectiveResult[] = [],
): VictoryDebriefType {
  const unservedWh = Math.max(0, summary.demandWh - summary.supplyWh);
  const reliability =
    summary.demandWh > 0
      ? Math.max(0, Math.min(1, summary.supplyWh / summary.demandWh))
      : 1;
  return {
    demandWh: summary.demandWh,
    startingFleet: fleetCapacity(scenario.facilities),
    finalFleet: fleetCapacity(facilities, true),
    startingCash: scenario.cash,
    finalCash: summary.cash,
    finalCustomers: summary.customers,
    reliability,
    unservedWh,
    kgco2e: summary.kgco2e,
    scenarioMetrics: scenarioMetrics(scenario, months, endingRate, occurrences),
    ...(objectiveResults.length
      ? { objectiveResults: cloneDeep(objectiveResults) }
      : {}),
    highlights: debriefHighlights(events),
  };
}

function scenarioMetrics(
  scenario: ScenarioType,
  months: MonthlyHistoryType[],
  endingRate: number,
  occurrences: ActiveWorldEventType[],
): VictoryDebriefType["scenarioMetrics"] {
  const rules = scenarioRules(scenario);
  if (rules)
    return [
      ...rules.debriefReports.flatMap((report) => {
        const catalogDebrief =
          rules.namespace.kind === "official" &&
          (report.kind === "dataCenter" || report.kind === "deepFreeze");
        const result = interpretScenarioRuleReport(report, rules, {
          startingYear: rules.startingYear,
          completedMonths: Math.max(
            0,
            ...months.map(
              (month) => (month.year - rules.startingYear) * 12 + month.month,
            ),
          ),
          monthlyHistory: months,
          occurrences,
          startingRateDollarsPerKWh: scenario.dollarsPerkWh,
          endingRateDollarsPerKWh: endingRate,
          ...(catalogDebrief ? { catalogDebrief: true } : {}),
        });
        return result.metrics.length
          ? result.metrics.map((metric) => ({
              label: metric.label,
              value:
                catalogDebrief && !metric.available
                  ? "Not reached"
                  : reportMetricValue(metric),
              concept: reportMetricConcept(metric),
            }))
          : [
              {
                label: result.label,
                value: result.message,
                concept: "goal" as const,
              },
            ];
      }),
      ...occurrences
        .filter(
          (event) =>
            event.attributes.ruleChoice === true &&
            event.attributes.automatic === true,
        )
        .map((event) => ({
          label: event.title ?? "Automatic response",
          value: event.message ?? "Resolved automatically",
          concept: "goal" as const,
        })),
    ];
  return undefined;
}

function reportMetricValue(metric: RuleReportMetric): string {
  if (!metric.available || metric.value === undefined) return "Unavailable";
  if (typeof metric.value === "boolean") return metric.value ? "Yes" : "No";
  if (typeof metric.value === "string") return metric.value;
  switch (metric.unit) {
    case "share":
      return `${formatFixed(metric.value * 100, 1)}%`;
    case "Wh":
      return formatWattHours(metric.value);
    case "W":
      return formatWatts(metric.value);
    case "dollars":
      return formatMoneyConcise(metric.value);
    case "hours":
      return `${formatFixed(metric.value, 1)} hours`;
    default:
      return String(metric.value);
  }
}

function reportMetricConcept(metric: RuleReportMetric): ConceptNameType {
  if (metric.id === "electricityRate") return "rate";
  if (metric.unit === "dollars" || metric.id === "cashStayedPositive")
    return "money";
  if (metric.unit === "Wh" || metric.id === "blackoutMonths") return "blackout";
  if (metric.unit === "W") return "supply";
  if (metric.id === "affectedFacilities") return "generator";
  return "goal";
}
