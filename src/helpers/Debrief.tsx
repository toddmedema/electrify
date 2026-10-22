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
import { formatWatts, formatWattHours, formatMoneyConcise } from "./Format";
import { customerSalesRevenue } from "./Scoring";
import { scenarioRules } from "./ScenarioRules";
import { interpretScenarioRuleReport } from "./ScenarioRuleRuntime";
import type { RuleReportMetric } from "./ScenarioRuleReports";

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
    highlights: debriefHighlights(events),
  };
}

function rate(value: number): string {
  return `$${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}/kWh`;
}

function effectiveRate(
  month: MonthlyHistoryType | undefined,
): number | undefined {
  return month && month.supplyWh > 0
    ? customerSalesRevenue(month) / (month.supplyWh / 1000)
    : undefined;
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
        const result = interpretScenarioRuleReport(report, rules, {
          startingYear: rules.startingYear,
          completedMonths: months.length,
          monthlyHistory: months,
          occurrences,
          startingRateDollarsPerKWh: scenario.dollarsPerkWh,
          endingRateDollarsPerKWh: endingRate,
        });
        return result.metrics.length
          ? result.metrics.map((metric) => ({
              label: metric.label,
              value: reportMetricValue(metric),
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
  if (scenario.id === 106) {
    const afterArrival = months.filter(
      (month) => month.year > 2026 || (month.year === 2026 && month.month >= 1),
    );
    return [
      {
        label: "Months with blackouts after Data Centers arrived",
        value:
          afterArrival.length === 0
            ? "Not reached"
            : String(
                afterArrival.filter(
                  (month) => month.demandWh - month.supplyWh > 1,
                ).length,
              ),
        concept: "blackout",
      },
      {
        label: "Electricity rate",
        value: `${rate(scenario.dollarsPerkWh)} → ${rate(endingRate)}`,
        concept: "rate",
      },
    ];
  }
  if (scenario.id === 107) {
    const findMonth = (year: number, monthNumber: number) =>
      months.find(
        (month) => month.year === year && month.month === monthNumber,
      );
    const january = findMonth(2021, 1);
    const february = findMonth(2021, 2);
    const march = findMonth(2021, 3);
    const beforeRate = effectiveRate(january);
    const afterRate = effectiveRate(march);
    const maximumDeficit = Math.max(0, -(february?.minimumSupplyMarginW || 0));
    return [
      {
        label: "Demand not met during Winter Storm Uri · Feb 2021",
        value: february
          ? formatWattHours(Math.max(0, february.demandWh - february.supplyWh))
          : "Not reached",
        concept: "blackout",
      },
      {
        label: "Largest shortage during Winter Storm Uri",
        value: february ? formatWatts(maximumDeficit) : "Not reached",
        concept: "supply",
      },
      {
        label: "Electricity rate · before → after",
        value:
          beforeRate === undefined || afterRate === undefined
            ? "Not reached"
            : `${rate(beforeRate)} → ${rate(afterRate)}`,
        concept: "rate",
      },
      {
        label: "Cash stayed above $0 through Mar 2021",
        value:
          january && february && march
            ? january.cash > 0 && february.cash > 0 && march.cash > 0
              ? "Yes"
              : "No"
            : "Not reached",
        concept: "money",
      },
    ];
  }
  return undefined;
}

function reportMetricValue(metric: RuleReportMetric): string {
  if (!metric.available || metric.value === undefined) return "Unavailable";
  if (typeof metric.value === "boolean") return metric.value ? "Yes" : "No";
  if (typeof metric.value === "string") return metric.value;
  switch (metric.unit) {
    case "share":
      return `${(metric.value * 100).toFixed(1)}%`;
    case "Wh":
      return formatWattHours(metric.value);
    case "W":
      return formatWatts(metric.value);
    case "dollars":
      return formatMoneyConcise(metric.value);
    case "hours":
      return `${metric.value.toFixed(1)} hours`;
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
