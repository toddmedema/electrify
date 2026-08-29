import { TickPresentFutureType } from "../Types";

interface KeepCommittedOptions {
  facilityId: number;
  forecast: TickPresentFutureType[];
  fromIndex: number;
  startCost: number;
  minimumOperatingCost: (tick: TickPresentFutureType) => number;
}

/**
 * Whether an otherwise-idle generator should remain committed until its next forecasted use.
 *
 * Staying online only wins if the plant is requested again before minimum-load running costs
 * reach the next-start charge. Once that threshold is crossed, the exact next-use time cannot
 * change the decision, so the scan stops immediately instead of walking the rest of the horizon.
 */
export function shouldKeepGeneratorCommitted({
  facilityId,
  forecast,
  fromIndex,
  startCost,
  minimumOperatingCost,
}: KeepCommittedOptions): boolean {
  if (startCost <= 0) {
    return false;
  }

  let runningCost = 0;
  for (let i = fromIndex + 1; i < forecast.length; i++) {
    const dispatchTarget = forecast[i].dispatchTargetWByFacility?.[facilityId];
    if (dispatchTarget === undefined) {
      continue;
    }
    if (dispatchTarget > 0) {
      return true;
    }
    runningCost += minimumOperatingCost(forecast[i]);
    if (runningCost >= startCost) {
      return false;
    }
  }

  // No forecasted need means there is no avoided start inside the known horizon.
  return false;
}
