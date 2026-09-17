import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import {
  CustomGameForecastRequest,
  CustomGameForecastResponse,
  forecastCustomGameYearOne,
} from "../helpers/CustomGameForecast";
import { getScenarioLocation } from "../helpers/Locations";

const worker = globalThis as unknown as Worker;
let pending: CustomGameForecastRequest | undefined;
let running = false;

function waitForLoad(
  initialize: (done: (failure?: string) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    initialize((failure?: string) => {
      if (failure) {
        reject(new Error(failure));
      } else {
        resolve();
      }
    });
  });
}

async function calculate(request: CustomGameForecastRequest): Promise<void> {
  const { requestId, scenario, difficulty, seed } = request;
  try {
    const location = getScenarioLocation(scenario);
    if (!location) {
      throw new Error("The custom setup has no playable location");
    }
    await Promise.all([
      waitForLoad(initEconomy),
      waitForLoad(initFuelPrices),
      waitForLoad((done) => initWeather(location, done)),
    ]);
    const response: CustomGameForecastResponse = {
      requestId,
      outlook: forecastCustomGameYearOne(scenario, difficulty, seed),
    };
    worker.postMessage(response);
  } catch (error) {
    const response: CustomGameForecastResponse = {
      requestId,
      error: error instanceof Error ? error.message : "Forecast failed",
    };
    worker.postMessage(response);
  }
}

async function runPending(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  while (pending) {
    const request = pending;
    pending = undefined;
    await calculate(request);
  }
  running = false;
}

worker.onmessage = (event: MessageEvent<CustomGameForecastRequest>) => {
  // Finish the calculation in flight, but collapse a burst of edits to its newest request. This
  // also keeps the worker's private, module-global weather data from being loaded concurrently.
  pending = event.data;
  void runPending();
};

export {};
