import {
  computeAgreementForecast,
  AgreementForecastRequest,
} from "../helpers/AgreementForecast";
import { selectProjection } from "../helpers/Projection";
import type { GameType, TickPresentFutureType } from "../Types";
import { createForecastDataLoader } from "./ForecastData";
import { packProjection } from "../components/base/ProjectionTransport";

const worker = globalThis as unknown as Worker;
type Request =
  | AgreementForecastRequest
  | {
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
    const request = pending;
    const { requestId, game } = request;
    pending = undefined;
    try {
      await loadData(game);
      if (pending) continue;
      if ("kind" in request && request.kind === "agreement") {
        const agreementForecast = computeAgreementForecast(
          game,
          request.agreementId,
          request.offer,
          request.cacheEpoch,
        );
        worker.postMessage({ requestId, agreementForecast });
        continue;
      }
      if (!("now" in request)) throw new Error("Missing projection frame");
      const { transport, transfers } = packProjection(
        selectProjection(game, request.now),
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
