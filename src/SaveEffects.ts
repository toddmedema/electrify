import type { VictoryType } from "./Types";

/** Transient reducer effect scope. Never enters deterministic game or replay state. */
export interface RunSaveEffects {
  outcome: (victory: VictoryType, message?: () => string) => void;
}
let current: RunSaveEffects | undefined;
export function currentRunSaveEffects(): RunSaveEffects | undefined {
  return current;
}
export function withRunSaveEffects<T>(
  effects: RunSaveEffects | undefined,
  reduce: () => T,
): T {
  const previous = current;
  current = effects;
  try {
    return reduce();
  } finally {
    current = previous;
  }
}
