import { TickPresentFutureType } from "../Types";

interface ForecastMetadata {
  dispatchTargets: Record<number, number>;
  runningCostToNextDispatch: Record<number, number>;
}

// Forecast-only data must not be copied into chart rows or walked by Redux Toolkit's development
// checks. A non-enumerable symbol keeps it beside the tick whose index it describes while remaining
// invisible to JSON.stringify/Object.entries/object spread; saves carry it separately, through
// serializeCommitmentMetadata below.
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

/**
 * The commitment forecast in a JSON-safe form, one entry per timeline tick (null where a tick
 * carries none). JSON has no Infinity, so "no future dispatch" is written as null.
 */
export type SavedCommitmentMetadata = {
  dispatchTargets: Record<string, number>;
  runningCostToNextDispatch: Record<string, number | null>;
} | null;

/**
 * A save has to carry the forecast the live run is steering by. Rebuilding it after a reload
 * would forecast from the fleet as it stands at the save rather than as it stood when the
 * forecast was made, and the two can keep or release a plant differently.
 */
export function serializeCommitmentMetadata(
  timeline: TickPresentFutureType[],
): SavedCommitmentMetadata[] | undefined {
  if (!timeline.some((tick) => metadata(tick))) {
    return undefined;
  }
  return timeline.map((tick) => {
    const current = metadata(tick);
    if (!current) {
      return null;
    }
    const runningCostToNextDispatch: Record<string, number | null> = {};
    Object.entries(current.runningCostToNextDispatch).forEach(([id, cost]) => {
      runningCostToNextDispatch[id] = Number.isFinite(cost) ? cost : null;
    });
    return {
      dispatchTargets: { ...current.dispatchTargets },
      runningCostToNextDispatch,
    };
  });
}

function validRecord(
  raw: unknown,
  allowNull: boolean,
): raw is Record<string, number | null> {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.entries(raw).every(
      ([id, value]) =>
        /^[1-9][0-9]*$/.test(id) &&
        ((allowNull && value === null) ||
          (typeof value === "number" && Number.isFinite(value) && value >= 0)),
    )
  );
}

export function validCommitmentMetadata(
  raw: unknown,
  ticks: number,
): raw is SavedCommitmentMetadata[] {
  return (
    Array.isArray(raw) &&
    raw.length === ticks &&
    raw.every(
      (entry) =>
        entry === null ||
        (typeof entry === "object" &&
          validRecord(entry.dispatchTargets, false) &&
          validRecord(entry.runningCostToNextDispatch, true)),
    )
  );
}

/** Reattaches a saved forecast to the (plain, never-drafted) ticks it was saved from. */
export function restoreCommitmentMetadata(
  timeline: TickPresentFutureType[],
  saved: SavedCommitmentMetadata[],
) {
  timeline.forEach((tick, i) => {
    const entry = saved[i];
    if (!entry) {
      return;
    }
    const restored = metadata(tick, true)!;
    Object.entries(entry.dispatchTargets).forEach(([id, targetW]) => {
      restored.dispatchTargets[Number(id)] = targetW;
    });
    Object.entries(entry.runningCostToNextDispatch).forEach(([id, cost]) => {
      restored.runningCostToNextDispatch[Number(id)] = cost ?? Infinity;
    });
  });
}
