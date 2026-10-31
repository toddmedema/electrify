import { formatNumber } from "./Format";
import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import { MONTHS } from "../Constants";
import { objectiveTarget } from "./ScenarioObjectives";

const number = (
  value: number,
  comparison?: number,
  percent = false,
): string => {
  const rounded = Number(value.toPrecision(6));
  const compared =
    comparison === undefined ? undefined : Number(comparison.toPrecision(6));
  // Keep a measured value on its actual side of a nearby target.
  const precise = comparison === undefined || rounded === compared;
  // A reading beside a whole-percent target needs no decimals, unless they decide the verdict.
  if (percent && comparison !== undefined && !precise) {
    const whole = Math.round(value * 100);
    const target = Number((comparison * 100).toPrecision(6));
    const roundedMeets = whole >= target;
    const actualMeets = value * 100 >= target;
    const sameSide = roundedMeets === actualMeets;
    if (Number.isInteger(target) && sameSide && whole !== target)
      return formatNumber(whole / 100, { style: "percent" });
  }
  return formatNumber(precise ? value : rounded, {
    maximumSignificantDigits: precise ? 21 : 6,
    ...(percent ? { style: "percent" } : {}),
  });
};

export function objectiveValueText(
  objective: CompiledRuleObjective,
  value: number,
  comparison?: number,
): string {
  switch (objective.metric) {
    case "customerRetention":
    case "localFuelShare":
      return number(value, comparison, true);
    case "emissionsBudget":
      return `${number(value / 1000, comparison === undefined ? undefined : comparison / 1000)} tonnes CO₂e`;
    case "emissionsPerDeliveredMWh":
      return `${number(value, comparison)} kg CO₂e / delivered MWh`;
    case "monthlyBilledRate":
      return `$${number(value, comparison)}/kWh`;
    case "monthEndDebt":
      return `$${number(value, comparison)} principal`;
    case "utilityOwnership":
      return `${number(value)} acquired ${value === 1 ? "utility" : "utilities"}`;
    case "assetRetirement":
      return `${number(value)} original oil ${value === 1 ? "asset" : "assets"}`;
    case "fuelRetirement":
      return `${number(value)} owned ${objective.fuel} ${value === 1 ? "asset" : "assets"}`;
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
  return objective.metric === "customerRetention"
    ? `${objectiveTargetText(objective)} by ${window}`
    : `${objectiveTargetText(objective)} · ${window}`;
}

/** The plain-language definition; the authored sentence stays canonical for saves and mods. */
export function objectiveDefinitionText(
  result: Pick<ObjectiveResult, "metric" | "definition">,
): string {
  return result.metric === "customerRetention"
    ? "Customers kept, as a share of your recorded customer baseline."
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
  if (result.metric === "customerRetention" && live) return `${value} now`;
  const label =
    result.metric === "customerRetention"
      ? "Latest month close "
      : result.metric === "monthlyBilledRate" ||
          result.metric === "monthEndDebt"
        ? "Highest "
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
