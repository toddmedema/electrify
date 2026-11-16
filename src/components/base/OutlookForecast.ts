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
  TerritoryId,
  TerritoryTileId,
  TickPresentFutureType,
} from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { forecastShortfalls } from "../../helpers/ForecastShortfalls";
import { monthMinute } from "../../helpers/Projection";
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

interface BuildImpactPeriod {
  startMinute: number;
  monthlyMarginW: Array<number | null>;
  unservedWh: number | null;
}
export interface BuildImpactForecast {
  months: number[];
  before: BuildImpactPeriod;
  after: BuildImpactPeriod;
}

function sampledBuildImpact(
  timeline: readonly TickPresentFutureType[],
  step: number,
  start: number,
  end: number,
): { marginW: number | null; unservedWh: number | null } {
  let covered = 0;
  let marginW = Infinity;
  let unservedWh = 0;
  for (const tick of timeline) {
    const minutes =
      Math.min(end, tick.minute + step) - Math.max(start, tick.minute);
    if (minutes <= 0) continue;
    covered += minutes;
    marginW = Math.min(marginW, tick.reserveW ?? tick.supplyW - tick.demandW);
    unservedWh += forecastShortfalls([tick], minutes, 0).blackoutTotalWh;
  }
  return covered === end - start
    ? { marginW, unservedWh }
    : { marginW: null, unservedWh: null };
}

function buildImpactPeriod(
  game: GameType,
  forecast: TickPresentFutureType[],
  startMinute: number,
): BuildImpactPeriod {
  const end = startMinute + 12 * MINUTES_PER_MONTH;
  const recorded = game.timeline.filter(
    (tick) => tick.minute < game.date.minute,
  );
  const history = new Map(
    game.monthlyHistory.map((month) => [
      monthMinute(month, game.startingYear),
      month,
    ]),
  );
  const monthlyMarginW: Array<number | null> = [];
  let unservedWh: number | null = 0;
  for (
    let month = Math.floor(startMinute / MINUTES_PER_MONTH) * MINUTES_PER_MONTH;
    month < end;
    month += MINUTES_PER_MONTH
  ) {
    const start = Math.max(startMinute, month);
    const finish = Math.min(end, month + MINUTES_PER_MONTH);
    const parts: Array<{ marginW: number | null; unservedWh: number | null }> =
      [];
    const pastEnd = Math.min(finish, game.date.minute);
    if (start < pastEnd) {
      let past = sampledBuildImpact(recorded, TICK_MINUTES, start, pastEnd);
      const saved = history.get(month);
      // Compact history retains exact extrema and energy for complete calendar months only.
      if (
        past.marginW === null &&
        saved &&
        start === month &&
        pastEnd === month + MINUTES_PER_MONTH
      ) {
        past = {
          marginW: saved.minimumSupplyMarginW ?? null,
          unservedWh: Math.max(0, saved.demandWh - saved.supplyWh),
        };
      }
      parts.push(past);
    }
    const futureStart = Math.max(start, game.date.minute);
    if (futureStart < finish)
      parts.push(sampledBuildImpact(forecast, 60, futureStart, finish));
    const margins = parts.flatMap((part) =>
      part.marginW === null ? [] : [part.marginW],
    );
    monthlyMarginW.push(
      margins.length === parts.length ? Math.min(...margins) : null,
    );
    for (const part of parts) {
      unservedWh =
        unservedWh === null || part.unservedWh === null
          ? null
          : unservedWh + part.unservedWh;
    }
  }
  return { startMinute, monthlyMarginW, unservedWh };
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
  territoryId?: TerritoryId;
  tileId?: TerritoryTileId;
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
  territoryId?: TerritoryId,
  tileId?: TerritoryTileId,
): OutlookResults[K] {
  const now = currentTick(game);
  if (!now) return undefined;
  if (kind === "buildImpact") {
    if (!facility) return undefined;
    const { before, after, commissionedMinute } = previewFacilityBuild(
      game,
      facility,
      territoryId,
      tileId,
    );
    const beforePeriod = buildImpactPeriod(
      game,
      before,
      commissionedMinute - 12 * MINUTES_PER_MONTH,
    );
    const afterPeriod = buildImpactPeriod(game, after, commissionedMinute);
    return {
      months: afterPeriod.monthlyMarginW.map((_, index) =>
        Math.max(
          0,
          Math.floor(commissionedMinute / MINUTES_PER_MONTH) +
            index -
            commissionedMinute / MINUTES_PER_MONTH,
        ),
      ),
      before: beforePeriod,
      after: afterPeriod,
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
