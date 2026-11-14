import { TICK_MINUTES, TICKS_PER_YEAR } from "../../Constants";
import { currentTick } from "../../helpers/GameSelectors";
import {
  reservoirOutlook,
  ReservoirOutlookPoint,
} from "../../helpers/HydroOutlook";
import {
  generateForecastTimeline,
  generateResourceForecast,
  previewFacilityBuild,
} from "../../reducers/Game";
import type {
  FacilityShoppingType,
  GameType,
  TickPresentFutureType,
} from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { forecastShortfalls } from "../../helpers/ForecastShortfalls";
import type { OutputWeatherTick } from "../../helpers/ExpectedOutput";

export interface BuildForecast {
  timeline: OutputWeatherTick[];
  windSpeeds: number[];
  offshoreWindSpeeds: number[];
  airborneWindSpeeds: number[];
  solarIrradiances: number[];
}

// Also shares synchronous fallback work across StrictMode renders and catalog remounts.
const buildForecasts = new WeakMap<GameType, BuildForecast>();

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

export interface BuildImpactForecast {
  before: { monthlyMarginW: number[]; unservedWh: number };
  after: { monthlyMarginW: number[]; unservedWh: number };
}

export interface OutlookResults {
  buildImpact: BuildImpactForecast | undefined;
  build: BuildForecast | undefined;
  hydro: ReservoirOutlookPoint[] | undefined;
  intertie: IntertieForecastTick[] | undefined;
}
export type OutlookKind = keyof OutlookResults;
export interface OutlookRequest {
  requestId: number;
  kind: OutlookKind;
  game: GameType;
  facility?: FacilityShoppingType;
}
export type OutlookReply = {
  requestId: number;
  result?: OutlookResults[OutlookKind];
  error?: boolean;
};

export function computeOutlook<K extends OutlookKind>(
  kind: K,
  game: GameType,
  facility?: FacilityShoppingType,
): OutlookResults[K] {
  const now = currentTick(game);
  if (!now) return undefined;
  if (kind === "buildImpact") {
    if (!facility) return undefined;
    const { before, after } = previewFacilityBuild(game, facility);
    const summarize = (timeline: TickPresentFutureType[]) => {
      const monthlyMarginW = Array<number>(12).fill(Infinity);
      for (const tick of timeline) {
        const month = Math.floor(
          (tick.minute - game.date.minute) / MINUTES_PER_MONTH,
        );
        monthlyMarginW[month] = Math.min(
          monthlyMarginW[month],
          tick.reserveW ?? tick.supplyW - tick.demandW,
        );
      }
      return {
        monthlyMarginW,
        unservedWh: forecastShortfalls(timeline, 60, 0).blackoutTotalWh,
      };
    };
    return {
      before: summarize(before),
      after: summarize(after),
    } as OutlookResults[K];
  }
  if (kind === "build") {
    let result = buildForecasts.get(game);
    if (!result) {
      const timeline = generateResourceForecast(game);
      result = {
        timeline,
        windSpeeds: timeline.map((tick) => tick.windKph),
        offshoreWindSpeeds: timeline.flatMap((tick) =>
          tick.windOffshoreKph === undefined ? [] : [tick.windOffshoreKph],
        ),
        airborneWindSpeeds: timeline.map((tick) => tick.windAirborneKph),
        solarIrradiances: timeline.map((tick) => tick.solarIrradianceWM2),
      };
      buildForecasts.set(game, result);
    }
    return result as OutlookResults[K];
  }
  if (kind === "hydro") {
    return reservoirOutlook(
      now,
      generateForecastTimeline(game, now.cash, now.customers, TICKS_PER_YEAR),
      game.startingYear,
    ) as OutlookResults[K];
  }
  const hourly = generateForecastTimeline(
    {
      ...game,
      facilities: game.facilities.filter((f) => f.yearsToBuildLeft <= 0),
      transmission: {
        ...game.transmission,
        acceptedAgreements: game.transmission?.acceptedAgreements?.map(
          (receipt) => ({ ...receipt }),
        ),
        buyingRule: game.transmission?.buyingRule || "SHORTAGES",
        sellingRule: game.transmission?.sellingRule || "SURPLUS",
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
