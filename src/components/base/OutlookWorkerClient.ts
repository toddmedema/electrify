/** Kept separate so Jest can replace webpack's worker constructor. */
export function createOutlookWorker(): Worker {
  return new Worker(
    new URL("../../workers/Outlook.worker.ts", import.meta.url),
  );
}
