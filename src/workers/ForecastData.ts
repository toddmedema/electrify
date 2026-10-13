import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import type { GameType } from "../Types";

const load = (initialize: (done: (error?: string) => void) => void) =>
  new Promise<void>((resolve, reject) =>
    initialize((error) => (error ? reject(new Error(error)) : resolve())),
  );

/** Each persistent worker owns its data and resets seeded forecasts only when the run changes. */
export function createForecastDataLoader(): (game: GameType) => Promise<void> {
  let dataSeed: number | undefined;
  let economy: Promise<void> | undefined;
  let fuelPrices: Promise<void> | undefined;
  let weather: Promise<void> | undefined;
  let weatherKey: string | undefined;

  return async (game) => {
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
    // Settle every initializer before another request can reset location-dependent data.
    const results = await Promise.allSettled([economy, fuelPrices, weather]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
}
