import { HOURS_PER_YEAR_REAL } from "../Constants";
import { getRecordedWeatherRows, getWeather } from "../data/Weather";
import { DateType, RawWeatherType } from "../Types";

export const HYDRO_TARGET_CAPACITY_FACTOR = 0.4;
export const HYDRO_RESERVOIR_HOURS = 1000;
export const HYDRO_DEADPOOL_FRACTION = 0.1;
export const SNOWPACK_LOOKBACK_MONTHS = 24;
export const RUNOFF_COEFFICIENT = 0.4;
export const DEGREE_DAY_FACTOR_MM_C_DAY = 4;

const HOURS_PER_DAY = 24;
const MONTHS_PER_YEAR = 12;
const DAYS_PER_MONTH_REAL = 365 / MONTHS_PER_YEAR;

export interface HydroConditionsType {
  precipitationMm: number;
  snowpackMm: number;
  runoffMm: number;
  rainMm: number;
  meltMm: number;
}

/** A linear rain/snow transition: all snow below -1C and all rain above 3C. */
export function snowFraction(temperatureC: number): number {
  return Math.max(0, Math.min(1, (3 - temperatureC) / 4));
}

/** Potential monthly melt under the temperature-index (degree-day) method. */
export function meltPotentialMm(temperatureC: number): number {
  return (
    DEGREE_DAY_FACTOR_MM_C_DAY * Math.max(0, temperatureC) * DAYS_PER_MONTH_REAL
  );
}

function shiftedMonth(date: DateType, offset: number, hour = 0): DateType {
  const absoluteMonth =
    date.year * MONTHS_PER_YEAR + date.monthNumber - 1 + offset;
  const year = Math.floor(absoluteMonth / MONTHS_PER_YEAR);
  const monthNumber = absoluteMonth - year * MONTHS_PER_YEAR + 1;
  return {
    ...date,
    year,
    monthNumber,
    hourOfDay: hour,
    minuteOfDay: hour * 60,
  };
}

function monthlyWeather(
  date: DateType,
  seed: number,
  cumulativeMegatons: number,
  seriesId?: string,
) {
  let temperatureC = 0;
  let sampledDayPrecipMm = 0;
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const reading = getWeather(
      shiftedMonth(date, 0, hour),
      seed,
      cumulativeMegatons,
      seriesId,
    );
    temperatureC += reading.TEMP_C;
    sampledDayPrecipMm += reading.PRECIP_MM;
  }
  return {
    temperatureC: temperatureC / HOURS_PER_DAY,
    // The weather archive contains one representative day per month. Its total is a daily rate,
    // so expand it to the real month before putting millimetres into the reservoir balance.
    precipitationMm: sampledDayPrecipMm * DAYS_PER_MONTH_REAL,
  };
}

/**
 * Builds the standing snowpack and this month's runoff from a bounded lookback. It is stateless,
 * so a cold-started save and a forecast walked from 1980 produce the same basin at the same date.
 */
export function getHydroConditions(
  date: DateType,
  seed: number,
  cumulativeMegatons = 0,
  seriesId?: string,
): HydroConditionsType {
  let snowpackMm = 0;
  let current: HydroConditionsType = {
    precipitationMm: 0,
    snowpackMm: 0,
    runoffMm: 0,
    rainMm: 0,
    meltMm: 0,
  };
  for (let offset = -SNOWPACK_LOOKBACK_MONTHS; offset <= 0; offset++) {
    const weather = monthlyWeather(
      shiftedMonth(date, offset),
      seed,
      cumulativeMegatons,
      seriesId,
    );
    const snowMm = weather.precipitationMm * snowFraction(weather.temperatureC);
    const rainMm = weather.precipitationMm - snowMm;
    snowpackMm += snowMm;
    const meltMm = Math.min(snowpackMm, meltPotentialMm(weather.temperatureC));
    snowpackMm = Math.max(0, snowpackMm - meltMm);
    if (offset === 0) {
      current = {
        precipitationMm: weather.precipitationMm,
        snowpackMm,
        runoffMm: RUNOFF_COEFFICIENT * (rainMm + meltMm),
        rainMm,
        meltMm,
      };
    }
  }
  return current;
}

function monthlyWeatherFromRows(rows: readonly RawWeatherType[], at: number) {
  const start = at * HOURS_PER_DAY;
  let temperatureC = 0;
  let sampledDayPrecipMm = 0;
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    temperatureC += rows[start + hour].TEMP_C;
    sampledDayPrecipMm += rows[start + hour].PRECIP_MM;
  }
  return {
    temperatureC: temperatureC / HOURS_PER_DAY,
    precipitationMm: sampledDayPrecipMm * DAYS_PER_MONTH_REAL,
  };
}

// A reload replaces the recorded snapshot, even when the endpoints have not changed.
// Weak keys also release calibration entries when their weather data is unloaded.
const runoffCache = new WeakMap<readonly RawWeatherType[], number>();

/** Mean annual runoff in the loaded basin, used only to calibrate a plant's Wh per millimetre. */
export function getMeanAnnualRunoffMm(seriesId?: string): number {
  const rows = getRecordedWeatherRows(seriesId);
  if (rows.length < HOURS_PER_DAY * MONTHS_PER_YEAR) {
    return 1;
  }
  const cached = runoffCache.get(rows);
  if (cached !== undefined) {
    return cached;
  }

  const months = Math.floor(rows.length / HOURS_PER_DAY);
  // Keep at least a complete year to measure when a valid record is shorter than
  // the usual warmup plus one year. Full historical records retain the same spinup.
  const warmupMonths = Math.min(
    SNOWPACK_LOOKBACK_MONTHS,
    months - MONTHS_PER_YEAR,
  );
  let snowpackMm = 0;
  let runoffMm = 0;
  let countedMonths = 0;
  for (let month = 0; month < months; month++) {
    const weather = monthlyWeatherFromRows(rows, month);
    const snowMm = weather.precipitationMm * snowFraction(weather.temperatureC);
    const rainMm = weather.precipitationMm - snowMm;
    snowpackMm += snowMm;
    const meltMm = Math.min(snowpackMm, meltPotentialMm(weather.temperatureC));
    snowpackMm = Math.max(0, snowpackMm - meltMm);
    // Let the first bounded-lookback window spin up before measuring the climatology.
    if (month >= warmupMonths) {
      runoffMm += RUNOFF_COEFFICIENT * (rainMm + meltMm);
      countedMonths++;
    }
  }
  const annual = Math.max(1, (runoffMm / countedMonths) * MONTHS_PER_YEAR);
  runoffCache.set(rows, annual);
  return annual;
}

// HYDRO_RESERVOIR_HOURS is about six weeks at full output, which is the right order for the
// run-of-river and weekly-cycling plant most locations get. A handful of basins are storage
// reservoirs in a different class: Kariba is a multi-year carryover lake, and six weeks of it
// cannot hold a five-month dry season, which forces any scenario built on one to oversize its
// fleet until nothing that happens to the water can reach the load. Hours by basin, because the
// lake is a property of the river rather than of whoever built the powerhouse.
const RESERVOIR_HOURS_BY_WATERSHED: Readonly<Record<string, number>> = {
  // Lake Kariba holds roughly 180km3 against a fleet that would drain this model's default in
  // six weeks. This still understates it by a wide margin, and is set to what the Zambezi
  // scenario needs to behave - a lake that carries its grid through an ordinary dry season and
  // reaches its minimum in the second year of a bad run - rather than to the lake's full ratio.
  Lusaka: 2800,
};

export function hydroSizing(peakW: number, seriesId?: string) {
  const annualInflowWh =
    peakW * HOURS_PER_YEAR_REAL * HYDRO_TARGET_CAPACITY_FACTOR;
  const reservoirHours =
    (seriesId && RESERVOIR_HOURS_BY_WATERSHED[seriesId]) ||
    HYDRO_RESERVOIR_HOURS;
  return {
    reservoirCapacityWh: peakW * reservoirHours,
    hydroWhPerMm: annualInflowWh / getMeanAnnualRunoffMm(seriesId),
    hydroMeanMonthlyInflowWh: annualInflowWh / MONTHS_PER_YEAR,
  };
}

// Agriculture and municipal deliveries peak in summer. This is a share of mean inflow, not a
// tax: when it passes through an operating turbine it becomes must-run generation.
const MANDATED_RELEASE_FRACTIONS = [
  0.12, 0.12, 0.15, 0.2, 0.3, 0.45, 0.55, 0.55, 0.4, 0.25, 0.15, 0.12,
];

/**
 * The curve tracks the growing season, peaking in July and August because that is the northern
 * summer. Summer is six months apart in the two hemispheres, so a fixed calendar hands a Chilean
 * or Zambian reservoir its heaviest irrigation obligation in the middle of the southern winter,
 * months after anything downstream has stopped asking for water. Latitude, not the calendar,
 * decides which half of the year this curve sits in.
 */
export function mandatedReleaseFraction(
  monthNumber: number,
  latitude = 1,
): number {
  const shifted =
    latitude < 0 ? ((monthNumber + 5) % MONTHS_PER_YEAR) + 1 : monthNumber;
  return MANDATED_RELEASE_FRACTIONS[shifted - 1] || 0;
}
