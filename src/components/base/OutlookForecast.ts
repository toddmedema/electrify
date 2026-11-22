import {
  GAME_TO_REAL_YEARS,
  MONTHS,
  TICK_MINUTES,
  TICKS_PER_DAY,
  TICKS_PER_YEAR,
} from "../../Constants";
import { currentTick } from "../../helpers/GameSelectors";
import {
  reservoirOutlook,
  ReservoirOutlookPoint,
} from "../../helpers/HydroOutlook";
import {
  generateForecastTimeline,
  generateResourceForecast,
  previewCoalRepowerImpact,
  previewFacilityBuild,
} from "../../reducers/Game";
import type {
  CoalRepowerType,
  FacilityShoppingType,
  GameType,
  TerritoryId,
  TerritoryTileId,
  TickPresentFutureType,
} from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { wrapIndex } from "../../helpers/Math";
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
  averageDayW: Array<number | null>;
  averageDayByMonthW: Array<Array<number | null>>;
}
export interface BuildImpactForecast {
  months: number[];
  estimatedHistory: boolean;
  before: BuildImpactPeriod;
  after: BuildImpactPeriod;
}

const supplyMargin = (tick: TickPresentFutureType) =>
  tick.reserveW ?? tick.supplyW - tick.demandW;

/** Reconstruct the absent detail using the fleet and load known when opening the review. */
function estimateBuildHistory(
  game: GameType,
  now: TickPresentFutureType,
  start: number,
  end: number,
) {
  if (start >= end) return [];
  return generateForecastTimeline(
    {
      ...game,
      date: getDateFromMinute(start, game.startingYear),
      transmission: game.transmission && {
        ...game.transmission,
        // The live ledger is already settled beyond this private forecast's cutoff.
        agreementAccounts: undefined,
      },
      facilities: game.facilities.flatMap((facility) => {
        const opening = facility.minuteOperational ?? facility.minuteCreated;
        if (facility.yearsToBuildLeft > 0) return [];
        // Existing opening assets also serve the estimated pregame period.
        if (opening <= Math.max(0, start)) return [facility];
        if (opening >= end) return [];
        return [
          {
            ...facility,
            currentW: 0,
            yearsToBuildLeft:
              (opening - start) / (TICKS_PER_YEAR * TICK_MINUTES),
          },
        ];
      }),
    },
    now.cash,
    now.customers,
    (end - start) / TICK_MINUTES,
  );
}

function buildImpactPeriod(
  game: GameType,
  timeline: readonly TickPresentFutureType[],
  startMinute: number,
): BuildImpactPeriod {
  const end = startMinute + TICKS_PER_YEAR * TICK_MINUTES;
  const history = new Map(
    game.monthlyHistory.map((month) => [
      monthMinute(month, game.startingYear),
      month,
    ]),
  );
  const dailyTotals = new Array<number>(TICKS_PER_DAY).fill(0);
  const dailyCounts = new Array<number>(TICKS_PER_DAY).fill(0);
  const monthTotals = MONTHS.map(() =>
    new Array<number>(TICKS_PER_DAY).fill(0),
  );
  const monthCounts = MONTHS.map(() =>
    new Array<number>(TICKS_PER_DAY).fill(0),
  );
  const monthlyMarginW: Array<number | null> = [];
  let unservedWh: number | null = 0;
  let index = 0;
  for (
    let month = Math.floor(startMinute / MINUTES_PER_MONTH) * MINUTES_PER_MONTH;
    month < end;
    month += MINUTES_PER_MONTH
  ) {
    const start = Math.max(startMinute, month);
    const finish = Math.min(end, month + MINUTES_PER_MONTH);
    const calendarMonth =
      getDateFromMinute(month, game.startingYear).monthNumber - 1;
    let minimum = Infinity;
    let shortage = 0;
    while (index < timeline.length && timeline[index].minute < start) index++;
    const first = index;
    while (index < timeline.length && timeline[index].minute < finish) {
      const tick = timeline[index++];
      const slot = wrapIndex(tick.minute, 1440) / TICK_MINUTES;
      const margin = supplyMargin(tick);
      minimum = Math.min(minimum, margin);
      shortage += Math.max(0, tick.demandW - tick.supplyW);
      dailyTotals[slot] += margin;
      dailyCounts[slot]++;
      monthTotals[calendarMonth][slot] += margin;
      monthCounts[calendarMonth][slot]++;
    }
    const saved =
      start === month && finish === month + MINUTES_PER_MONTH
        ? history.get(month)
        : undefined;
    const covered = (index - first) * TICK_MINUTES === finish - start;
    monthlyMarginW.push(
      saved?.minimumSupplyMarginW ?? (covered ? minimum : null),
    );
    if (unservedWh !== null) {
      if (saved) unservedWh += Math.max(0, saved.demandWh - saved.supplyWh);
      else if (covered)
        unservedWh += shortage * (TICK_MINUTES / 60) * GAME_TO_REAL_YEARS;
      else unservedWh = null;
    }
  }
  return {
    startMinute,
    monthlyMarginW,
    unservedWh,
    averageDayW: dailyTotals.map((total, slot) =>
      dailyCounts[slot] ? total / dailyCounts[slot] : null,
    ),
    averageDayByMonthW: monthTotals.map((totals, month) =>
      totals.map((total, slot) =>
        monthCounts[month][slot] ? total / monthCounts[month][slot] : null,
      ),
    ),
  };
}

export interface CoalRepowerImpactRequest {
  facilityId: number;
  upgrade: CoalRepowerType;
}

export interface OutlookResults {
  buildImpact: BuildImpactForecast | undefined;
  coalRepowerImpact: ReturnType<typeof previewCoalRepowerImpact>;
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
  repower?: CoalRepowerImpactRequest;
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
  repower?: CoalRepowerImpactRequest,
): OutlookResults[K] {
  const now = currentTick(game);
  if (!now) return undefined;
  if (kind === "coalRepowerImpact") {
    return (repower &&
      previewCoalRepowerImpact(
        game,
        repower.facilityId,
        repower.upgrade,
      )) as OutlookResults[K];
  }
  if (kind === "buildImpact") {
    if (!facility) return undefined;
    const { before, after, commissionedMinute } = previewFacilityBuild(
      game,
      facility,
      territoryId,
      tileId,
    );
    const start = commissionedMinute - TICKS_PER_YEAR * TICK_MINUTES;
    const recorded = game.timeline.filter(
      (tick) => tick.minute >= start && tick.minute < game.date.minute,
    );
    const estimatedHistory = estimateBuildHistory(
      game,
      now,
      start,
      recorded[0]?.minute ?? game.date.minute,
    );
    const beforePeriod = buildImpactPeriod(
      game,
      [...estimatedHistory, ...recorded, ...before],
      start,
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
      estimatedHistory: estimatedHistory.length > 0,
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
