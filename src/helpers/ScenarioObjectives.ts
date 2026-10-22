import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type {
  ObjectiveContext,
  ObjectiveMonthFacts,
  ObjectiveObservation,
  ObjectiveProgress,
  ObjectiveResult,
} from "../data/ScenarioObjectives";
import { getInflationIndex, getRateInflationIndex } from "../data/Economy";
import { bestReachableCustomers } from "./Customers";
import { customerSalesRevenue } from "./Scoring";
import { ruleDigest } from "./RuleIdentity";
import {
  isRuleJson,
  OBJECTIVE_METRICS,
  ruleDiagnostics,
  UNSAFE_MARKUP,
  UNSAFE_TEXT,
} from "./ScenarioRulesSchema";

const DEFINITIONS: Record<CompiledRuleObjective["metric"], string> = {
  monthlyReliability:
    "Delivered customer electricity divided by customer demand each completed month.",
  customerRetention:
    "Customers at the deadline divided by the run's recorded starting customers.",
  emissionsBudget:
    "Total electricity and construction emissions over the window, including imports and exports.",
  emissionsPerDeliveredMWh:
    "Total emissions, including imports, exports and construction, per delivered customer MWh over the window.",
  localFuelShare:
    "Selected fuels' delivered electricity divided by all local fuel-delivered electricity over the window; imports and storage discharge have no fuel provenance.",
  fuelRetirement:
    "Own no asset of the specified fuel, including paused and unfinished assets, at the deadline and every later month close.",
  monthlyBilledRate:
    "Billed customer revenue per delivered kWh each month, excluding grants and exports, in starting-year dollars.",
  monthEndDebt:
    "Loan principal at each completed month close, in starting-year dollars; interest expenses are excluded.",
};

export const objectiveDefinition = (
  metric: CompiledRuleObjective["metric"],
): string => DEFINITIONS[metric];

const byId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !UNSAFE_MARKUP.test(value) &&
  !UNSAFE_TEXT.test(value);
const keysAre = (value: object, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Retention records the preceding customer observations too, solely for reachability. */
function observationWindow(
  objective: CompiledRuleObjective,
  term: number,
): [number, number] {
  if (objective.metric === "customerRetention")
    return [0, objective.deadlineMonth];
  if (objective.metric === "fuelRetirement")
    return [objective.deadlineMonth, term - 1];
  return [objective.fromMonth, objective.throughMonth];
}

function requiredWindow(
  objective: CompiledRuleObjective,
  term: number,
): [number, number] {
  return objective.metric === "customerRetention"
    ? [objective.deadlineMonth, objective.deadlineMonth]
    : observationWindow(objective, term);
}

export function objectiveTarget(objective: CompiledRuleObjective): number {
  switch (objective.metric) {
    case "monthlyReliability":
      return objective.minDemandServedShare;
    case "customerRetention":
      return objective.minRetainedShare;
    case "emissionsBudget":
      return objective.budgetKgCO2e;
    case "emissionsPerDeliveredMWh":
      return objective.maxKgCO2ePerMWh;
    case "localFuelShare":
      return objective.minShare;
    case "fuelRetirement":
      return 0;
    case "monthlyBilledRate":
      return objective.maxDollarsPerKWh;
    case "monthEndDebt":
      return objective.maxDebt;
  }
}

/** The single threshold comparison also validates claimed completion in saved debrief results. */
export function objectiveTargetMet(
  objective: CompiledRuleObjective,
  observed: number,
): boolean {
  if (!nonnegative(observed)) return false;
  const target = objectiveTarget(objective);
  return ["monthlyReliability", "customerRetention", "localFuelShare"].includes(
    objective.metric,
  )
    ? observed >= target
    : observed <= target;
}

function initialEvidenceDigest(
  objective: CompiledRuleObjective,
  context: ObjectiveContext,
  baseline: number,
): string {
  return ruleDigest({
    objective,
    rulesDigest: context.rulesDigest,
    startingYear: context.startingYear,
    seed: context.seed,
    durationMonths: context.durationMonths,
    ownership: context.ownership,
    retentionBaseline: baseline,
  });
}

const nextEvidenceDigest = (
  previous: string,
  observation: ObjectiveObservation,
) => ruleDigest({ previous, observation });

function progressChecksum(
  progress: Omit<ObjectiveProgress, "checksum">,
): string {
  return ruleDigest({
    version: progress.version,
    rulesDigest: progress.rulesDigest,
    retentionBaseline: progress.retentionBaseline,
    completedMonths: progress.completedMonths,
    entries: progress.entries.map(({ id, digest, duplicateMonths }) => ({
      id,
      digest,
      duplicateMonths,
    })),
  });
}

/** Hashes only new compact facts at month close; validation recomputes their complete chains. */
export function createObjectiveProgress(
  objectives: readonly CompiledRuleObjective[],
  context: ObjectiveContext,
  retentionBaseline: number,
): ObjectiveProgress {
  const plain: Omit<ObjectiveProgress, "checksum"> = {
    version: 1,
    rulesDigest: context.rulesDigest,
    retentionBaseline,
    completedMonths: 0,
    entries: [...objectives].sort(byId).map((objective) => ({
      id: objective.id,
      observations: [],
      duplicateMonths: [],
      digest: initialEvidenceDigest(objective, context, retentionBaseline),
    })),
  };
  return { ...plain, checksum: progressChecksum(plain) };
}

export function objectiveMonthObservation(
  objective: CompiledRuleObjective,
  facts: ObjectiveMonthFacts,
  context: ObjectiveContext,
  baseline: number,
): ObjectiveObservation {
  const row = facts.history;
  if (row.year * 12 + row.month - 1 !== context.startingYear * 12 + facts.month)
    return [facts.month, null, null];
  let numerator: number | undefined;
  let denominator: number | undefined = 1;
  switch (objective.metric) {
    case "monthlyReliability":
      numerator = row.supplyWh;
      denominator = row.demandWh;
      break;
    case "customerRetention":
      numerator = row.customers;
      denominator = baseline;
      break;
    case "emissionsBudget":
      numerator = row.kgco2e;
      break;
    case "emissionsPerDeliveredMWh":
      numerator = row.kgco2e;
      denominator = row.supplyWh / 1e6;
      break;
    case "localFuelShare": {
      const delivered = row.deliveredWhByFuel;
      numerator =
        delivered &&
        objective.fuels.reduce((sum, fuel) => sum + (delivered[fuel] ?? 0), 0);
      denominator =
        delivered &&
        Object.values(delivered).reduce(
          (sum, amount) => sum + (amount ?? 0),
          0,
        );
      if (
        delivered &&
        Object.values(delivered).some((amount) => !nonnegative(amount))
      )
        numerator = undefined;
      break;
    }
    case "fuelRetirement":
      numerator =
        facts.ownedFuels === undefined
          ? undefined
          : (facts.ownedFuels[objective.fuel] ?? 0);
      break;
    case "monthlyBilledRate":
      numerator =
        customerSalesRevenue(row) /
        getRateInflationIndex(
          { year: row.year, monthNumber: row.month },
          context.startingYear,
          context.seed,
        );
      denominator = row.supplyWh / 1000;
      break;
    case "monthEndDebt":
      numerator =
        facts.debtPrincipal === undefined
          ? undefined
          : facts.debtPrincipal /
            getInflationIndex(
              { year: row.year, monthNumber: row.month },
              context.startingYear,
              context.seed,
            );
      break;
  }
  return [
    facts.month,
    nonnegative(numerator) ? numerator : null,
    nonnegative(denominator) ? denominator : null,
  ];
}

export function recordObjectiveMonth(
  progress: ObjectiveProgress,
  objectives: readonly CompiledRuleObjective[],
  facts: ObjectiveMonthFacts,
  context: ObjectiveContext,
): ObjectiveProgress {
  if (!integer(facts.month, 0, context.durationMonths - 1)) return progress;
  const definitions = new Map(
    objectives.map((objective) => [objective.id, objective]),
  );
  const entries = progress.entries.map((entry) => {
    const objective = definitions.get(entry.id);
    if (!objective) return entry;
    const [first, last] = observationWindow(objective, context.durationMonths);
    if (facts.month < first || facts.month > last) return entry;
    if (
      entry.observations.some((observation) => observation[0] === facts.month)
    ) {
      return {
        ...entry,
        duplicateMonths: [
          ...new Set([...entry.duplicateMonths, facts.month]),
        ].sort((a, b) => a - b),
      };
    }
    const observation = objectiveMonthObservation(
      objective,
      facts,
      context,
      progress.retentionBaseline,
    );
    const observations = [...entry.observations, observation].sort(
      (a, b) => a[0] - b[0],
    );
    let digest = entry.digest;
    if (observations[observations.length - 1] === observation)
      digest = nextEvidenceDigest(digest, observation);
    else {
      digest = initialEvidenceDigest(
        objective,
        context,
        progress.retentionBaseline,
      );
      observations.forEach((value) => {
        digest = nextEvidenceDigest(digest, value);
      });
    }
    return { ...entry, observations, digest };
  });
  const plain: Omit<ObjectiveProgress, "checksum"> = {
    ...progress,
    entries,
    completedMonths: Math.max(progress.completedMonths, facts.month + 1),
  };
  return { ...plain, checksum: progressChecksum(plain) };
}

export function evaluateScenarioObjectives(
  objectives: readonly CompiledRuleObjective[],
  progress: ObjectiveProgress,
  context: ObjectiveContext,
): ObjectiveResult[] {
  return [...objectives].sort(byId).map((objective) => {
    const [first, last] = requiredWindow(objective, context.durationMonths);
    const entry = progress.entries.find((value) => value.id === objective.id);
    const observed =
      entry?.observations.filter(
        ([month]) =>
          month >= first && month <= last && month < context.completedMonths,
      ) ?? [];
    const elapsed = Math.max(
      0,
      Math.min(last + 1, context.completedMonths) - first,
    );
    const requiredMonths = last - first + 1;
    const result: ObjectiveResult = {
      objective,
      id: objective.id,
      metric: objective.metric,
      label: objective.label,
      required: objective.required,
      definition: objectiveDefinition(objective.metric),
      target: objectiveTarget(objective),
      observedMonths: observed.length,
      requiredMonths,
      status:
        context.completedMonths <=
        (objective.metric === "customerRetention" ? 0 : first)
          ? "pending"
          : "inProgress",
    };
    const windowRatio =
      objective.metric === "emissionsPerDeliveredMWh" ||
      objective.metric === "localFuelShare";
    let invalid = observed.some(
      ([, numerator, denominator]) =>
        numerator === null ||
        denominator === null ||
        (!windowRatio && denominator === 0),
    );
    const duplicate = entry?.duplicateMonths.some(
      (month) =>
        month >= first && month <= last && month < context.completedMonths,
    );
    const incomplete = observed.length !== elapsed || duplicate;
    const ended = context.completedMonths > last;
    const observedRatios = observed
      .filter(
        (value): value is [number, number, number] =>
          value[1] !== null && value[2] !== null && value[2] > 0,
      )
      .map(([, numerator, denominator]) => numerator / denominator);
    if (observedRatios.some((value) => !Number.isFinite(value))) invalid = true;
    const ratios = observedRatios.filter(Number.isFinite);
    const numeratorTotal = observed.reduce(
      (total, row) => total + (row[1] ?? 0),
      0,
    );
    const denominatorTotal = observed.reduce(
      (total, row) => total + (row[2] ?? 0),
      0,
    );
    if (!Number.isFinite(numeratorTotal) || !Number.isFinite(denominatorTotal))
      invalid = true;
    if (windowRatio && observed.length && denominatorTotal === 0)
      invalid = true;
    let failed = false;
    switch (objective.metric) {
      case "monthlyReliability":
        if (ratios.length) result.observed = Math.min(...ratios);
        failed = ratios.some((value) => !objectiveTargetMet(objective, value));
        break;
      case "customerRetention": {
        const latest = entry?.observations
          .filter(([month]) => month < context.completedMonths)
          .slice(-1)[0];
        if (
          latest?.[1] !== null &&
          latest?.[1] !== undefined &&
          progress.retentionBaseline > 0
        ) {
          result.observed = latest[1] / progress.retentionBaseline;
          const remaining = Math.max(0, objective.deadlineMonth - latest[0]);
          failed =
            latest[0] === objective.deadlineMonth
              ? !objectiveTargetMet(objective, result.observed)
              : bestReachableCustomers(
                  latest[1],
                  remaining,
                  context.ownership,
                  context.marketSize,
                ) <
                progress.retentionBaseline * result.target;
        }
        break;
      }
      case "emissionsBudget":
        if (observed.length && Number.isFinite(numeratorTotal))
          result.observed = numeratorTotal;
        failed =
          result.observed !== undefined &&
          !objectiveTargetMet(objective, result.observed);
        break;
      case "emissionsPerDeliveredMWh":
      case "localFuelShare":
        if (
          observed.length &&
          denominatorTotal > 0 &&
          Number.isFinite(numeratorTotal / denominatorTotal)
        )
          result.observed = numeratorTotal / denominatorTotal;
        failed =
          ended &&
          !invalid &&
          !incomplete &&
          result.observed !== undefined &&
          !objectiveTargetMet(objective, result.observed);
        break;
      case "fuelRetirement":
      case "monthlyBilledRate":
      case "monthEndDebt":
        if (ratios.length) result.observed = Math.max(...ratios);
        failed = ratios.some((value) => !objectiveTargetMet(objective, value));
        break;
    }
    if (failed) {
      result.status = "failed";
      result.reason =
        objective.metric === "customerRetention" && !ended
          ? "The required customer count cannot be reached by the deadline, even with the fastest possible growth."
          : {
              monthlyReliability:
                "At least one completed month supplied less than the required share of customer demand.",
              customerRetention:
                "Customers at the deadline were below the required share of starting customers.",
              emissionsBudget:
                "Recorded emissions already exceed the total window budget.",
              emissionsPerDeliveredMWh:
                "Window emissions per delivered customer MWh exceed the required ceiling.",
              localFuelShare:
                "The selected local fuels delivered less than the required share of local electricity.",
              fuelRetirement:
                "An asset of this fuel remained owned at a required month close.",
              monthlyBilledRate:
                "At least one completed month billed more than the starting-year rate ceiling.",
              monthEndDebt:
                "Loan principal at a completed month close exceeded the starting-year ceiling.",
            }[objective.metric];
    } else if (
      invalid ||
      incomplete ||
      (ended && observed.length !== requiredMonths)
    ) {
      result.status = "unverifiable";
      result.reason = duplicate
        ? "More than one completed record exists for a required month."
        : invalid
          ? "A required observation is unavailable or has a zero denominator."
          : "Exactly one completed record is required for every elapsed month in the objective window.";
    } else if (ended) result.status = "completed";
    return result;
  });
}

function validCompiledObjective(
  value: unknown,
): value is CompiledRuleObjective {
  if (!value || typeof value !== "object" || !isRuleJson(value)) return false;
  const objective = value as CompiledRuleObjective;
  if (
    !OBJECTIVE_METRICS.includes(objective.metric) ||
    typeof objective.required !== "boolean" ||
    (objective.inherited !== undefined &&
      typeof objective.inherited !== "boolean")
  )
    return false;
  const { inherited: _inherited, ...authored } = objective;
  const normalized: Record<string, unknown> = { ...authored };
  if ("deadlineMonth" in objective)
    normalized.deadlineMonth = objective.deadlineMonth + 1;
  else {
    normalized.fromMonth = objective.fromMonth + 1;
    normalized.throughMonth = objective.throughMonth + 1;
  }
  if (objective.metric === "emissionsBudget") {
    normalized.budgetTonnesCO2e = objective.budgetKgCO2e / 1000;
    delete normalized.budgetKgCO2e;
  }
  if (objective.metric === "monthEndDebt") {
    normalized.maxDebtDollars = objective.maxDebt;
    delete normalized.maxDebt;
  }
  return ruleDiagnostics({ objectives: [normalized] }).length === 0;
}

/** Structural validation for persisted debriefs, whose source monthly facts may no longer exist. */
export function validObjectiveResult(value: unknown): value is ObjectiveResult {
  if (
    !value ||
    typeof value !== "object" ||
    !isRuleJson(value) ||
    !keysAre(value, [
      "objective",
      "id",
      "metric",
      "label",
      "required",
      "definition",
      "status",
      "observed",
      "target",
      "observedMonths",
      "requiredMonths",
      "reason",
    ])
  )
    return false;
  const result = value as ObjectiveResult;
  return (
    validCompiledObjective(result.objective) &&
    result.id === result.objective.id &&
    result.metric === result.objective.metric &&
    result.label === result.objective.label &&
    result.required === result.objective.required &&
    result.definition === objectiveDefinition(result.metric) &&
    ["pending", "inProgress", "completed", "failed", "unverifiable"].includes(
      result.status,
    ) &&
    result.target === objectiveTarget(result.objective) &&
    (result.observed === undefined || nonnegative(result.observed)) &&
    integer(result.requiredMonths, 1, 1200) &&
    (result.objective.metric === "fuelRetirement"
      ? result.requiredMonths <= 1200 - result.objective.deadlineMonth
      : result.requiredMonths ===
        (result.objective.metric === "customerRetention"
          ? 1
          : result.objective.throughMonth - result.objective.fromMonth + 1)) &&
    integer(result.observedMonths, 0, result.requiredMonths) &&
    (result.status !== "completed" ||
      (result.observedMonths === result.requiredMonths &&
        result.observed !== undefined &&
        objectiveTargetMet(result.objective, result.observed))) &&
    (result.reason === undefined || text(result.reason, 1000))
  );
}

export function validObjectiveProgress(
  value: unknown,
  objectives: readonly CompiledRuleObjective[],
  context: ObjectiveContext,
): value is ObjectiveProgress {
  if (
    !value ||
    typeof value !== "object" ||
    !isRuleJson(value) ||
    !keysAre(value, [
      "version",
      "rulesDigest",
      "retentionBaseline",
      "completedMonths",
      "entries",
      "checksum",
    ])
  )
    return false;
  const progress = value as ObjectiveProgress;
  if (
    progress.version !== 1 ||
    progress.rulesDigest !== context.rulesDigest ||
    !nonnegative(progress.retentionBaseline) ||
    !integer(progress.completedMonths, 0, context.durationMonths) ||
    progress.completedMonths !== context.completedMonths ||
    !Array.isArray(progress.entries) ||
    progress.entries.length !== objectives.length ||
    objectives.length > 16 ||
    !/^sha256-[a-f0-9]{64}$/.test(progress.checksum)
  )
    return false;
  const sorted = [...objectives].sort(byId);
  for (let index = 0; index < sorted.length; index++) {
    const objective = sorted[index],
      entry = progress.entries[index];
    if (
      !validCompiledObjective(objective) ||
      !entry ||
      typeof entry !== "object" ||
      !keysAre(entry, ["id", "observations", "digest", "duplicateMonths"]) ||
      entry.id !== objective.id ||
      !Array.isArray(entry.observations) ||
      entry.observations.length > 1200 ||
      !Array.isArray(entry.duplicateMonths) ||
      entry.duplicateMonths.length > 1200 ||
      !/^sha256-[a-f0-9]{64}$/.test(entry.digest)
    )
      return false;
    const [first, last] = observationWindow(objective, context.durationMonths);
    let previous = -1,
      digest = initialEvidenceDigest(
        objective,
        context,
        progress.retentionBaseline,
      );
    let numeratorTotal = 0,
      denominatorTotal = 0;
    for (const observation of entry.observations) {
      if (
        !Array.isArray(observation) ||
        observation.length !== 3 ||
        !integer(
          observation[0],
          first,
          Math.min(last, context.completedMonths - 1),
        ) ||
        observation[0] <= previous ||
        observation
          .slice(1)
          .some((number) => number !== null && !nonnegative(number))
      )
        return false;
      previous = observation[0];
      const [, numerator, denominator] = observation;
      if (numerator !== null && denominator !== null) {
        numeratorTotal += numerator;
        denominatorTotal += denominator;
        if (
          !Number.isFinite(numeratorTotal) ||
          !Number.isFinite(denominatorTotal) ||
          (denominator > 0 && !Number.isFinite(numerator / denominator)) ||
          (["emissionsBudget", "fuelRetirement", "monthEndDebt"].includes(
            objective.metric,
          ) &&
            denominator !== 1) ||
          (objective.metric === "customerRetention" &&
            denominator !== progress.retentionBaseline) ||
          (objective.metric === "fuelRetirement" &&
            !Number.isSafeInteger(numerator)) ||
          (objective.metric === "localFuelShare" &&
            numerator > denominator * (1 + 1e-12))
        )
          return false;
      }
      digest = nextEvidenceDigest(digest, observation);
    }
    if (
      digest !== entry.digest ||
      entry.duplicateMonths.some(
        (month, i) =>
          !integer(month, first, Math.min(last, context.completedMonths - 1)) ||
          (i > 0 && month <= entry.duplicateMonths[i - 1]) ||
          !entry.observations.some((row) => row[0] === month),
      )
    )
      return false;
  }
  return progressChecksum(progress) === progress.checksum;
}
