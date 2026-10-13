import { selectProjection } from "../helpers/Projection";
import type { GameType, TickPresentFutureType } from "../Types";
import { createForecastDataLoader } from "./ForecastData";
import { packProjection } from "../components/base/ProjectionTransport";

const worker = globalThis as unknown as Worker;
type Request = {
  requestId: number;
  game: GameType;
  now: TickPresentFutureType;
};
let pending: Request | undefined;
let running = false;

const loadData = createForecastDataLoader();

async function runPending(): Promise<void> {
  if (running) return;
  running = true;
  // Serialize location-dependent data loads and collapse edits made while loading.
  while (pending) {
    const { requestId, game, now } = pending;
    pending = undefined;
    try {
      await loadData(game);
      if (pending) continue;
      const { transport, transfers } = packProjection(
        selectProjection(game, now),
      );
      worker.postMessage({ requestId, transport }, transfers);
    } catch (_error) {
      worker.postMessage({ requestId, error: true });
    }
  }
  running = false;
}

worker.onmessage = (event: MessageEvent<Request>) => {
  pending = event.data;
  void runPending();
};

export {};
