/** Creates the isolated simulation used by the custom setup outlook. */
export function createCustomGameForecastWorker(): Worker {
  return new Worker(
    new URL("../workers/CustomGameForecast.worker.ts", import.meta.url),
  );
}
