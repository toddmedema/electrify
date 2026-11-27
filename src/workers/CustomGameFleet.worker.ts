import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { waitForLoad } from "../helpers/WaitForLoad";
import {
  CustomGameFleetRequest,
  CustomGameFleetResponse,
  sizeCustomGameFleet,
} from "../helpers/CustomGameFleet";
import { getScenarioLocation } from "../helpers/Locations";

const worker = globalThis as unknown as Worker;
let pending: CustomGameFleetRequest | undefined;
let running = false;

async function calculate(request: CustomGameFleetRequest): Promise<void> {
  const { requestId, scenario, seed } = request;
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
    const response: CustomGameFleetResponse = {
      requestId,
      facilities: sizeCustomGameFleet(scenario, seed),
    };
    worker.postMessage(response);
  } catch (error) {
    const response: CustomGameFleetResponse = {
      requestId,
      error: error instanceof Error ? error.message : "Sizing failed",
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

worker.onmessage = (event: MessageEvent<CustomGameFleetRequest>) => {
  // Finish the calculation in flight, but collapse a burst of edits to its newest request. This
  // also keeps the worker's private, module-global weather data from being loaded concurrently.
  pending = event.data;
  void runPending();
};

export {};
