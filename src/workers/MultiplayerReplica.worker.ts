import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { waitForLoad } from "../helpers/WaitForLoad";
import { matchScenario } from "../multiplayer/World";
import { ReplicaRuntime } from "../multiplayer/ReplicaRuntime";
import type { ReplicaRequest } from "../multiplayer/ReplicaProtocol";

const worker = globalThis as unknown as Worker;
const runtime = new ReplicaRuntime(
  (response) => worker.postMessage(response),
  async (spec) => {
    const { location } = matchScenario(spec);
    await Promise.all([
      waitForLoad(initEconomy),
      waitForLoad(initFuelPrices),
      waitForLoad((done) => initWeather(location, done)),
    ]);
  },
);
// Replica workers deliberately never install account achievement hooks.
worker.onmessage = ({ data }: MessageEvent<ReplicaRequest>) => {
  void runtime.receive(data);
};
