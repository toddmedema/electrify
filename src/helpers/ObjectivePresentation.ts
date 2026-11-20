import { CurrencyType, USD_CURRENCY } from "./Currency";
import { formatNumber, formatRateCompact, getWattUnit } from "./Format";
import { roundToSignificantDigits } from "./Math";
import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import { MONTHS } from "../Constants";
import { objectiveTarget } from "./ScenarioObjectives";

const number = (
  value: number,
  percent = false,
  significantDigits = 3,
): string =>
  formatNumber(roundToSignificantDigits(value, significantDigits), {
    notation: "compact",
    maximumSignificantDigits: significantDigits,
    useGrouping: false,
    ...(percent ? { style: "percent" as const } : {}),
  }).replace(/K\b/g, "k");

/** Keep close readings honest without exposing hidden decimal precision. */
export function objectiveValueText(
  objective: CompiledRuleObjective,
  value: number,
  comparison?: number,
  significantDigits = 3,
  currency: CurrencyType = USD_CURRENCY,
): string {
  const text = objectiveAmountText(
    objective,
    value,
    significantDigits,
    currency,
  );
  return comparison !== undefined &&
    value !== comparison &&
    text ===
      objectiveAmountText(objective, comparison, significantDigits, currency)
    ? `${text} (${value < comparison ? "below" : "above"} goal)`
    : text;
}

function objectiveAmountText(
  objective: CompiledRuleObjective,
  value: number,
  significantDigits: number,
  currency: CurrencyType,
): string {
  const amount = (n: number, percent = false) =>
    number(n, percent, significantDigits);
  switch (objective.metric) {
    case "customerRetention":
    case "localFuelShare":
    case "efficiencySavings":
    case "demandServedShare":
      return amount(value, true);
    case "financialCoverage":
      return `${amount(value)}× operating costs`;
    case "customerCount":
      return `${amount(value)} customers`;
    case "reserveMargin": {
      const unit = getWattUnit(
        roundToSignificantDigits(value, significantDigits),
      );
      return `${amount(value / unit.divisor)}${unit.suffix}W reserve`;
    }
    case "emissionsBudget":
      return `${amount(value / 1000)} tonnes CO₂e`;
    case "emissionsPerDeliveredMWh":
      return `${amount(value)} kg CO₂e/MWh`;
    case "monthlyBilledRate":
      return currency.code === "USD" && significantDigits === 2
        ? `${amount(value * 100)}¢/kWh`
        : `${formatRateCompact(value, currency)}/kWh`;
    case "monthEndDebt":
      return `${currency.symbol}${amount(value * currency.unitsPerDollar)}`;
    case "utilityOwnership":
      return `${amount(value)} acquired ${value === 1 ? "utility" : "utilities"}`;
    case "assetRetirement":
      return `${amount(value)} original ${value === 1 ? "asset" : "assets"}`;
    case "fuelRetirement":
      return `${amount(value)} owned ${objective.fuel} ${value === 1 ? "asset" : "assets"}${objective.commissionedBeforeYear === undefined ? "" : ` commissioned before ${objective.commissionedBeforeYear}`}`;
  }
}

const monthText = (month: number, startingYear: number) =>
  `${MONTHS[month % 12]} ${startingYear + Math.floor(month / 12)}`;

export function objectiveWindowText(
  objective: CompiledRuleObjective,
  startingYear: number,
  durationMonths: number,
  monthOffset = 0,
): string {
  const first =
    ("fromMonth" in objective ? objective.fromMonth : objective.deadlineMonth) +
    monthOffset;
  const last =
    monthOffset +
    ("throughMonth" in objective
      ? objective.throughMonth
      : objective.metric === "fuelRetirement" && !objective.checkpoint
        ? durationMonths - 1
        : first - monthOffset);
  if (first === last) return monthText(first, startingYear);
  if (first % 12 === 0 && last === first + 11)
    return `${startingYear + Math.floor(first / 12)}`;
  if (first % 12 === 0 && last % 12 === 11)
    return `${startingYear + Math.floor(first / 12)}–${startingYear + Math.floor(last / 12)}`;
  if (Math.floor(first / 12) === Math.floor(last / 12))
    return `${MONTHS[first % 12]}–${MONTHS[last % 12]} ${startingYear + Math.floor(first / 12)}`;
  return `${monthText(first, startingYear)}–${monthText(last, startingYear)}`;
}

export function objectiveTargetText(
  objective: CompiledRuleObjective,
  currency: CurrencyType = USD_CURRENCY,
): string {
  const target = objectiveValueText(
    objective,
    objectiveTarget(objective),
    undefined,
    3,
    currency,
  );
  if (objective.checkpoint) {
    switch (objective.metric) {
      case "customerRetention":
        return `Retain ${target} of customers`;
      case "customerCount":
        return `Reach ≥${target}`;
      case "monthEndDebt":
        return `Debt ≤${target}`;
      case "monthlyBilledRate":
        return `Billed rate ≤${target}`;
      case "financialCoverage":
        return objective.minCoverage === 1
          ? `${objective.basis === "revenue" ? "Revenue covers operating costs" : "Cash covers monthly operating costs"}`
          : `${objective.basis === "cash" ? "Cash" : "Revenue"} ≥${target}`;
      case "reserveMargin":
        return `Have ≥${target}`;
      case "efficiencySavings":
        return `Save ≥${target} of home and business electricity`;
      case "demandServedShare":
        return `Serve ≥${target} of ${objective.hours ? "evening " : ""}demand`;
      case "emissionsBudget":
      case "emissionsPerDeliveredMWh":
        return `Emit ≤${target}`;
      case "fuelRetirement":
      case "assetRetirement":
      case "utilityOwnership":
        return objective.label;
      case "localFuelShare":
        return `≥${target} local delivery from ${objective.fuels.join(", ")}`;
    }
  }
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
  monthOffset = 0,
  currency: CurrencyType = USD_CURRENCY,
): string {
  if (objective.checkpoint) {
    const last =
      "deadlineMonth" in objective
        ? objective.deadlineMonth
        : objective.throughMonth;
    return (
      objectiveTargetText(objective, currency) +
      (last === durationMonths - 1
        ? ""
        : ` by ${(last + monthOffset) % 12 === 11 ? startingYear + Math.floor((last + monthOffset) / 12) : monthText(last + monthOffset, startingYear)}`)
    );
  }
  const window = objectiveWindowText(
    objective,
    startingYear,
    durationMonths,
    monthOffset,
  );
  return objective.metric === "customerRetention" ||
    objective.metric === "customerCount"
    ? `${objectiveTargetText(objective, currency)} by ${window}`
    : `${objectiveTargetText(objective, currency)} · ${window}`;
}

/** A short heading names the goal; its target carries quantities, conditions and dates. */
export function objectiveHeadingText(objective: CompiledRuleObjective): string {
  if (objective.metric === "utilityOwnership") return objective.label;
  if (
    objective.label !== objectiveTargetText(objective) &&
    !/\d/.test(objective.label)
  )
    return objective.label;
  switch (objective.metric) {
    case "customerRetention":
      return "Retain customers";
    case "assetRetirement":
      return "Retire original plants";
    case "emissionsBudget":
      return "Limit total emissions";
    case "emissionsPerDeliveredMWh":
      return "Limit emissions intensity";
    case "localFuelShare":
      return "Generate locally";
    case "fuelRetirement":
      return `Retire ${objective.fuel} plants`;
    case "monthlyBilledRate":
      return "Keep bills affordable";
    case "monthEndDebt":
      return "Limit debt";
    case "financialCoverage":
      return "Financial stability";
    case "customerCount":
      return "Grow the customer base";
    case "reserveMargin":
      return "Maintain a reserve";
    case "efficiencySavings":
      return "Improve efficiency";
    case "demandServedShare":
      return "Keep service reliable";
  }
}

export function objectiveGoalGroups(
  objectives: CompiledRuleObjective[],
  startingYear: number,
  durationMonths: number,
  monthOffset = 0,
  currency: CurrencyType = USD_CURRENCY,
): { id: string; label: string; required: boolean; goals: string[] }[] {
  return objectives.map((objective) => ({
    id: objective.id,
    label: objectiveHeadingText(objective),
    required: objective.required,
    goals: [
      objectiveGoalText(
        objective,
        startingYear,
        durationMonths,
        monthOffset,
        currency,
      ),
    ],
  }));
}

/** The plain-language definition; the authored sentence stays canonical for saves and mods. */
export function objectiveDefinitionText(
  result: Pick<ObjectiveResult, "metric" | "definition"> &
    Partial<Pick<ObjectiveResult, "objective">>,
): string {
  if (result.objective?.checkpoint) {
    switch (result.metric) {
      case "emissionsBudget":
        return "Total emissions during your term.";
      case "monthEndDebt":
        return "Outstanding loan principal, excluding interest.";
      case "monthlyBilledRate":
        return "Customer revenue per kWh, excluding grants and exports.";
      case "emissionsPerDeliveredMWh":
        return "Emissions, including imports, exports and construction, per MWh.";
      case "customerRetention":
        return "Customers kept at the deadline, as a share of your opening customers.";
      case "fuelRetirement":
        return result.definition;
      default:
        return result.definition;
    }
  }
  return result.metric === "customerRetention"
    ? "Customers kept, as a share of your recorded customer baseline."
    : result.metric === "emissionsPerDeliveredMWh"
      ? "Emissions, including imports, exports and construction, per MWh."
      : result.definition;
}

export function objectiveObservedText(
  result: ObjectiveResult,
  currency: CurrencyType = USD_CURRENCY,
): string {
  if (result.metric === "utilityOwnership") {
    const count = result.observed ?? 0;
    return `${count} of ${result.target} acquired`;
  }
  const months = result.objective.checkpoint
    ? undefined
    : completedMonthsText(result);
  if (result.observed === undefined)
    return `${months ?? "Not measured yet"}${result.status === "unverifiable" ? " · history incomplete, not verifiable" : ""}`;
  const value = objectiveValueText(
    result.objective,
    result.observed,
    result.target,
    3,
    currency,
  );
  const live = result.status === "pending" || result.status === "inProgress";
  if (result.objective.checkpoint) return `${value}${live ? " now" : ""}`;
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
