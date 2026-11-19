import type { RootState } from "../Store";

/** Host receipts and projected state are separate events. Bound waiting and cancel across runs. */
export async function waitForPurchase<T>(
  read: () => RootState,
  match: (state: RootState) => T | undefined,
  timeoutMs = 15000,
): Promise<T | undefined> {
  const initial = read();
  const run = initial.ui?.evidenceRunId;
  const seed = initial.game.seed;
  const scenario = initial.game.scenarioId;
  const started = Date.now();
  do {
    const state = read();
    if (
      state.ui?.evidenceRunId !== run ||
      state.game.seed !== seed ||
      state.game.scenarioId !== scenario
    )
      return undefined;
    const result = match(state);
    if (result !== undefined) return result;
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  } while (Date.now() - started < timeoutMs);
  return undefined;
}
