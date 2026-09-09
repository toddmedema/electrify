export function createInvestmentPreviewWorker(): Worker {
  return new Worker(
    new URL("../workers/InvestmentPreview.worker.ts", import.meta.url),
  );
}
