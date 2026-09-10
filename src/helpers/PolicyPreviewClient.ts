export function createPolicyPreviewWorker(): Worker {
  return new Worker(
    new URL("../workers/PolicyPreview.worker.ts", import.meta.url),
  );
}
