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
      return `Retain ≥${target} of starting customers`;
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

export function objectiveObservedText(result: ObjectiveResult): string {
  if (result.observed === undefined)
    return `${result.observedMonths}/${result.requiredMonths} months completed${result.status === "unverifiable" ? " · history incomplete, not verifiable" : ""}`;
  const value = objectiveValueText(
    result.objective,
    result.observed,
    result.target,
  );
  const label =
    result.metric === "customerRetention"
      ? "Latest month close "
      : result.metric === "monthlyBilledRate" ||
          result.metric === "monthEndDebt"
        ? "Highest "
        : "";
  return `${label}${value} · ${result.observedMonths}/${result.requiredMonths} months completed${result.status === "unverifiable" ? " · not verifiable" : ""}`;
}

export const objectiveStatusText: Record<ObjectiveResult["status"], string> = {
  pending: "Not started",
  inProgress: "In progress",
  completed: "Met",
  failed: "Failed",
  unverifiable: "Unavailable",
};
