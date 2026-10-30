import { DAYS_PER_MONTH, DAYS_PER_YEAR } from "../Constants";
import { getRecordedWeatherRows, getWeather } from "../data/Weather";
import { DateType, RawWeatherType } from "../Types";

const HOURS_PER_DAY = 24;
const HOURS_PER_YEAR = DAYS_PER_YEAR * HOURS_PER_DAY;
// One simulated day represents a real month: six game hours are roughly a week ahead.
const OBSERVATION_PERSISTENCE_MINUTES = 6 * 60;
const FIELDS = ["TEMP_C", "CLOUD_PCT", "WIND_KPH", "PRECIP_MM"] as const;
const normalsCache = new WeakMap<readonly RawWeatherType[], RawWeatherType[]>();

function hourlyNormals(rows: readonly RawWeatherType[]): RawWeatherType[] {
  const cached = normalsCache.get(rows);
  if (cached) return cached;
  const offshore = rows[0].WIND_OFFSHORE_KPH !== undefined;
  const fields = offshore ? [...FIELDS, "WIND_OFFSHORE_KPH" as const] : FIELDS;
  const counts = new Array<number>(HOURS_PER_YEAR).fill(0);
  const normals = Array.from({ length: HOURS_PER_YEAR }, (_, hour) => ({
    YEAR: 0,
    MONTH: Math.floor(hour / (DAYS_PER_MONTH * HOURS_PER_DAY)) + 1,
    TEMP_C: 0,
    CLOUD_PCT: 0,
    WIND_KPH: 0,
    PRECIP_MM: 0,
    ...(offshore ? { WIND_OFFSHORE_KPH: 0 } : {}),
  }));
  rows.forEach((row, index) => {
    const slot = index % HOURS_PER_YEAR;
    counts[slot]++;
    fields.forEach((field) => {
      normals[slot][field] = (normals[slot][field] ?? 0) + (row[field] ?? 0);
    });
  });
  normals.forEach((normal, index) => {
    fields.forEach((field) => {
      normal[field] = (normal[field] ?? 0) / counts[index];
    });
  });
  normalsCache.set(rows, normals);
  return normals;
}

// Hydrology shifts the calendar fields for its lookback without changing date.minute.
function calendarMinute(date: DateType): number {
  return (
    (date.year * DAYS_PER_YEAR + (date.monthNumber - 1) * DAYS_PER_MONTH) *
      HOURS_PER_DAY *
      60 +
    date.minuteOfDay
  );
}

/**
 * A player-facing estimate, distinct from the historical/seeded weather that actually occurs.
 * Only the issue-time observation is read from the actual trajectory. Its departure from the
 * local hourly normal fades with lead time; distant estimates use seasonal hourly normals.
 * No future random draws are consumed, and reopening charts or reloading cannot reroll it.
 */
export function createWeatherForecast(
  issuedAt: DateType,
  seed: number,
  seriesId?: string,
): (date: DateType) => RawWeatherType {
  const rows = getRecordedWeatherRows(seriesId);
  if (!rows.length) return (date) => getWeather(date, seed, 0, seriesId);
  const normals = hourlyNormals(rows);
  const fields =
    rows[0].WIND_OFFSHORE_KPH === undefined
      ? FIELDS
      : [...FIELDS, "WIND_OFFSHORE_KPH" as const];
  const normalAt = (date: DateType): RawWeatherType => {
    const slot =
      (date.monthNumber - 1) * DAYS_PER_MONTH * HOURS_PER_DAY + date.hourOfDay;
    const from = normals[slot];
    const to = normals[(slot + 1) % HOURS_PER_YEAR];
    const fraction = (date.minuteOfDay % 60) / 60;
    const normal = { ...from, YEAR: date.year, MONTH: date.monthNumber };
    fields.forEach((field) => {
      normal[field] =
        (from[field] ?? 0) * (1 - fraction) + (to[field] ?? 0) * fraction;
    });
    return normal;
  };
  const observation = getWeather(issuedAt, seed, 0, seriesId);
  const observedNormal = normalAt(issuedAt);
  const issuedMinute = calendarMinute(issuedAt);
  return (date) => {
    const leadMinutes = calendarMinute(date) - issuedMinute;
    if (leadMinutes <= 0) return getWeather(date, seed, 0, seriesId);
    const estimate = normalAt(date);
    const persistence = Math.max(
      0,
      1 - leadMinutes / OBSERVATION_PERSISTENCE_MINUTES,
    );
    fields.forEach((field) => {
      estimate[field] =
        (estimate[field] ?? 0) +
        persistence *
          ((observation[field] ?? 0) - (observedNormal[field] ?? 0));
    });
    estimate.TEMP_C = Math.max(-60, Math.min(60, estimate.TEMP_C));
    estimate.CLOUD_PCT = Math.max(0, Math.min(100, estimate.CLOUD_PCT));
    estimate.WIND_KPH = Math.max(0, estimate.WIND_KPH);
    estimate.PRECIP_MM = Math.max(0, estimate.PRECIP_MM);
    if (estimate.WIND_OFFSHORE_KPH !== undefined) {
      estimate.WIND_OFFSHORE_KPH = Math.max(0, estimate.WIND_OFFSHORE_KPH);
    }
    return estimate;
  };
}
