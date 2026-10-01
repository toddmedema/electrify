export function createDataCenterSetupWorker(): Worker {
  return new Worker(
    new URL("../workers/DataCenterSetup.worker.ts", import.meta.url),
  );
}
