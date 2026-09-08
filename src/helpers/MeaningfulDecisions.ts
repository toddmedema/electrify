import { GameType, MeaningfulDecisionType } from "../Types";

export const CEO_MEANINGFUL_DECISIONS_REQUIRED = 10;
export const MAX_MEANINGFUL_DECISIONS = 1000;

export type DecisionChangeType = Omit<MeaningfulDecisionType, "key" | "month">;

/**
 * Records an accepted simulation change, coalescing one lever to its settled state for the month.
 * Returning a lever to its opening value removes the entry, so slider churn and inverse toggles
 * cannot pad the CEO objective.
 */
export function recordMeaningfulDecision(
  game: GameType,
  change: DecisionChangeType,
): void {
  if (change.before === change.after) return;
  const month = game.date.monthsElapsed;
  const key = `${change.lever}@${month}`;
  const log = game.meaningfulDecisions;
  const existingIndex = log.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) {
    const existing = log[existingIndex];
    if (existing.before === change.after) log.splice(existingIndex, 1);
    else existing.after = change.after;
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
      !Number.isInteger(decision.month) ||
      decision.month! < 0 ||
      decision.month! > currentMonth ||
      decision.key !== `${decision.lever}@${decision.month}` ||
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
