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

const cloudSaveListeners = new Set<(id?: string) => void>();
/** Explicit save interactions bypass the automatic cloud backup cadence. */
export function requestCloudSave(id?: string): void {
  cloudSaveListeners.forEach((listener) => listener(id));
}
export function subscribeCloudSaveRequests(
  listener: (id?: string) => void,
): () => void {
  cloudSaveListeners.add(listener);
  return () => cloudSaveListeners.delete(listener);
}
