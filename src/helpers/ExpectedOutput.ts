import { HOURS_PER_YEAR_REAL } from "../Constants";
import { GeneratorShoppingType, TickPresentFutureType } from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";
import {
  getAirborneWindCapacityFactor,
  getOffshoreWindCapacityFactor,
  getSolarCapacityFactor,
  getWindCapacityFactor,
} from "./Energy";

/**
 * How much of a generator's nameplate the weather allows, month by month. The Forecasts chart and
 * the build cards both read it from here so the two can never tell the player different stories.
 */

type OutputTechnology = Pick<
  GeneratorShoppingType,
  "name" | "fuel" | "peakW" | "hydroWhPerMm"
>;

export interface RenewableCapacityFactorPoint {
  minute: number;
  factors: Record<string, number>;
}

export type ExpectedOutputKind = "weather" | "water-inflow" | "on-demand";

export interface ExpectedOutputShape {
  kind: ExpectedOutputKind;
  monthly: number[]; // 12 values, Jan..Dec, 0..1 of nameplate (empty for on-demand)
  mean: number;
  lowMonth: number; // 0..11
}

const WEATHER_FUELS = new Set([
  "Sun",
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
]);

export function technologyCapacityFactor(
  technology: OutputTechnology,
  ticks: TickPresentFutureType[],
): number {
  if (
    ticks.every(
      (tick) => tick.renewableCapacityFactors?.[technology.name] !== undefined,
    )
  ) {
    return (
      ticks.reduce(
        (sum, tick) => sum + tick.renewableCapacityFactors![technology.name],
        0,
      ) / ticks.length
    );
  }
  switch (technology.name) {
    case "Wind":
      return getWindCapacityFactor(ticks.map((tick) => tick.windKph));
    case "Offshore Wind":
      return getOffshoreWindCapacityFactor(
        ticks.flatMap((tick) =>
          tick.windOffshoreKph === undefined ? [] : [tick.windOffshoreKph],
        ),
      );
    case "Airborne Wind":
      return getAirborneWindCapacityFactor(
        ticks.map((tick) => tick.windAirborneKph),
      );
    case "Solar":
      return getSolarCapacityFactor(
        ticks.map((tick) => tick.solarIrradianceWM2),
      );
    case "Hydro": {
      // Water flowing into the reservoir rather than what the turbines deliver: the reservoir
      // smooths the inflow and the player decides when to release it
      const runoffMm =
        ticks.reduce((total, tick) => total + tick.hydroRunoffMm, 0) /
        ticks.length;
      const monthlyPotentialWh = (technology.hydroWhPerMm || 0) * runoffMm;
      return Math.min(
        1,
        monthlyPotentialWh / (technology.peakW * (HOURS_PER_YEAR_REAL / 12)),
      );
    }
    default:
      return 0;
  }
}

function groupTicks(
  timeline: TickPresentFutureType[],
  keyOf: (month: number) => number,
): Map<number, TickPresentFutureType[]> {
  const groups = new Map<number, TickPresentFutureType[]>();
  timeline.forEach((tick) => {
    const key = keyOf(Math.floor(tick.minute / MINUTES_PER_MONTH));
    const ticks = groups.get(key) || [];
    ticks.push(tick);
    groups.set(key, ticks);
  });
  return groups;
}

export function monthlyRenewableCapacityFactors(
  timeline: TickPresentFutureType[],
  technologies: OutputTechnology[],
): RenewableCapacityFactorPoint[] {
  return Array.from(groupTicks(timeline, (month) => month).values()).map(
    (ticks) => ({
      minute: Math.round(
        (ticks[0].minute + ticks[ticks.length - 1].minute) / 2,
      ),
      factors: Object.fromEntries(
        technologies.map((technology) => [
          technology.name,
          technologyCapacityFactor(technology, ticks),
        ]),
      ),
    }),
  );
}

export function expectedOutputKind(fuel: string): ExpectedOutputKind {
  if (WEATHER_FUELS.has(fuel)) {
    return "weather";
  }
  return fuel === "Hydro" ? "water-inflow" : "on-demand";
}

/**
 * A typical calendar year, January to December, with each month averaged over every forecast year
 * that contains it. The game simulates one day per month, so a single year would mostly show
 * weather luck. Undefined until the forecast covers all twelve months, e.g. before weather loads.
 */
export function expectedMonthlyOutputShape(
  technology: OutputTechnology,
  timeline: TickPresentFutureType[],
): ExpectedOutputShape | undefined {
  const kind = expectedOutputKind(technology.fuel);
  if (kind === "on-demand") {
    return { kind, monthly: [], mean: 1, lowMonth: 0 };
  }
  const calendarMonths = groupTicks(timeline, (month) => month % 12);
  if (calendarMonths.size < 12) {
    return undefined;
  }
  const monthly = Array.from({ length: 12 }, (_, month) =>
    technologyCapacityFactor(technology, calendarMonths.get(month)!),
  );
  const lowMonth = monthly.reduce(
    (low, value, month) => (value < monthly[low] ? month : low),
    0,
  );
  const mean = monthly.reduce((total, value) => total + value, 0) / 12;
  return { kind, monthly, mean, lowMonth };
}
