import { TICK_MINUTES, TICKS_PER_YEAR } from "../../Constants";
import { currentTick } from "../../helpers/GameSelectors";
import {
  reservoirOutlook,
  ReservoirOutlookPoint,
} from "../../helpers/HydroOutlook";
import { generateNewTimeline } from "../../reducers/Game";
import type { GameType, TickPresentFutureType } from "../../Types";

/** Weather, load and route restrictions needed by the neighboring market outlook. */
export type IntertieForecastTick = Pick<
  TickPresentFutureType,
  | "minute"
  | "demandW"
  | "temperatureC"
  | "solarIrradianceWM2"
  | "transmissionCapacityLimitsWByCorridor"
>;

/** Within an hourly forecast, moving the live clock only changes the outlook at this boundary. */
export function forecastCutoffIndex(
  timeline: readonly IntertieForecastTick[],
  minute: number,
): number {
  let first = 0;
  let last = timeline.length;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (timeline[middle].minute < minute) first = middle + 1;
    else last = middle;
  }
  return first;
}

export interface OutlookResults {
  hydro: ReservoirOutlookPoint[] | undefined;
  intertie: IntertieForecastTick[] | undefined;
}
export type OutlookKind = keyof OutlookResults;
export interface OutlookRequest {
  requestId: number;
  kind: OutlookKind;
  game: GameType;
}
export type OutlookReply = {
  requestId: number;
  result?: OutlookResults[OutlookKind];
  error?: boolean;
};

export function computeOutlook<K extends OutlookKind>(
  kind: K,
  game: GameType,
): OutlookResults[K] {
  const now = currentTick(game);
  if (!now) return undefined;
  if (kind === "hydro") {
    return reservoirOutlook(
      now,
      generateNewTimeline(game, now.cash, now.customers, TICKS_PER_YEAR),
      game.startingYear,
    ) as OutlookResults[K];
  }
  const hourly = generateNewTimeline(
    {
      ...game,
      facilities: game.facilities.filter((f) => f.yearsToBuildLeft <= 0),
      transmission: {
        tradingPolicy: game.transmission?.tradingPolicy || "BALANCED",
        lines: (game.transmission?.lines || [])
          .filter((l) => l.yearsToBuildLeft <= 0)
          .map((l) => ({ ...l, upgrade: undefined })),
      },
    },
    now.cash,
    now.customers,
    (TICKS_PER_YEAR * 2 * TICK_MINUTES) / 60,
    60,
  );
  // Return hundreds of four-number readings rather than thousands of economic properties.
  return hourly.map(
    ({
      minute,
      demandW,
      temperatureC,
      solarIrradianceWM2,
      transmissionCapacityLimitsWByCorridor,
    }) => ({
      minute,
      demandW,
      temperatureC,
      solarIrradianceWM2,
      ...(transmissionCapacityLimitsWByCorridor
        ? { transmissionCapacityLimitsWByCorridor }
        : {}),
    }),
  ) as OutlookResults[K];
}
