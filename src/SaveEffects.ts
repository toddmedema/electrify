import type { VictoryType } from "./Types";

/** Transient reducer effect scope. Never enters deterministic game state. */
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
  cloudSaveListeners.forEach((listener) => {
    try {
      listener(id);
    } catch {
      // Backup requests are hints after local commits. A broken subscriber cannot
      // fail that completed operation or keep other backup providers from hearing it.
    }
  });
}
export function subscribeCloudSaveRequests(
  listener: (id?: string) => void,
): () => void {
  cloudSaveListeners.add(listener);
  return () => cloudSaveListeners.delete(listener);
}
