import { DIFFICULTY_IDS } from "../Constants";
import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { getScenarioLocation } from "../helpers/Locations";
import {
  resolvedScenarioStartingPeak,
  ScenarioStartingPeakResponse,
} from "../helpers/ScenarioStartingPeak";
import { waitForLoad } from "../helpers/WaitForLoad";
import type { DifficultyType, ScenarioType } from "../Types";

const worker = globalThis as unknown as Worker;
worker.onmessage = async ({
  data,
}: MessageEvent<{ scenario: ScenarioType }>) => {
  try {
    const location = getScenarioLocation(data.scenario);
    if (!location) throw new Error("The scenario has no playable location.");
    const loaded = await Promise.allSettled([
      waitForLoad(initEconomy),
      waitForLoad(initFuelPrices),
      waitForLoad((done) => initWeather(location, done)),
    ]);
    const failure = loaded.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const peaks = {} as Record<DifficultyType, number>;
    for (const difficulty of DIFFICULTY_IDS) {
      const peak = resolvedScenarioStartingPeak(
        data.scenario,
        difficulty,
        data.scenario.seed ?? 0,
      );
      if (peak === undefined)
        throw new Error(
          "The scenario's starting peak could not be calculated.",
        );
      peaks[difficulty] = peak;
    }
    worker.postMessage({ peaks } satisfies ScenarioStartingPeakResponse);
  } catch (error) {
    worker.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "The scenario's data could not be prepared.",
    } satisfies ScenarioStartingPeakResponse);
  }
};
