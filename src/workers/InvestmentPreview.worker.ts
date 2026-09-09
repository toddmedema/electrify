import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import {
  InvestmentPurchase,
  previewInvestments,
} from "../helpers/InvestmentPreview";
import { GameType } from "../Types";

const worker = globalThis as unknown as Worker;
const load = (initialize: (done: (error?: string) => void) => void) =>
  new Promise<void>((resolve, reject) =>
    initialize((error) => (error ? reject(new Error(error)) : resolve())),
  );
worker.onmessage = async (
  event: MessageEvent<{
    game: GameType;
    purchases: InvestmentPurchase[];
    years: number;
  }>,
) => {
  try {
    const { game, purchases, years } = event.data;
    await Promise.all([
      load(initEconomy),
      load(initFuelPrices),
      load((done) => initWeather(game.location, done)),
    ]);
    worker.postMessage({ result: previewInvestments(game, purchases, years) });
  } catch (error) {
    worker.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not test this plan. Please try again.",
    });
  }
};
export {};
