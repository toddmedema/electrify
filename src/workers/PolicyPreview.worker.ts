import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { previewPolicy } from "../helpers/PolicyPreview";
import { previewWildfire } from "../helpers/WildfirePreview";
import { waitForLoad } from "../helpers/WaitForLoad";
import { GameType, PolicyChangeType } from "../Types";

const worker = globalThis as unknown as Worker;
worker.onmessage = async (
  // A policy change to estimate, or no change to simulate a typical wildfire in that month
  event: MessageEvent<{
    game: GameType;
    change?: PolicyChangeType;
    month: number;
  }>,
) => {
  try {
    const { game, change, month } = event.data;
    await Promise.all([
      waitForLoad(initEconomy),
      waitForLoad(initFuelPrices),
      waitForLoad((done) => initWeather(game.location, done)),
    ]);
    worker.postMessage({
      result: change
        ? previewPolicy(game, change, month)
        : previewWildfire(game, month),
    });
  } catch (_error) {
    worker.postMessage({
      error:
        "Could not estimate this change. Try another choice or reopen the program.",
    });
  }
};
export {};
