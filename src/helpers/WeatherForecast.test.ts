import { getWeather, initWeatherFromRows } from "../data/Weather";
import { RawWeatherType } from "../Types";
import { getDateFromMinute } from "./DateTime";
import { createWeatherForecast } from "./WeatherForecast";
import { getHydroConditions } from "./Hydro";

function rows(offshore = true, warmer = 0): RawWeatherType[] {
  return Array.from({ length: 40 * 12 * 24 }, (_, index) => {
    const year = Math.floor(index / (12 * 24));
    const month = Math.floor(index / 24) % 12;
    const hour = index % 24;
    const season = 10 - 10 * Math.cos((month * 2 * Math.PI) / 12);
    const diurnal = 3 * Math.sin(((hour - 6) * 2 * Math.PI) / 24);
    const anomaly = year % 2 === 0 ? -4 : 4;
    return {
      YEAR: 1980 + year,
      MONTH: month + 1,
      TEMP_C: season + diurnal + anomaly + warmer,
      CLOUD_PCT: 50 + 4 * anomaly + diurnal,
      WIND_KPH: 12 + anomaly + diurnal,
      PRECIP_MM: hour < 6 && anomaly > 0 ? 1 : 0,
      ...(offshore ? { WIND_OFFSHORE_KPH: 30 + anomaly + diurnal } : {}),
    };
  });
}
const date = (minute: number, year = 1980) => getDateFromMinute(minute, year);

beforeEach(() => initWeatherFromRows("city", rows()));

it("starts from observations and allows forecast error for every weather field", () => {
  const issuedAt = date(15);
  const forecast = createWeatherForecast(issuedAt, 7);
  expect(forecast(issuedAt)).toEqual(getWeather(issuedAt, 7));
  expect(forecast(date(0))).toEqual(getWeather(date(0), 7));
  const future = date(1440 + 3 * 60 + 15);
  const actual = getWeather(future, 7);
  const predicted = forecast(future);
  for (const field of [
    "TEMP_C",
    "CLOUD_PCT",
    "WIND_KPH",
    "PRECIP_MM",
    "WIND_OFFSHORE_KPH",
  ] as const) {
    expect(predicted[field]).not.toBe(actual[field]);
  }
  expect(
    Math.abs(forecast(date(16)).TEMP_C - getWeather(date(16), 7).TEMP_C),
  ).toBeLessThan(0.1);
});

it("uses local seasons and interpolates hours, months and the year boundary", () => {
  const forecast = createWeatherForecast(date(0), 7);
  expect(forecast(date(6 * 1440 + 12 * 60)).TEMP_C).toBeGreaterThan(
    forecast(date(12 * 60)).TEMP_C + 15,
  );
  const before = forecast(date(12 * 60));
  const after = forecast(date(13 * 60));
  expect(forecast(date(12 * 60 + 15)).TEMP_C).toBeCloseTo(
    0.75 * before.TEMP_C + 0.25 * after.TEMP_C,
  );
  const december = forecast(date(12 * 1440 - 60));
  const january = forecast(date(12 * 1440));
  expect(forecast(date(12 * 1440 - 15)).TEMP_C).toBeCloseTo(
    0.25 * december.TEMP_C + 0.75 * january.TEMP_C,
  );
});

it("does not reveal a changed future realization when climate and observations are identical", () => {
  const issuedAt = date(15);
  const target = date(6 * 1440 + 12 * 60, 1981);
  const before = createWeatherForecast(issuedAt, 7)(target);
  const actualBefore = getWeather(target, 7);
  const changed = rows();
  // Swap two unobserved July days: local hourly climate stays the same, actual weather changes.
  const first = (12 + 6) * 24;
  const second = (24 + 6) * 24;
  for (let hour = 0; hour < 24; hour++) {
    const a = changed[first + hour];
    const b = changed[second + hour];
    changed[first + hour] = { ...b, YEAR: a.YEAR };
    changed[second + hour] = { ...a, YEAR: b.YEAR };
  }
  initWeatherFromRows("city", changed);
  expect(getWeather(target, 7).TEMP_C).not.toBe(actualBefore.TEMP_C);
  expect(createWeatherForecast(issuedAt, 7)(target)).toEqual(before);
});

it("is stable cold or warm and does not expose the seeded future beyond the record", () => {
  const issuedAt = date(15, 2026);
  const target = date(6 * 1440 + 12 * 60, 2027);
  const actualBefore = getWeather(target, 7);
  const expected = createWeatherForecast(issuedAt, 7)(target);
  initWeatherFromRows("city", rows());
  const forecast = createWeatherForecast(issuedAt, 7);
  expect(forecast(target)).toEqual(expected);
  expect(getWeather(target, 7)).toEqual(actualBefore);
  expect(forecast(target)).toEqual(expected);
  initWeatherFromRows("city", rows());
  expect(getWeather(target, 29)).not.toEqual(actualBefore);
  expect(createWeatherForecast(issuedAt, 29)(target)).toEqual(expected);
});

it("refreshes near-term estimates from new observations without changing distant climate", () => {
  const target = date(4 * 60);
  const earlier = createWeatherForecast(date(0), 7);
  const later = createWeatherForecast(date(3 * 60), 7);
  const actual = getWeather(target, 7).TEMP_C;
  expect(Math.abs(later(target).TEMP_C - actual)).toBeLessThan(
    Math.abs(earlier(target).TEMP_C - actual),
  );
  expect(later(date(1440))).toEqual(earlier(date(1440)));
});

it("keeps city and basin climate separate and preserves absent offshore readings", () => {
  initWeatherFromRows("basin", rows(false, 15), true);
  const issuedAt = date(0);
  const city = createWeatherForecast(issuedAt, 7, "city");
  const basin = createWeatherForecast(issuedAt, 7, "basin");
  const future = date(12 * 60);
  expect(basin(future).TEMP_C).toBeCloseTo(city(future).TEMP_C + 15);
  expect(city(future).WIND_OFFSHORE_KPH).toBeGreaterThan(0);
  expect(basin(future).WIND_OFFSHORE_KPH).toBeUndefined();
  for (let minute = 15; minute <= 12 * 1440; minute += 15) {
    const reading = city(date(minute));
    expect(reading.CLOUD_PCT).toBeGreaterThanOrEqual(0);
    expect(reading.CLOUD_PCT).toBeLessThanOrEqual(100);
    expect(reading.WIND_KPH).toBeGreaterThanOrEqual(0);
    expect(reading.PRECIP_MM).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(reading.TEMP_C)).toBe(true);
  }
});

it("retains the unloaded-data fallback", () => {
  expect(() => initWeatherFromRows("empty", [])).toThrow();
  const issuedAt = date(0);
  expect(createWeatherForecast(issuedAt, 7)(date(1440))).toEqual(
    getWeather(date(1440), 7),
  );
});

it("forecasts snow accumulation from estimated basin weather", () => {
  initWeatherFromRows("cold-basin", rows(false, -12));
  const issuedAt = date(0);
  const target = date(1440);
  const forecast = getHydroConditions(
    target,
    7,
    0,
    "cold-basin",
    createWeatherForecast(issuedAt, 7, "cold-basin"),
  );
  const actual = getHydroConditions(target, 7, 0, "cold-basin");
  expect(forecast.snowpackMm).toBeGreaterThan(actual.snowpackMm);
  expect(forecast.precipitationMm).toBeGreaterThan(actual.precipitationMm);
});
