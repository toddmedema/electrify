import { HYDRO_SITES } from "../data/HydroSites";
import { ScenarioFacilityType, ScenarioType } from "../Types";
import { TickPresentFutureType } from "../Types";
import { summarizeYearOneOutlook } from "./CustomGameForecast";

/** A model allowance, not a claim about a utility's contracted reserve margin. */
export const SUPPLY_MARGIN = 0.05;

/**
 * Finds the smallest opening fleet, in the real weather and dispatch model, that serves every
 * hour of the first year with a little reserve to spare. Every plant in the regional blend is
 * scaled by one common factor, which keeps its generation mix; hydro stays within its physical
 * sites. If scaling alone cannot reach the demand (regional imports and sites that are not
 * playable), the missing firm supply is added explicitly as one named plant, rather than
 * inventing generation the location cannot build.
 *
 * Runs only after simulation data is loaded, normally inside a worker. The scenario carries the
 * demand to serve, so it must already exclude loads that arrive later.
 */
export function sizeStartingFleet(
  scenario: ScenarioType,
  forecast: (scenario: ScenarioType) => readonly TickPresentFutureType[],
  /** The firm plant that makes up a shortfall nothing in the blend can cover. */
  reservePlant: (shortfallW: number) => ScenarioFacilityType,
): ScenarioFacilityType[] {
  const baseFacilities = [...scenario.facilities];
  const sized = (factor: number): ScenarioType => ({
    ...scenario,
    startingDemandScale:
      (scenario.startingDemandScale || 1) * (1 + SUPPLY_MARGIN),
    facilities: baseFacilities.map((facility) => ({
      ...facility,
      peakW: Math.max(
        1,
        Math.min(
          Math.ceil((facility.peakW || 0) * factor),
          facility.hydroSiteId
            ? HYDRO_SITES[facility.hydroSiteId].maxPeakW
            : Infinity,
        ),
      ),
    })),
  });
  const shortfall = (candidate: ScenarioType) =>
    summarizeYearOneOutlook(forecast(candidate)).worstShortfallW;
  let low = 0;
  let high = 1;
  let candidate = sized(high);
  for (let attempt = 0; attempt < 8; attempt++) {
    const missing = shortfall(candidate);
    if (missing === 0) break;
    low = high;
    high *= 2;
    if (attempt === 3) {
      baseFacilities.push(reservePlant(missing));
      low = 0;
    }
    candidate = sized(high);
  }
  if (shortfall(candidate) > 0) {
    throw new Error(
      "We couldn't prepare a reliable starting grid for this location.",
    );
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const mid = (low + high) / 2;
    const trial = sized(mid);
    if (shortfall(trial) === 0) {
      high = mid;
      candidate = trial;
    } else low = mid;
  }
  return candidate.facilities;
}
