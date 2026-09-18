import { TickPresentFutureType } from "../Types";
import { MONTH_NAMES } from "../Constants";
import { getMonthYearFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { HYDRO_DEADPOOL_FRACTION, mandatedReleaseFraction } from "./Hydro";

/**
 * What a hydro plant's water is doing, phrased for the facility it belongs to rather than for the
 * watershed chart. A player looking at a dam wants the one reason its output is what it is, so the
 * status names a single cause and at most one thing to expect next.
 */

export interface ReservoirOutlookPoint {
  /** Calendar month 1-12 the point closes */
  monthNumber: number;
  /** Combined fullness of every operating dam, 0-1 */
  fraction: number;
  snowpackMm: number;
}

/**
 * Month-end reservoir levels across a forecast, preceded by the level right now. Undefined when
 * no dam is operating yet, since there is no reservoir to forecast.
 */
export function reservoirOutlook(
  now: TickPresentFutureType,
  forecast: TickPresentFutureType[],
  startingYear: number,
): ReservoirOutlookPoint[] | undefined {
  const monthOf = getMonthYearFromMinute;
  if (!(now.hydroReservoirCapacityWh > 0)) {
    return undefined;
  }
  const points: ReservoirOutlookPoint[] = [
    {
      monthNumber: monthOf(now.minute, startingYear).monthNumber,
      fraction: now.hydroReservoirWh / now.hydroReservoirCapacityWh,
      snowpackMm: now.snowpackMm,
    },
  ];
  let month: number | undefined;
  let last: TickPresentFutureType | undefined;
  const close = () => {
    if (last && last.hydroReservoirCapacityWh > 0) {
      points.push({
        monthNumber: monthOf(last.minute, startingYear).monthNumber,
        fraction: last.hydroReservoirWh / last.hydroReservoirCapacityWh,
        snowpackMm: last.snowpackMm,
      });
    }
  };
  forecast.forEach((tick) => {
    const tickMonth = Math.floor(tick.minute / MINUTES_PER_MONTH);
    if (month !== undefined && tickMonth !== month) {
      close();
    }
    month = tickMonth;
    last = tick;
  });
  close();
  return points;
}

export interface HydroStatus {
  /** A short verdict, the only part that carries the tone colour */
  lead: string;
  /** What it means, in the ordinary text colour */
  detail: string;
  tone?: "warn" | "bad";
}

export interface HydroStatusInput {
  /** This plant's own reservoir, 0-1 */
  fraction: number;
  /** Water arriving this tick overflowed the reservoir */
  spilling: boolean;
  monthNumber: number;
  latitude?: number;
  /** Combined forecast for every operating dam */
  outlook?: ReservoirOutlookPoint[];
  /** More than one dam operating, so the forecast describes the fleet rather than this dam */
  fleet?: boolean;
}

// Close enough to the minimum generating level that output is already being held back
export const LOW_RESERVOIR_FRACTION = HYDRO_DEADPOOL_FRACTION + 0.05;
// Changes smaller than this over a month read as noise rather than a direction
const TREND_THRESHOLD = 0.03;
// Enough snow on the ground to be worth waiting for, in mm of water equivalent
const MEANINGFUL_SNOWPACK_MM = 25;
// From here the growing-season curve is the dominant draw on the reservoir
const HEAVY_RELEASE_FRACTION = 0.3;

function snowRefillMonth(outlook: ReservoirOutlookPoint[]): number | undefined {
  const current = outlook[0];
  if (current.snowpackMm < MEANINGFUL_SNOWPACK_MM) {
    return undefined;
  }
  const melted = outlook.findIndex(
    (point, index) =>
      index > 0 &&
      point.snowpackMm < current.snowpackMm / 2 &&
      point.fraction > outlook[index - 1].fraction,
  );
  return melted > 0 ? outlook[melted].monthNumber : undefined;
}

function firstRise(outlook?: ReservoirOutlookPoint[]): number | undefined {
  const index = (outlook || []).findIndex(
    (point, i) => i > 0 && point.fraction > outlook![i - 1].fraction + 0.02,
  );
  return index > 0 ? outlook![index].monthNumber : undefined;
}

export function describeHydroStatus(input: HydroStatusInput): HydroStatus {
  const { fraction, outlook, fleet } = input;
  if (fraction <= LOW_RESERVOIR_FRACTION) {
    // The combined forecast can rise while this dam stays empty, so only a lone dam gets a month
    const refill = fleet ? undefined : firstRise(outlook);
    return {
      lead: "Nearly empty.",
      detail: refill
        ? `Output stays low until it refills, likely in ${MONTH_NAMES[refill - 1]}.`
        : outlook && !fleet
          ? "Output stays low; no refill is expected within a year."
          : "Output stays low until rain or snowmelt refills it.",
      tone: "bad",
    };
  }
  if (input.spilling) {
    return {
      lead: "Full.",
      detail:
        "Extra water is spilling, so any extra output from it costs no stored water.",
    };
  }

  const change =
    outlook && outlook.length > 1
      ? outlook[1].fraction - outlook[0].fraction
      : 0;
  // Trends come from every operating dam together, so with several they say so
  const trend = (verb: string) =>
    fleet ? `Your dams are ${verb.toLowerCase()}.` : `${verb}.`;
  let lead: string;
  let detail: string;
  if (change > TREND_THRESHOLD) {
    lead = trend("Filling");
    detail = "More water is arriving than is being used.";
  } else if (change < -TREND_THRESHOLD) {
    lead = trend("Draining");
    detail = "Generation and required releases exceed inflow.";
  } else {
    lead = trend("Steady");
    detail = "Water arriving roughly matches water used.";
  }

  const refill =
    outlook && change <= TREND_THRESHOLD ? snowRefillMonth(outlook) : undefined;
  const runsLow = outlook?.find(
    (point, index) => index > 0 && point.fraction <= LOW_RESERVOIR_FRACTION,
  );
  if (refill) {
    detail = `Snow is holding water back; expect a refill around ${MONTH_NAMES[refill - 1]}.`;
  } else if (runsLow) {
    // Pausing would also stop the required releases turning into power, so the gentler lever
    // is the one worth naming
    return {
      // A reservoir rising now and running dry later needs both halves said, or they read as a
      // contradiction
      lead: change > TREND_THRESHOLD ? trend("Filling for now") : lead,
      detail: `${fleet ? "They" : "It"} will run low around ${MONTH_NAMES[runsLow.monthNumber - 1]}. Moving ${fleet ? "a dam" : "it"} down the dispatch order saves water for later.`,
      tone: "warn",
    };
  } else if (
    mandatedReleaseFraction(input.monthNumber, input.latitude) >=
    HEAVY_RELEASE_FRACTION
  ) {
    detail += " Downstream water rights require extra releases this month.";
  }
  return { lead, detail };
}
