import { TickPresentFutureType } from "../Types";

interface ForecastMetadata {
  dispatchTargets: Record<number, number>;
  runningCostToNextDispatch: Record<number, number>;
}

// Forecast-only data must not be serialized into saves, copied into chart rows, or walked by
// Redux Toolkit's development checks. A non-enumerable symbol keeps it beside the tick whose
// index it describes while remaining invisible to JSON.stringify/Object.entries/object spread.
const FORECAST_METADATA = Symbol("forecastMetadata");

type ForecastTick = TickPresentFutureType & {
  [FORECAST_METADATA]?: ForecastMetadata;
};

function metadata(
  tick: TickPresentFutureType,
  create = false,
): ForecastMetadata | undefined {
  const forecastTick = tick as ForecastTick;
  if (!forecastTick[FORECAST_METADATA] && create) {
    Object.defineProperty(forecastTick, FORECAST_METADATA, {
      configurable: true,
      enumerable: false,
      value: {
        dispatchTargets: {},
        runningCostToNextDispatch: {},
      },
      writable: true,
    });
  }
  return forecastTick[FORECAST_METADATA];
}

export function hasPreparedGeneratorCommitment(
  tick: TickPresentFutureType | null | undefined,
  facilityId: number,
): boolean {
  return (
    tick != null &&
    metadata(tick)?.runningCostToNextDispatch[facilityId] !== undefined
  );
}

export function recordDispatchTarget(
  tick: TickPresentFutureType,
  facilityId: number,
  targetW: number,
) {
  metadata(tick, true)!.dispatchTargets[facilityId] = targetW;
}

function dispatchTarget(
  tick: TickPresentFutureType,
  facilityId: number,
): number | undefined {
  return metadata(tick)?.dispatchTargets[facilityId];
}

/** Copies transient metadata when a forecast pass clones a tick with object spread. */
export function copyCommitmentMetadata(
  source: TickPresentFutureType,
  destination: TickPresentFutureType,
) {
  const sourceMetadata = metadata(source);
  if (!sourceMetadata) {
    return;
  }
  Object.defineProperty(destination as ForecastTick, FORECAST_METADATA, {
    configurable: true,
    enumerable: false,
    value: sourceMetadata,
    writable: true,
  });
}

interface PrepareCommitmentOptions {
  facilityId: number;
  forecast: TickPresentFutureType[];
  minimumOperatingCost: (tick: TickPresentFutureType) => number;
}

/**
 * Precomputes the minimum-load cost before the next requested dispatch in one backward pass.
 * Every later commitment decision is then O(1), instead of scanning the same future ticks again.
 */
export function prepareGeneratorCommitment({
  facilityId,
  forecast,
  minimumOperatingCost,
}: PrepareCommitmentOptions) {
  let runningCostToNextDispatch = Infinity;
  for (let i = forecast.length - 1; i >= 0; i--) {
    metadata(forecast[i], true)!.runningCostToNextDispatch[facilityId] =
      runningCostToNextDispatch;
    const targetW = dispatchTarget(forecast[i], facilityId);
    if (targetW === undefined) {
      continue;
    }
    if (targetW > 0) {
      runningCostToNextDispatch = 0;
    } else if (Number.isFinite(runningCostToNextDispatch)) {
      runningCostToNextDispatch += minimumOperatingCost(forecast[i]);
    }
  }
}

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

  const preparedCost = metadata(forecast[fromIndex])?.runningCostToNextDispatch[
    facilityId
  ];
  if (preparedCost !== undefined) {
    return preparedCost < startCost;
  }

  let runningCost = 0;
  for (let i = fromIndex + 1; i < forecast.length; i++) {
    const targetW = dispatchTarget(forecast[i], facilityId);
    if (targetW === undefined) {
      continue;
    }
    if (targetW > 0) {
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
