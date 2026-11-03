import { formatNumber, getWattUnit } from "./Format";
import { roundToSignificantDigits } from "./Math";
import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import { MONTHS } from "../Constants";
import { objectiveTarget } from "./ScenarioObjectives";

const number = (value: number, percent = false): string =>
  formatNumber(roundToSignificantDigits(value, 3), {
    notation: "compact",
    maximumSignificantDigits: 3,
    useGrouping: false,
    ...(percent ? { style: "percent" as const } : {}),
  }).replace(/K\b/g, "k");

/** Keep close readings honest without exposing hidden decimal precision. */
export function objectiveValueText(
  objective: CompiledRuleObjective,
  value: number,
  comparison?: number,
): string {
  const text = objectiveAmountText(objective, value);
  return comparison !== undefined &&
    value !== comparison &&
    text === objectiveAmountText(objective, comparison)
    ? `${text} (${value < comparison ? "below" : "above"} goal)`
    : text;
}

function objectiveAmountText(
  objective: CompiledRuleObjective,
  value: number,
): string {
  switch (objective.metric) {
    case "customerRetention":
    case "localFuelShare":
    case "efficiencySavings":
    case "demandServedShare":
      return number(value, true);
    case "financialCoverage":
      return `${number(value)}× operating costs`;
    case "customerCount":
      return `${number(value)} customers`;
    case "reserveMargin": {
      const unit = getWattUnit(roundToSignificantDigits(value, 3));
      return `${number(value / unit.divisor)}${unit.suffix}W reserve`;
    }
    case "emissionsBudget":
      return `${number(value / 1000)} tonnes CO₂e`;
    case "emissionsPerDeliveredMWh":
      return `${number(value)} kg CO₂e/MWh`;
    case "monthlyBilledRate":
      return `$${number(value)}/kWh`;
    case "monthEndDebt":
      return `$${number(value)}`;
    case "utilityOwnership":
      return `${number(value)} acquired ${value === 1 ? "utility" : "utilities"}`;
    case "assetRetirement":
      return `${number(value)} original oil ${value === 1 ? "asset" : "assets"}`;
    case "fuelRetirement":
      return `${number(value)} owned ${objective.fuel} ${value === 1 ? "asset" : "assets"}${objective.commissionedBeforeYear === undefined ? "" : ` commissioned before ${objective.commissionedBeforeYear}`}`;
  }
}

const monthText = (month: number, startingYear: number) =>
  `${MONTHS[month % 12]} ${startingYear + Math.floor(month / 12)}`;

export function objectiveWindowText(
  objective: CompiledRuleObjective,
  startingYear: number,
  durationMonths: number,
): string {
  const first =
    "fromMonth" in objective ? objective.fromMonth : objective.deadlineMonth;
  const last =
    "throughMonth" in objective
      ? objective.throughMonth
      : objective.metric === "fuelRetirement"
        ? durationMonths - 1
        : first;
  if (first === last) return monthText(first, startingYear);
  if (first % 12 === 0 && last === first + 11)
    return `${startingYear + Math.floor(first / 12)}`;
  if (first % 12 === 0 && last % 12 === 11)
    return `${startingYear + Math.floor(first / 12)}–${startingYear + Math.floor(last / 12)}`;
  if (Math.floor(first / 12) === Math.floor(last / 12))
    return `${MONTHS[first % 12]}–${MONTHS[last % 12]} ${startingYear + Math.floor(first / 12)}`;
  return `${monthText(first, startingYear)}–${monthText(last, startingYear)}`;
}

export function objectiveTargetText(objective: CompiledRuleObjective): string {
  const target = objectiveValueText(objective, objectiveTarget(objective));
  switch (objective.metric) {
    case "customerRetention":
      return `Keep ≥${target} of customer baseline`;
    case "utilityOwnership":
      return objective.label;
    case "assetRetirement":
      return objective.label;
    case "localFuelShare":
      return `≥${target} local delivery from ${objective.fuels.join(", ")}`;
    case "fuelRetirement":
      return `${target} at each month close`;
    case "monthlyBilledRate":
      return `Bills ≤${target} each month`;
    case "monthEndDebt":
      return `Month-close debt ≤${target}`;
    case "financialCoverage":
      return objective.basis === "cash"
        ? `Closing cash ≥${target} each month`
        : `Revenue ≥${target} over the window`;
    case "customerCount":
      return `Reach ≥${target}`;
    case "reserveMargin":
      return `Keep ≥${target} each month`;
    case "efficiencySavings":
      return `Save ≥${target} of eligible energy`;
    case "demandServedShare":
      return `Serve ≥${target} of demand each month${objective.hours ? " · 17:00–21:00" : ""}`;
    default:
      return `≤${target}`;
  }
}

/** A single-month goal has no progress to count; "0/1 months" only reads as a failure. */
function completedMonthsText(result: ObjectiveResult): string | undefined {
  return result.requiredMonths === 1
    ? undefined
    : `${result.observedMonths}/${result.requiredMonths} months completed`;
}

/** A goal and its window as one line: a deadline reads as a date, a span as a period. */
export function objectiveGoalText(
  objective: CompiledRuleObjective,
  startingYear: number,
  durationMonths: number,
): string {
  const window = objectiveWindowText(objective, startingYear, durationMonths);
  return objective.metric === "customerRetention" ||
    objective.metric === "customerCount"
    ? `${objectiveTargetText(objective)} by ${window}`
    : `${objectiveTargetText(objective)} · ${window}`;
}

/** The plain-language definition; the authored sentence stays canonical for saves and mods. */
export function objectiveDefinitionText(
  result: Pick<ObjectiveResult, "metric" | "definition">,
): string {
  return result.metric === "customerRetention"
    ? "Customers kept, as a share of your recorded customer baseline."
    : result.metric === "emissionsPerDeliveredMWh"
      ? "Emissions, including imports, exports and construction, per MWh."
      : result.definition;
}

export function objectiveObservedText(result: ObjectiveResult): string {
  if (result.metric === "utilityOwnership")
    return result.observed === 1
      ? "Utility acquired"
      : result.status === "failed"
        ? "No utility acquired by the deadline"
        : "No utility acquired yet";
  const months = completedMonthsText(result);
  if (result.observed === undefined)
    return `${months ?? "Not measured yet"}${result.status === "unverifiable" ? " · history incomplete, not verifiable" : ""}`;
  const value = objectiveValueText(
    result.objective,
    result.observed,
    result.target,
  );
  const live = result.status === "pending" || result.status === "inProgress";
  if (
    (result.metric === "customerRetention" ||
      result.metric === "customerCount") &&
    live
  )
    return `${value} now`;
  const label =
    result.metric === "customerRetention" || result.metric === "customerCount"
      ? "Latest month close "
      : result.metric === "monthlyBilledRate" ||
          result.metric === "monthEndDebt"
        ? "Highest "
        : result.metric === "reserveMargin" ||
            result.metric === "demandServedShare" ||
            (result.objective.metric === "financialCoverage" &&
              result.objective.basis === "cash")
          ? "Lowest "
          : "";
  return `${label}${value}${months ? ` · ${months}` : ""}${result.status === "unverifiable" ? " · not verifiable" : ""}`;
}

/** A finished run has no goal still under way: one that never closed simply was not reached. */
export const finishedObjectiveStatusText: Record<
  ObjectiveResult["status"],
  string
> = {
  pending: "Not reached",
  inProgress: "Not reached",
  completed: "Met",
  failed: "Failed",
  unverifiable: "Unavailable",
};

export const objectiveStatusText: Record<ObjectiveResult["status"], string> = {
  pending: "Not started",
  inProgress: "In progress",
  completed: "Met",
  failed: "Failed",
  unverifiable: "Unavailable",
};
