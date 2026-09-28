import { DIFFICULTIES } from "../Constants";
import { DifficultyType } from "../Types";

/**
 * Construction time formulas shared by the build catalog (data/Facilities) and story warnings, so
 * a warning can say how long the response it asks for will take. Kept here rather than in
 * Facilities because WorldEvents is imported by Facilities and must not import it back.
 * Magnitude is 0 at 1 MW (or MWh) and rises by one for each tenfold size.
 */
export const sizeMagnitude = (size: number): number => Math.log10(size) - 6;

export const naturalGasYearsToBuild = (peakW: number): number =>
  2.46 + sizeMagnitude(peakW) / 3;

export const batteryYearsToBuild = (peakWh: number): number =>
  0.57 + sizeMagnitude(peakWh) / 3;

/** The reference responses story warnings quote: a 300 MW gas plant and a 600 MWh battery. */
export const REFERENCE_GAS_PEAK_W = 300_000_000;
export const REFERENCE_BATTERY_PEAK_WH = 600_000_000;

export function referenceBuildMonths(difficulty: DifficultyType): {
  gas: number;
  battery: number;
} {
  const scale = DIFFICULTIES[difficulty].buildTime * 12;
  return {
    gas: Math.ceil(naturalGasYearsToBuild(REFERENCE_GAS_PEAK_W) * scale),
    battery: Math.ceil(batteryYearsToBuild(REFERENCE_BATTERY_PEAK_WH) * scale),
  };
}

/** One sentence for a warning, so the player can judge whether building is still in time. */
export function buildLeadTimeHint(difficulty: DifficultyType): string {
  const { gas, battery } = referenceBuildMonths(difficulty);
  return `At this difficulty a 300 MW gas plant takes about ${gas} months to build and a 600 MWh battery about ${battery}.`;
}
