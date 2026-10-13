import {
  computeOutlook,
  OutlookRequest,
} from "../components/base/OutlookForecast";
import { createForecastDataLoader } from "./ForecastData";

const worker = globalThis as unknown as Worker;
const loadData = createForecastDataLoader();
let pending: OutlookRequest | undefined;
let running = false;

async function runPending(): Promise<void> {
  if (running) return;
  running = true;
  while (pending) {
    const { requestId, kind, game } = pending;
    pending = undefined;
    try {
      await loadData(game);
      if (pending) continue;
      worker.postMessage({ requestId, result: computeOutlook(kind, game) });
    } catch (_error) {
      worker.postMessage({ requestId, error: true });
    }
  }
  running = false;
}

worker.onmessage = (event: MessageEvent<OutlookRequest>) => {
  pending = event.data;
  void runPending();
};

export {};
