import { DAYS_PER_MONTH, DAYS_PER_YEAR, EQUATOR_RADIANCE } from "../Constants";
import { DateType, LocationType, RawWeatherType } from "../Types";
import { normalAt, randomAt, RANDOM_STREAM } from "../helpers/Math";
import { getSunriseSunset } from "../helpers/DateTime";
import Papa from "papaparse";

const STARTING_YEAR = 1980; // for weather data, Jan 1st, assumed to be the same for all locations
const ENDING_YEAR = 2019; // for weather data, Dec 31st, assumed to be the same for all locations
const ROWS_PER_DAY = 24;
const ROWS_PER_YEAR = DAYS_PER_YEAR * ROWS_PER_DAY;
const EXPECTED_ROWS = (ENDING_YEAR - STARTING_YEAR + 1) * ROWS_PER_YEAR;
const MONTHS_PER_YEAR = 12;
// One normal each for temperature, wind and cloud cover, plus a uniform to pick which historic
// year the day borrows its hour to hour shape from
const DRAWS_PER_FORECAST_DAY = 4;

// How much of last year's departure from normal carries into this year's, for the same month.
// The point of it being well under 1 is that the departure decays back towards normal instead of
// accumulating: at 1 this is the unbounded random walk that used to send Pittsburgh Januaries
// past 17C and pin cloud cover at 100% within a couple of decades of forecasting.
const ANOMALY_PERSISTENCE = 0.3;

// How far past the range the location has actually recorded a forecast is allowed to go, as a
// multiple of that month's standard deviation. Some headroom matters -- forty years is not every
// heatwave there will ever be -- but not so much that a forecast invents a climate.
const FORECAST_HEADROOM_SDS = 1.5;

// Emissions -> climate coupling. Warming approaches MAX_WARMING_C asymptotically rather than
// linearly, so no amount of coal can produce a nonsense number, and WARMING_HALF_MEGATONS is the
// cumulative total that gets halfway there. Calibrated against the headless simulator: a
// fossil-heavy 20 year run of The Shale Boom emits about 80 megatons, which lands near +1.5C.
const MAX_WARMING_C = 3;
const WARMING_HALF_MEGATONS = 115;
// At the same time the spread widens, which is the part a player feels: hotter peaks, colder
// snaps, and a wider gap between them. Shares the saturating curve, so a clean run gets neither.
const MAX_VARIANCE_GAIN = 0.35;

// Ordered oldest first
let weather: RawWeatherType[] = [];
const DUMMY_WEATHER = {
  YEAR: 0,
  MONTH: 0,
  TEMP_C: 0,
  CLOUD_PCT: 0,
  WIND_KPH: 10,
};

// The three fields that are forecast, and the physical floor and ceiling each one has to respect
// whatever the data says. Keyed this way so climatology, the forecast and the emissions coupling
// can all walk the same three fields rather than repeating themselves three times over.
const FORECAST_FIELDS = ["TEMP_C", "CLOUD_PCT", "WIND_KPH"] as const;
type ForecastFieldType = (typeof FORECAST_FIELDS)[number];
const PHYSICAL_BOUNDS: Record<ForecastFieldType, { min: number; max: number }> =
  {
    TEMP_C: { min: -60, max: 60 },
    CLOUD_PCT: { min: 0, max: 100 },
    WIND_KPH: { min: 0, max: Infinity },
  };

interface FieldStatsType {
  mean: number; // Of the daily mean, across every year that has this month
  sd: number; // Interannual, also of the daily mean
  min: number; // Lowest and highest single hourly reading on record for this month
  max: number;
}

interface MonthClimatologyType {
  // Row offsets of the real recorded days for this calendar month, which forecasts borrow their
  // hour to hour shape from. Only ever holds loaded data, never a previously forecast day.
  historicRows: number[];
  stats: Record<ForecastFieldType, FieldStatsType>;
}

// One entry per calendar month, built once per load from whatever was loaded. Every location gets
// its seasonality from its own forty years rather than from anything written per location here,
// which is what makes this scale to a seventh city.
let climatology: MonthClimatologyType[] = [];

// Which calendar month a day index falls in, 0 based. Written against the constants rather than
// assuming twelve days a year, so raising DAYS_PER_MONTH does not silently scramble the seasons.
function monthSlotOf(dayIndex: number): number {
  return Math.floor((dayIndex % DAYS_PER_YEAR) / DAYS_PER_MONTH);
}

function dailyMean(row: number, field: ForecastFieldType): number {
  let total = 0;
  for (let hour = 0; hour < ROWS_PER_DAY; hour++) {
    total += weather[row + hour][field];
  }
  return total / ROWS_PER_DAY;
}

/**
 * Reduces the loaded data to per month statistics: what a typical day of this month looks like at
 * this location, how much year to year variation there is around that, and the extremes on record.
 *
 * Running this over the real rows is what gives the forecast its seasonality for free. Pittsburgh
 * Januaries come out cloudy (66%), windy (4.3kph) and wildly variable year to year (5.8C), and
 * Augusts come out clearer (41%), calmer (2.8kph) and steadier (2.3C), without a line of code
 * knowing anything about Pittsburgh.
 */
function buildClimatology() {
  // Built up locally and assigned at the end, so the closures below capture a const and
  // no-loop-func stays satisfied -- the same reason resetFuelPrices empties in place
  const months: MonthClimatologyType[] = [];
  const rows = weather;
  const loadedDays = Math.floor(rows.length / ROWS_PER_DAY);
  const dailyMeans: number[][][] = [];
  for (let slot = 0; slot < MONTHS_PER_YEAR; slot++) {
    const stats = {} as Record<ForecastFieldType, FieldStatsType>;
    FORECAST_FIELDS.forEach((field) => {
      stats[field] = { mean: 0, sd: 0, min: Infinity, max: -Infinity };
    });
    months.push({ historicRows: [], stats });
    dailyMeans.push(FORECAST_FIELDS.map(() => []));
  }

  for (let day = 0; day < loadedDays; day++) {
    const slot = monthSlotOf(day);
    const month = months[slot];
    const row = day * ROWS_PER_DAY;
    month.historicRows.push(row);
    FORECAST_FIELDS.forEach((field, fieldIndex) => {
      dailyMeans[slot][fieldIndex].push(dailyMean(row, field));
      const stats = month.stats[field];
      for (let hour = 0; hour < ROWS_PER_DAY; hour++) {
        const value = rows[row + hour][field];
        stats.min = Math.min(stats.min, value);
        stats.max = Math.max(stats.max, value);
      }
    });
  }

  months.forEach((month, slot) => {
    FORECAST_FIELDS.forEach((field, fieldIndex) => {
      const samples = dailyMeans[slot][fieldIndex];
      const stats = month.stats[field];
      if (samples.length === 0) {
        // Nothing recorded for this month, which only happens for data that never loaded.
        // Leave the stats at values the forecast and the coupling can both divide by safely.
        stats.min = 0;
        stats.max = 0;
        return;
      }
      stats.mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      stats.sd = Math.sqrt(
        samples.reduce((a, b) => a + Math.pow(b - stats.mean, 2), 0) /
          samples.length,
      );
    });
  });
  climatology = months;
}

// TODO download weather for all locations at start with a 2s init delay, like loading audio (but after audio) for offline play
// But only if worker: true starts working - TICKET: https://github.com/mholt/PapaParse/issues/753
// Ideally caching this... so maybe upgrade to use https://tanstack.com/query/latest/docs/framework/react/overview ?
function collectWeatherRow(row: Papa.ParseStepResult<RawWeatherType>) {
  const data = row.data;
  if (data && data.YEAR) {
    weather.push(data);
  }
}

function warnIfWeatherIncomplete(location: string) {
  if (weather.length < EXPECTED_ROWS) {
    console.warn(
      `Weather data for ${location} appears to be incomplete. Found ${weather.length} rows, expected ${EXPECTED_ROWS}`,
    );
  }
}

export function initWeather(location: string, callback?: () => void) {
  weather = []; // reset each time to prevent accidentally appending to old state
  Papa.parse<RawWeatherType>(`/data/WeatherRaw${location}.csv`, {
    download: true,
    dynamicTyping: true,
    header: true,
    // worker: true,
    step: collectWeatherRow,
    complete() {
      warnIfWeatherIncomplete(location);
      // Has to run before anything is forecast, and while the array still holds only real data
      buildClimatology();
      if (callback) {
        callback();
      }
    },
  });
}

/**
 * Synchronous counterpart to initWeather, for callers that already have the CSV contents
 * (the headless simulator reads them off disk; the browser has to download them).
 */
export function initWeatherFromCsv(location: string, csv: string) {
  weather = []; // reset each time to prevent accidentally appending to old state
  Papa.parse<RawWeatherType>(csv, {
    dynamicTyping: true,
    header: true,
    step: collectWeatherRow,
  });
  warnIfWeatherIncomplete(location);
  buildClimatology();
}

/**
 * Fills in every forecast day from the end of what is loaded up to and including `throughDay`.
 *
 * Generating in order matters twice over: each forecast day is last year's same day nudged, so
 * skipping days would forecast off a day that was never written; and going one day per call, the
 * way this used to, left every lookup past the data returning DUMMY_WEATHER until the array
 * happened to catch up -- which a game loaded straight into a year past 2019 never would.
 */
function forecastThroughDay(seed: number, throughDay: number) {
  if (weather.length === 0) {
    return; // Nothing loaded to extrapolate from
  }
  // A partially loaded final day gets regenerated rather than half-read
  for (
    let day = Math.floor(weather.length / ROWS_PER_DAY);
    day <= throughDay;
    day++
  ) {
    forecastDay(seed, day);
  }
}

/**
 * @param cumulativeMegatons - Greenhouse gas the player has emitted so far, in megatons of CO2e,
 *   which warms the temperature and widens the spread of all three fields. Defaults to zero, the
 *   weather the location's own record describes.
 */
export function getWeather(
  date: DateType,
  seed: number,
  cumulativeMegatons = 0,
): RawWeatherType {
  const minuteOfHour = date.minuteOfDay % 60;
  const dayIndex =
    (date.year - STARTING_YEAR) * DAYS_PER_YEAR +
    (date.monthNumber - 1) * DAYS_PER_MONTH; // Only one day per month is simulated
  const row = dayIndex * ROWS_PER_DAY + date.hourOfDay;
  const nextRow = row + 1;

  // Forecast whatever is missing, including the next row's day when blending across midnight
  forecastThroughDay(seed, Math.floor(nextRow / ROWS_PER_DAY));

  if (!weather[row] || !weather[nextRow]) {
    return weather[row]
      ? applyClimateForcing(weather[row], dayIndex, cumulativeMegatons)
      : DUMMY_WEATHER;
  }

  // Otherwise, blend hours for smoother weather.
  // The weights run with the clock: on the hour the reading is entirely the hour we are in,
  // and it slides to the next hour's reading as the minutes tick over.
  // Each row is forced against its own month before blending, because the last hour of a month
  // blends into the first hour of the next one -- they do not share a climatology.
  const prev = applyClimateForcing(weather[row], dayIndex, cumulativeMegatons);
  const next = applyClimateForcing(
    weather[nextRow],
    Math.floor(nextRow / ROWS_PER_DAY),
    cumulativeMegatons,
  );
  const nextPerc = minuteOfHour / 60;
  const prevPerc = 1 - nextPerc;
  return {
    // The blended reading is stamped with the hour it starts in, not the one it is heading towards
    YEAR: prev.YEAR,
    MONTH: prev.MONTH,
    TEMP_C: prev.TEMP_C * prevPerc + next.TEMP_C * nextPerc,
    CLOUD_PCT: prev.CLOUD_PCT * prevPerc + next.CLOUD_PCT * nextPerc,
    WIND_KPH: prev.WIND_KPH * prevPerc + next.WIND_KPH * nextPerc,
  };
}

// TODO verify that it's returning reasonably accurate values per location and season
// (hoping that day length alone is a sufficient proxy / ideally don't need to make it any more complex)
// https://earthobservatory.nasa.gov/features/EnergyBalance/page2.php
// indicates a roughly linear correlation that each degree off from 0*N/S = 0.7% less sunlight
// TODO fix the pointiness, esp in shorter winter months - Maybe by factoring in day lenght to determine the shape of the curve?
// Day length / minutes from dark used as proxy for season / max sun height
// Rough approximation of solar output: https://www.wolframalpha.com/input?i=plot+1%2F%281+%2B+e+%5E+%28-0.015+*+%28x+-+200%29%29%29+from+0+to+420
// Potential more complex model for solar panels: https://pro.arcgis.com/en/pro-app/3.1/tool-reference/spatial-analyst/how-solar-radiation-is-calculated.htm
/**
 * Calculates the raw solar irradiance in watts per square meter (W/m2) for a given date and location, not accounting for weather
 * It first calculates the base irradiance based on the latitude, with a reduction factor for higher latitudes.
 * It then gets the sunrise and sunset times for the given date and location.
 * If the current time is between sunrise and sunset, it calculates the minutes from darkness (either sunrise or sunset, whichever is closer).
 * It then calculates the irradiance based on a mathematical model that approximates the solar output as a bell curve.
 * This model takes into account the time of day and the length of the day to approximate the height of the sun and the season.
 * If the current time is outside of sunrise and sunset, it returns 0, indicating no solar irradiance.
 *
 * @param {DateType} date - The date and time to calculate the irradiance for.
 * @param {LocationType} location - The location to calculate the irradiance for.
 * @param {number} cloudCoverPercent - The percentage of cloud cover, from 0 to 100.
 * @returns {number} - The calculated raw solar irradiance in W/m2.
 */
export function getRawSolarIrradianceWM2(
  date: DateType,
  location: LocationType,
  cloudCoverPercent: number,
) {
  let irradiance = EQUATOR_RADIANCE; //* (1 - 0.007 * Math.abs(lat)); // w/m2 - redundant with day length bell curve?
  irradiance *= 1 - cloudCoverPercent / 400; // Very cloudy days = 25% reduction
  const { sunrise, sunset } = getSunriseSunset(date, location);
  if (date.minuteOfDay >= sunrise && date.minuteOfDay <= sunset) {
    const minutesFromDark = Math.min(
      date.minuteOfDay - sunrise,
      sunset - date.minuteOfDay,
    );
    return (
      irradiance / (1 + Math.pow(Math.E, -0.015 * (minutesFromDark - 200)))
    );
  }
  return 0;
}

function clampToField(
  value: number,
  field: ForecastFieldType,
  stats: FieldStatsType,
): number {
  const headroom = FORECAST_HEADROOM_SDS * stats.sd;
  const physical = PHYSICAL_BOUNDS[field];
  return Math.min(
    Math.min(stats.max + headroom, physical.max),
    Math.max(Math.max(stats.min - headroom, physical.min), value),
  );
}

/**
 * Writes the 24 rows of one forecast day.
 *
 * The level and the shape come from different places, which is the whole idea. The level is an
 * anomaly -- a departure from what this month normally looks like here -- carried forward from the
 * same month last year and pulled back towards normal as it goes, so it wanders without ever
 * drifting away. The shape, meaning how the day's hours sit relative to its own average, is lifted
 * wholesale from a real recorded day of the same month, so forecast days keep the diurnal texture
 * of actual weather instead of being a smooth curve plus noise. Drawing that day from anywhere in
 * the record rather than always from last year is what stops the final year of data repeating
 * itself for the rest of a long game.
 *
 * Addressing the draws by day index rather than taking the next few off a running generator is
 * what lets a day be regenerated later, or in a fresh process, and come out identical.
 */
function forecastDay(seed: number, dayIndex: number) {
  const slot = monthSlotOf(dayIndex);
  const month = climatology[slot];
  const previousYearRow = (dayIndex - DAYS_PER_YEAR) * ROWS_PER_DAY;
  const draw = dayIndex * DRAWS_PER_FORECAST_DAY;

  // A real day of this same month, whose hour to hour shape this day borrows
  const shapeRow =
    month.historicRows[
      Math.floor(
        randomAt(seed, RANDOM_STREAM.weather, draw + FORECAST_FIELDS.length) *
          month.historicRows.length,
      )
    ];

  // Ornstein-Uhlenbeck in one line per field: keep some of last year's anomaly, then add a fresh
  // shock scaled to the spread this month actually has. The sqrt keeps the resulting anomalies at
  // the observed standard deviation rather than inflating it by the part that was carried over.
  const shockScale = Math.sqrt(1 - Math.pow(ANOMALY_PERSISTENCE, 2));
  const anomaly = {} as Record<ForecastFieldType, number>;
  const shapeMean = {} as Record<ForecastFieldType, number>;
  FORECAST_FIELDS.forEach((field, fieldIndex) => {
    const stats = month.stats[field];
    const previousAnomaly = dailyMean(previousYearRow, field) - stats.mean;
    anomaly[field] =
      ANOMALY_PERSISTENCE * previousAnomaly +
      stats.sd *
        shockScale *
        normalAt(seed, RANDOM_STREAM.weather, draw + fieldIndex);
    shapeMean[field] = dailyMean(shapeRow, field);
  });

  for (let row = 0; row < ROWS_PER_DAY; row++) {
    const previous = weather[previousYearRow + row];
    const shape = weather[shapeRow + row];
    const forecast = {
      // Forecast rows follow the same month a year earlier, so they belong to the following year
      YEAR: previous.YEAR + 1,
      MONTH: previous.MONTH,
    } as RawWeatherType;
    FORECAST_FIELDS.forEach((field) => {
      const stats = month.stats[field];
      // The shape day contributes only its within-day departure from its own average, so none of
      // its year comes along with it
      forecast[field] = clampToField(
        stats.mean + anomaly[field] + (shape[field] - shapeMean[field]),
        field,
        stats,
      );
    });
    weather[dayIndex * ROWS_PER_DAY + row] = forecast;
  }
}

/**
 * How far a cumulative emissions total bends the weather: a warming bias on temperature, and a
 * widening of every departure from normal.
 *
 * Both saturate, so a century of coal makes the climate hostile rather than absurd, and both are
 * zero at zero -- a player who builds clean gets exactly the weather the data describes.
 */
function climateShift(cumulativeMegatons: number) {
  const progress = 1 - Math.exp(-cumulativeMegatons / WARMING_HALF_MEGATONS);
  return {
    warmingC: MAX_WARMING_C * progress,
    spread: 1 + MAX_VARIANCE_GAIN * progress,
  };
}

/**
 * Applies the player's own emissions to a single reading, at the point it is read.
 *
 * Deliberately not baked into the stored rows. Forecast days are written before the emissions that
 * would shape them have happened, and a stored row has to come out the same whether the cache was
 * built by walking to a date or by jumping to it -- so the cache stays a pure function of the seed
 * and the coupling is applied on the way out. Historic rows get it too, which is what lets the
 * scenarios set before 2020 respond to how their player generates rather than being fixed replays.
 *
 * Scaling the departure from the monthly mean rather than the reading itself is what turns a
 * warmer average into a harsher one: the hot hours get hotter, the cold snaps get colder, and the
 * gap between them widens, which is what the demand curve and the wind fleet actually feel.
 */
function applyClimateForcing(
  reading: RawWeatherType,
  dayIndex: number,
  cumulativeMegatons: number,
): RawWeatherType {
  if (cumulativeMegatons <= 0 || climatology.length === 0) {
    return reading;
  }
  const month = climatology[monthSlotOf(dayIndex)];
  const { warmingC, spread } = climateShift(cumulativeMegatons);
  const forced = { YEAR: reading.YEAR, MONTH: reading.MONTH } as RawWeatherType;
  FORECAST_FIELDS.forEach((field) => {
    const { mean } = month.stats[field];
    const physical = PHYSICAL_BOUNDS[field];
    const bias = field === "TEMP_C" ? warmingC : 0;
    forced[field] = Math.min(
      physical.max,
      Math.max(physical.min, mean + (reading[field] - mean) * spread + bias),
    );
  });
  return forced;
}
