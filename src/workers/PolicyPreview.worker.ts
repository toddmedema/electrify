import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { previewPolicy } from "../helpers/PolicyPreview";
import { GameType, PolicyChangeType } from "../Types";

const worker = globalThis as unknown as Worker;
const load = (initialize: (done: (error?: string) => void) => void) =>
  new Promise<void>((resolve, reject) =>
    initialize((error) => (error ? reject(new Error(error)) : resolve())),
  );
worker.onmessage = async (
  event: MessageEvent<{
    game: GameType;
    change: PolicyChangeType;
    month: number;
  }>,
) => {
  try {
    const { game, change, month } = event.data;
    await Promise.all([
      load(initEconomy),
      load(initFuelPrices),
      load((done) => initWeather(game.location, done)),
    ]);
    worker.postMessage({ result: previewPolicy(game, change, month) });
  } catch (_error) {
    worker.postMessage({
      error:
        "Could not estimate this change. Try another choice or reopen the program.",
    });
  }
};
export {};
