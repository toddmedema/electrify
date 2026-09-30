import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { selectProjection } from "../helpers/Projection";
import type { GameType, TickPresentFutureType } from "../Types";

const worker = globalThis as unknown as Worker;
type Request = {
  requestId: number;
  game: GameType;
  now: TickPresentFutureType;
};
let pending: Request | undefined;
let running = false;

const load = (initialize: (done: (error?: string) => void) => void) =>
  new Promise<void>((resolve, reject) =>
    initialize((error) => (error ? reject(new Error(error)) : resolve())),
  );

let dataSeed: number | undefined;
let economy: Promise<void> | undefined;
let fuelPrices: Promise<void> | undefined;
let weather: Promise<void> | undefined;
let weatherKey: string | undefined;

async function loadData(game: GameType): Promise<void> {
  // These modules append seeded forecast rows to their historical data. A new seed must reset
  // all three, even when an imported run uses the same location and calendar month.
  if (dataSeed !== game.seed) {
    dataSeed = game.seed;
    economy = undefined;
    fuelPrices = undefined;
    weather = undefined;
    weatherKey = undefined;
  }
  economy ??= load(initEconomy).catch((error: unknown) => {
    economy = undefined;
    throw error;
  });
  fuelPrices ??= load(initFuelPrices).catch((error: unknown) => {
    fuelPrices = undefined;
    throw error;
  });
  const key = JSON.stringify([game.location.id, game.location.watershedId]);
  if (weatherKey !== key || !weather) {
    weatherKey = key;
    weather = load((done) => initWeather(game.location, done)).catch(
      (error: unknown) => {
        weather = undefined;
        throw error;
      },
    );
  }
  // Wait for every initializer even if one fails: the next request must not reset weather
  // while an older fetch is still in flight. Only failed initializers are retried.
  const results = await Promise.allSettled([economy, fuelPrices, weather]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

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
      worker.postMessage({
        requestId,
        projection: selectProjection(game, now),
      });
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
