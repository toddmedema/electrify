import type { FuelNameType } from "../Types";
import { RULE_FUELS, RULE_LIMITS } from "./ScenarioRulesSchema";

interface FuelShareRequirement {
  id: string;
  fuels: readonly FuelNameType[];
  minShare: number;
}
export interface FuelShareFeasibility {
  status: "feasible" | "infeasible" | "unverifiable";
  pivots: number;
}
export const MAX_FUEL_SHARE_PIVOTS = 4096;
const EPSILON = 1e-12;

/**
 * A normalized fuel mix exists iff the minimum mass covering all required subset shares is <=1.
 * Its dual maximizes sum(target*y), with one capacity-one row per fuel and nonnegative y.
 * This packing problem starts at a feasible all-slack basis, so no artificial variables or
 * goal-subset enumeration are needed. Bland's rule makes degenerate pivots deterministic.
 * We accept/reject only verified primal/dual certificates; exhausted work remains unavailable.
 */
export function requiredFuelShareFeasibility(
  input: readonly FuelShareRequirement[],
  pivotBudget = MAX_FUEL_SHARE_PIVOTS,
): FuelShareFeasibility {
  const unavailable = (pivots: number): FuelShareFeasibility => ({
    status: "unverifiable",
    pivots,
  });
  if (
    input.length > RULE_LIMITS.objectives ||
    input.some(
      (goal) =>
        !Number.isFinite(goal.minShare) ||
        goal.minShare < 0 ||
        goal.minShare > 1 ||
        goal.fuels.length === 0 ||
        goal.fuels.length > RULE_FUELS.length ||
        goal.fuels.some((fuel) => !RULE_FUELS.includes(fuel)),
    )
  )
    return unavailable(0);
  if (!input.length) return { status: "feasible", pivots: 0 };
  const goals = [...input].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const fuels = [...RULE_FUELS]
    .filter((fuel) => goals.some((goal) => goal.fuels.includes(fuel)))
    .sort();
  const n = goals.length,
    m = fuels.length,
    rhs = n + m;
  const coefficients: number[][] = fuels.map((fuel) =>
    goals.map((goal) => (goal.fuels.includes(fuel) ? 1 : 0)),
  );
  const tableau = coefficients.map((row, index) => [
    ...row,
    ...fuels.map((_, slack) => (index === slack ? 1 : 0)),
    1,
  ]);
  tableau.push([
    ...goals.map((goal) => -goal.minShare),
    ...fuels.map(() => 0),
    0,
  ]);
  const basis = fuels.map((_, index) => n + index);
  const budget = Number.isFinite(pivotBudget)
    ? Math.max(0, Math.min(MAX_FUEL_SHARE_PIVOTS, Math.floor(pivotBudget)))
    : 0;
  const infeasibleCertificate = () => {
    const y = goals.map(() => 0);
    basis.forEach((variable, row) => {
      if (variable < n) y[variable] = tableau[row][rhs];
    });
    if (!y.every((value) => Number.isFinite(value) && value >= -EPSILON))
      return false;
    const nonnegative = y.map((value) => Math.max(0, value));
    // Remove any roundoff over a fuel's capacity before using this rejection certificate.
    const scale = Math.max(
      1,
      ...coefficients.map((row) =>
        row.reduce((sum, value, index) => sum + value * nonnegative[index], 0),
      ),
    );
    return (
      nonnegative.reduce(
        (sum, value, index) => sum + (goals[index].minShare * value) / scale,
        0,
      ) >
      1 + EPSILON
    );
  };
  const feasibleCertificate = () => {
    const x = fuels.map((_, index) => tableau[m][n + index]);
    return (
      x.every((value) => Number.isFinite(value) && value >= -EPSILON) &&
      x.reduce((sum, value) => sum + Math.max(0, value), 0) <= 1 + EPSILON &&
      goals.every(
        (goal, index) =>
          coefficients.reduce(
            (sum, row, fuel) => sum + row[index] * Math.max(0, x[fuel]),
            0,
          ) >=
          goal.minShare - EPSILON,
      )
    );
  };
  let pivots = 0;
  while (true) {
    if (infeasibleCertificate()) return { status: "infeasible", pivots };
    const entering = tableau[m].findIndex(
      (value, column) => column < rhs && value < -EPSILON,
    );
    if (entering < 0)
      return feasibleCertificate()
        ? { status: "feasible", pivots }
        : unavailable(pivots);
    if (pivots >= budget) return unavailable(pivots);
    let leaving = -1,
      ratio = Infinity;
    for (let row = 0; row < m; row++) {
      if (tableau[row][rhs] < -EPSILON) return unavailable(pivots);
      const coefficient = tableau[row][entering];
      if (coefficient <= EPSILON) continue;
      const candidate = Math.max(0, tableau[row][rhs]) / coefficient;
      if (
        candidate < ratio - EPSILON ||
        (Math.abs(candidate - ratio) <= EPSILON &&
          (leaving < 0 || basis[row] < basis[leaving]))
      ) {
        leaving = row;
        ratio = candidate;
      }
    }
    if (leaving < 0) return unavailable(pivots);
    const pivot = tableau[leaving][entering];
    for (let column = 0; column <= rhs; column++)
      tableau[leaving][column] /= pivot;
    for (let row = 0; row <= m; row++) {
      if (row === leaving) continue;
      const factor = tableau[row][entering];
      for (let column = 0; column <= rhs; column++) {
        tableau[row][column] -= factor * tableau[leaving][column];
        if (!Number.isFinite(tableau[row][column])) return unavailable(pivots);
      }
      tableau[row][entering] = 0;
    }
    tableau[leaving][entering] = 1;
    basis[leaving] = entering;
    pivots++;
  }
}
