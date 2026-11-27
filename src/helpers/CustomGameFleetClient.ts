/** Creates the isolated simulation that sizes a custom setup's starting grid. */
export function createCustomGameFleetWorker(): Worker {
  return new Worker(
    new URL("../workers/CustomGameFleet.worker.ts", import.meta.url),
  );
}
