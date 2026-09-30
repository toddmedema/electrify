/** Kept separate so Jest can mock the webpack worker entry point. */
export function createProjectionWorker(): Worker {
  return new Worker(
    new URL("../../workers/Projection.worker.ts", import.meta.url),
  );
}
