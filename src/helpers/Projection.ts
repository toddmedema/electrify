import { GAME_TO_REAL_YEARS, TICK_MINUTES, TICKS_PER_YEAR } from "../Constants";
import {
  MINUTES_PER_MONTH,
  summarizeTimeline,
  summarizeTimelineByMonth,
} from "./DateTime";
import { forecastShortfalls } from "./ForecastShortfalls";
import { sampleForecastTimeline } from "./ForecastSampling";
import { generateNewTimeline } from "../reducers/Game";
import { GameType, MonthlyHistoryType, TickPresentFutureType } from "../Types";

/**
 * The one long-range projection a game has.
 *
 * Insights builds it for its charts, and MissionStatus reads its projected cash for the runway
 * warning. Both callers want the same forecast of the same game, so it lives here once and is
 * memoized on everything that can actually change it, instead of each component running its own
 * copy of a twenty-year simulation.
 */

const MAX_FORECAST_YEARS = 20;
const HOURS_PER_RECORDED_MONTH = 24 * GAME_TO_REAL_YEARS;

/** The full span the forecast charts can be scrolled through, in game minutes. */
export function forecastViewportBounds(game: GameType): [number, number] {
  return [0, game.date.minute + MAX_FORECAST_YEARS * 12 * MINUTES_PER_MONTH];
}

export interface ProjectionView {
  timeline: TickPresentFutureType[];
  sampled: TickPresentFutureType[];
  supplyDemandTimeline: TickPresentFutureType[];
  domain: { x: [number, number]; y: [number, number] };
  blackouts: BlackoutEdges[];
  // The simulated hours alone; supplyDemandTimeline leads with recorded monthly averages.
  forecast: TickPresentFutureType[];
  // Forecast shortfall inside the displayed range, filled in per render for the viewport.
  shortfall?: { wh: number; peakW: number; label: string };
  hasStorage: boolean;
  hasHydro: boolean;
  financePast: MonthlyHistoryType[];
  financeProjected: MonthlyHistoryType[];
  projectionStepMinutes: number;
  // What the simulation started from; callers that anchor on live balances diff against these
  startingCash: number;
  startingCustomers: number;
}

interface BlackoutEdges {
  minute: number;
  value: number;
}

export function monthMinute(
  month: MonthlyHistoryType,
  startingYear: number,
): number {
  return (
    ((month.year - startingYear) * 12 + month.month - 1) * MINUTES_PER_MONTH
  );
}

export function policySignature(game: GameType): string {
  const policies = game.policies;
  if (!policies) return "";
  return JSON.stringify([
    policies.month,
    ...Object.keys(policies.programs)
      .sort()
      .map((id) => {
        const program = policies.programs[id as keyof typeof policies.programs];
        return [
          id,
          program.tier,
          program.adoption,
          program.spending,
          program.pending?.tier,
          program.startHour,
          program.pending?.startHour,
          program.pending?.month,
        ];
      }),
  ]);
}

// Construction progress is deliberately reduced to built or not. The remaining years tick down
// every game tick, and keying on them re-simulated the whole projection each frame from a start
// minute that had moved on by one tick, so the hourly-sampled forecast (wind most of all) jittered
// under the player. The month rollover already refreshes progress; completion refreshes it too.
export function facilitySignature(game: GameType): string {
  const facilities = game.facilities
    .map((facility) =>
      [
        facility.id,
        facility.paused,
        facility.yearsToBuildLeft > 0,
        facility.peakW,
      ].join(":"),
    )
    .join("|");
  const transmission = (game.transmission?.lines || [])
    .map((line) =>
      [line.id, line.corridorId, line.yearsToBuildLeft > 0].join(":"),
    )
    .join("|");
  return `${facilities}/${game.transmission?.tradingPolicy || "BALANCED"}/${transmission}`;
}

/**
 * Everything that can move the projection, and nothing that cannot.
 *
 * The run identity (scenario, year, seed) keeps two different games from ever sharing an entry:
 * a fresh game and a long one can agree on every monthly fact and still price weather and fuel
 * differently. Within a run, the rest of the key changes only on a month rollover or a
 * player-visible decision, which is what a rebuild is worth.
 */
export function projectionSignature(game: GameType): string {
  return [
    game.scenarioId,
    game.startingYear,
    game.seed,
    game.customScenario ? JSON.stringify(game.customScenario) : "",
    game.date.monthsElapsed,
    game.monthlyHistory.length,
    game.dollarsPerkWh,
    game.feePerKgCO2e,
    facilitySignature(game),
    policySignature(game),
  ].join("|");
}

function buildProjection(
  game: GameType,
  now: TickPresentFutureType,
): ProjectionView {
  const projectionStepMinutes = 60;
  const tickScale = projectionStepMinutes / TICK_MINUTES;
  const ticks = (TICKS_PER_YEAR * MAX_FORECAST_YEARS) / tickScale;
  const monthsAhead = MAX_FORECAST_YEARS * 12;

  const timeline = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    ticks,
    projectionStepMinutes,
  );
  const historicalSupplyDemand = [...game.monthlyHistory]
    .reverse()
    .map((month) => {
      const tick = { ...now } as TickPresentFutureType;
      tick.minute = monthMinute(month, game.startingYear);
      tick.supplyW = month.supplyWh / HOURS_PER_RECORDED_MONTH;
      tick.demandW = month.demandWh / HOURS_PER_RECORDED_MONTH;
      return tick;
    });
  const historicalCharts = [...game.monthlyHistory]
    .reverse()
    .flatMap((month) =>
      month.chartAverage
        ? [
            {
              ...month.chartAverage,
              minute: monthMinute(month, game.startingYear),
            } as TickPresentFutureType,
          ]
        : [],
    );
  let domainMin = Number.POSITIVE_INFINITY;
  let domainMax = 0;
  for (const tick of [...historicalSupplyDemand, ...timeline]) {
    domainMin = Math.min(domainMin, tick.supplyW, tick.demandW);
    domainMax = Math.max(domainMax, tick.supplyW, tick.demandW);
  }
  const [rangeMin, rangeMax] = forecastViewportBounds(game);

  const { blackouts } = forecastShortfalls(
    timeline,
    projectionStepMinutes,
    domainMax,
  );
  blackouts.unshift({ minute: rangeMin, value: 0 });
  const sampled = sampleForecastTimeline(
    timeline,
    240 * MAX_FORECAST_YEARS,
    projectionStepMinutes,
  );

  const currentMonth = summarizeTimeline(game.timeline, game.startingYear);
  const projectedMonths = summarizeTimelineByMonth(
    timeline,
    game.startingYear,
  ).slice(1, 1 + monthsAhead);
  return {
    timeline: [...historicalCharts, ...timeline],
    sampled: [...historicalCharts, ...sampled],
    supplyDemandTimeline: [...historicalSupplyDemand, ...timeline],
    domain: { x: [rangeMin, rangeMax], y: [domainMin, domainMax] },
    blackouts,
    forecast: timeline,
    hasStorage: [...historicalCharts, ...timeline].some(
      (tick) => tick.storedWh > 0,
    ),
    hasHydro:
      game.facilities.some((facility) => facility.fuel === "Hydro") ||
      historicalCharts.some((tick) => tick.hydroReservoirCapacityWh > 0),
    financePast: game.monthlyHistory,
    financeProjected: [currentMonth, ...projectedMonths],
    projectionStepMinutes,
    startingCash: now.cash,
    startingCustomers: now.customers,
  };
}

// One entry is enough: a game has one game. Whichever caller asks last wins, and the key keeps
// it honest, so the top bar and the Insights pane agree on the same numbers without one of them
// paying for a rebuild the other just paid for.
let cachedProjection: { key: string; projection: ProjectionView } | undefined;

/**
 * The game's long-range projection, memoized on the inputs that can change it.
 *
 * Callers render on every tick, and only a month rollover or a player decision changes the key,
 * so most calls are a string comparison; the expensive simulation runs at most once per such
 * change, and the next caller reuses the result.
 */
export function selectProjection(
  game: GameType,
  now: TickPresentFutureType,
): ProjectionView {
  const key = projectionSignature(game);
  if (cachedProjection?.key === key) {
    return cachedProjection.projection;
  }
  const projection = buildProjection(game, now);
  cachedProjection = { key, projection };
  return projection;
}
