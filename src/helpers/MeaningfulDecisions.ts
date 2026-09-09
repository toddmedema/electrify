import {
  DifficultyType,
  GameType,
  MeaningfulDecisionKindType,
  MeaningfulDecisionType,
} from "../Types";

export const INTERN_MEANINGFUL_DECISIONS_REQUIRED = 1;
export const CEO_MEANINGFUL_DECISIONS_REQUIRED = 10;
export const CEO_MEANINGFUL_CATEGORIES_REQUIRED = 4;
export const MAX_MEANINGFUL_DECISIONS = 1000;

export const MEANINGFUL_DECISION_CATEGORY_LABELS: Record<
  MeaningfulDecisionKindType,
  string
> = {
  asset: "grid investments",
  sale: "retirements and sales",
  rate: "customer pricing",
  policy: "customer programs",
  operation: "plant operations",
  dispatch: "dispatch planning",
  trading: "regional trading",
};

export type DecisionChangeType = Omit<MeaningfulDecisionType, "key" | "month">;

/**
 * Records an accepted simulation change under one lifetime key for that lever or asset. Returning
 * a lever to its original value removes the entry even in a later month, so slider, program,
 * operating, dispatch, and trading churn cannot pad a victory objective.
 */
export function recordMeaningfulDecision(
  game: GameType,
  change: DecisionChangeType,
): void {
  if (change.before === change.after) return;
  const month = game.date.monthsElapsed;
  const key = change.lever;
  const log = game.meaningfulDecisions;
  const existingIndex = log.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) {
    const existing = log[existingIndex];
    if (existing.before === change.after) log.splice(existingIndex, 1);
    else {
      existing.after = change.after;
      existing.label = change.label;
      existing.month = month;
    }
    return;
  }
  if (log.length >= MAX_MEANINGFUL_DECISIONS) return;
  log.push({ ...change, key, month });
}

export function meaningfulDecisionCount(
  game: Pick<GameType, "meaningfulDecisions">,
): number {
  return game.meaningfulDecisions.length;
}

export function meaningfulDecisionCategoryCount(
  decisions: MeaningfulDecisionType[],
): number {
  return new Set(decisions.map(({ kind }) => kind)).size;
}

export function meaningfulDecisionRequirement(difficulty: DifficultyType): {
  count: number;
  categories: number;
} | null {
  if (difficulty === "Intern")
    return { count: INTERN_MEANINGFUL_DECISIONS_REQUIRED, categories: 1 };
  if (difficulty === "CEO")
    return {
      count: CEO_MEANINGFUL_DECISIONS_REQUIRED,
      categories: CEO_MEANINGFUL_CATEGORIES_REQUIRED,
    };
  return null;
}

/** One percent of current peak demand, with a 1 MW floor, is a material grid commitment. */
export function isMaterialCapacityDecision(
  game: GameType,
  capacityW: number,
): boolean {
  const peakDemandW = game.timeline.reduce(
    (peak, tick) => Math.max(peak, tick.demandW || 0),
    0,
  );
  return capacityW >= Math.max(1_000_000, peakDemandW * 0.01);
}

export function validMeaningfulDecisions(
  raw: unknown,
  currentMonth: number,
): raw is MeaningfulDecisionType[] {
  if (!Array.isArray(raw) || raw.length > MAX_MEANINGFUL_DECISIONS)
    return false;
  const keys = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return false;
    const decision = entry as Partial<MeaningfulDecisionType>;
    if (
      typeof decision.key !== "string" ||
      typeof decision.lever !== "string" ||
      !/^[a-z][a-z0-9:-]*$/.test(decision.lever) ||
      typeof decision.label !== "string" ||
      decision.label.trim().length === 0 ||
      decision.label.length > 160 ||
      !Number.isInteger(decision.month) ||
      decision.month! < 0 ||
      decision.month! > currentMonth ||
      decision.key !== decision.lever ||
      typeof decision.kind !== "string" ||
      ![
        "asset",
        "sale",
        "rate",
        "policy",
        "operation",
        "dispatch",
        "trading",
      ].includes(decision.kind) ||
      typeof decision.before !== "string" ||
      typeof decision.after !== "string" ||
      decision.before === decision.after ||
      keys.has(decision.key)
    )
      return false;
    keys.add(decision.key);
  }
  return true;
}
