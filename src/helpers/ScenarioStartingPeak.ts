import { DIFFICULTY_IDS } from "../Constants";
import type { DifficultyType, ScenarioType } from "../Types";
import { getScenarioLocation } from "./Locations";
import {
  baselineScenario,
  calculateScenarioStartingPeak,
} from "./ScenarioStartingPeakCalculation";
import type { ScenarioStartingPeakResponse } from "./ScenarioStartingPeakCalculation";
export type { ScenarioStartingPeakResponse } from "./ScenarioStartingPeakCalculation";

const peaks = new Map<string, number>();
const preparing = new Map<string, Promise<void>>();
let preparation = Promise.resolve();

function cacheKey(
  baseline: ScenarioType,
  difficulty: DifficultyType,
  seed: number,
): string {
  return JSON.stringify([baseline, difficulty, seed]);
}

/**
 * Uses the production first-year forecast, including its ordinary customer drift. Callers that
 * load data synchronously (headless simulation) retain their existing loadSimData-before-entry contract.
 */
export function resolvedScenarioStartingPeak(
  scenario: ScenarioType,
  difficulty: DifficultyType,
  seed: number,
): number | undefined {
  const baseline = baselineScenario(scenario);
  const key = cacheKey(baseline, difficulty, seed);
  const cached = peaks.get(key);
  if (cached !== undefined) return cached;
  const peakW = calculateScenarioStartingPeak(baseline, difficulty, seed);
  if (peakW === undefined) return undefined;
  peaks.set(key, peakW);
  return peakW;
}

/**
 * Browser data and seeded forecasts live in a disposable worker. Leaving Mods or starting a run
 * while another preparation is pending can never replace the active game's records.
 */
export function prepareScenarioStartingPeak(
  scenario: ScenarioType,
): Promise<void> {
  const baseline = baselineScenario(scenario);
  const seed = scenario.seed ?? 0;
  const key = JSON.stringify([baseline, seed]);
  const pending = preparing.get(key);
  if (pending) return pending;
  if (
    DIFFICULTY_IDS.every((difficulty) =>
      peaks.has(cacheKey(baseline, difficulty, seed)),
    )
  )
    return Promise.resolve();
  const task = preparation.then(async () => {
    if (!getScenarioLocation(baseline))
      throw new Error("The scenario has no playable location.");
    const { createScenarioStartingPeakWorker } =
      await import("./ScenarioStartingPeakClient");
    const values = await new Promise<Record<DifficultyType, number>>(
      (resolve, reject) => {
        const worker = createScenarioStartingPeakWorker();
        let settled = false;
        const close = () => {
          if (settled) return false;
          settled = true;
          clearTimeout(watchdog);
          worker.terminate();
          return true;
        };
        const fail = (error: unknown) => {
          if (close()) reject(error);
        };
        const watchdog = setTimeout(
          () =>
            fail(
              new Error(
                "Scenario preparation timed out. Check the connection and retry.",
              ),
            ),
          60000,
        );
        worker.onmessage = ({
          data,
        }: MessageEvent<ScenarioStartingPeakResponse>) => {
          if ("error" in data) fail(new Error(data.error));
          else if (
            !DIFFICULTY_IDS.every(
              (difficulty) =>
                Number.isFinite(data.peaks?.[difficulty]) &&
                data.peaks[difficulty] > 0,
            )
          )
            fail(
              new Error(
                "The scenario's starting peak could not be calculated.",
              ),
            );
          else if (close()) resolve(data.peaks);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          fail(
            new Error(
              event.message || "The scenario's data could not be prepared.",
            ),
          );
        };
        try {
          worker.postMessage({ scenario: baseline });
        } catch (error) {
          fail(error);
        }
      },
    );
    for (const difficulty of DIFFICULTY_IDS)
      peaks.set(cacheKey(baseline, difficulty, seed), values[difficulty]);
  });
  preparation = task.catch(() => undefined);
  const pendingTask = task.finally(() => preparing.delete(key));
  preparing.set(key, pendingTask);
  return pendingTask;
}
