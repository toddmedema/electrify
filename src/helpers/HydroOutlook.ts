import { TickPresentFutureType } from "../Types";
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
  text: string;
  tone?: "good" | "warn" | "bad";
}

export interface HydroStatusInput {
  /** This plant's own reservoir, 0-1 */
  fraction: number;
  /** Water arriving this tick overflowed the reservoir */
  spilling: boolean;
  monthNumber: number;
  latitude?: number;
  outlook?: ReservoirOutlookPoint[];
}

// Close enough to the minimum generating level that output is already being held back
const LOW_FRACTION = HYDRO_DEADPOOL_FRACTION + 0.05;
// Changes smaller than this over a month read as noise rather than a direction
const TREND_THRESHOLD = 0.03;
// Enough snow on the ground to be worth waiting for, in mm of water equivalent
const MEANINGFUL_SNOWPACK_MM = 25;
// From here the growing-season curve is the dominant draw on the reservoir
const HEAVY_RELEASE_FRACTION = 0.3;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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

export function describeHydroStatus(input: HydroStatusInput): HydroStatus {
  const { fraction, outlook } = input;
  if (fraction <= LOW_FRACTION) {
    return {
      text: "Nearly empty. Output stays low until rain or snowmelt refills it.",
      tone: "bad",
    };
  }
  if (input.spilling) {
    return {
      text: "Full, so extra water is spilling. Running it harder uses water that would be lost anyway.",
      tone: "good",
    };
  }

  let text: string;
  const change =
    outlook && outlook.length > 1
      ? outlook[1].fraction - outlook[0].fraction
      : 0;
  if (change > TREND_THRESHOLD) {
    text = "Filling: more water is arriving than it uses.";
  } else if (change < -TREND_THRESHOLD) {
    text = "Draining: it uses water faster than rain and snowmelt replace it.";
  } else {
    text = "Steady: water arriving roughly matches water used.";
  }

  const refill =
    outlook && change <= TREND_THRESHOLD ? snowRefillMonth(outlook) : undefined;
  const runsLow = outlook?.find(
    (point, index) => index > 0 && point.fraction <= LOW_FRACTION,
  );
  if (refill) {
    text += ` Snow is holding water back; it should refill around ${MONTH_NAMES[refill - 1]}.`;
  } else if (runsLow) {
    return {
      text: `${text} At this rate it runs low around ${MONTH_NAMES[runsLow.monthNumber - 1]}.`,
      tone: "warn",
    };
  } else if (
    mandatedReleaseFraction(input.monthNumber, input.latitude) >=
    HEAVY_RELEASE_FRACTION
  ) {
    text += " Downstream water rights also require releases this month.";
  }
  return { text };
}
