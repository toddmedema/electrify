import { hasEconomy } from "../data/Economy";
import { hasFuelPrices } from "../data/FuelPrices";
import { CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { hasWeather, selectWeatherLocation } from "../data/Weather";
import type { DifficultyType, ScenarioType } from "../Types";
import { forecastCustomGameTimeline } from "./CustomGameForecast";
import { getScenarioLocation } from "./Locations";

export type ScenarioStartingPeakResponse =
  { peaks: Record<DifficultyType, number> } | { error: string };

/** Baseline grid only: future rules and permanent additions must not size themselves. */
export function baselineScenario(scenario: ScenarioType): ScenarioType {
  const baseline: ScenarioType = JSON.parse(JSON.stringify(scenario));
  baseline.id = CUSTOM_SCENARIO_ID;
  delete baseline.mod;
  delete baseline.rules;
  delete baseline.eventScenarioIds;
  baseline.loadAdditions = baseline.loadAdditions?.filter(
    (load) =>
      load.startsYear < baseline.startingYear ||
      (load.startsYear === baseline.startingYear &&
        (load.startsMonth ?? 1) === 1),
  );
  return baseline;
}

export function dataReady(scenario: ScenarioType): boolean {
  const location = getScenarioLocation(scenario);
  return !!location && hasWeather(location) && hasEconomy() && hasFuelPrices();
}

/** Worker-safe calculation through the production first-year forecast. */
export function calculateScenarioStartingPeak(
  scenario: ScenarioType,
  difficulty: DifficultyType,
  seed: number,
): number | undefined {
  const baseline = baselineScenario(scenario);
  if (!dataReady(baseline)) return undefined;
  selectWeatherLocation(getScenarioLocation(baseline)!.id);
  const timeline = forecastCustomGameTimeline(baseline, difficulty, seed);
  const peakW = timeline.reduce(
    (peak, tick) => Math.max(peak, tick.demandW),
    0,
  );
  if (!Number.isFinite(peakW) || peakW <= 0) return undefined;
  return peakW;
}
