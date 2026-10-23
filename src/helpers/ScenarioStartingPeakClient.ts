/** Loading and forecasting a menu preview must never replace the active game's global data. */
export function createScenarioStartingPeakWorker(): Worker {
  return new Worker(
    new URL("../workers/ScenarioStartingPeak.worker.ts", import.meta.url),
  );
}
