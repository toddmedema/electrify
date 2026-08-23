import { getWeather, initWeatherFromCsv } from "./Weather";
import { getDateFromMinute } from "../helpers/DateTime";

// Weather rows are looked up by position, one row per hour, with DAYS_PER_MONTH = 1 -- so a
// single year of data is 12 months x 24 hours. The fixture starts at 1980, the first year the
// real CSVs cover.
const FIXTURE_STARTING_YEAR = 1980;
const HOURS_PER_MONTH = 24;
const MONTHS_PER_YEAR = 12;
const SEED = 1;

function fixtureCsv(): string {
  const rows = ["YEAR,MONTH,TEMP_C,CLOUD_PCT,WIND_KPH"];
  for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
    for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
      // Values chosen so every row is distinguishable from its neighbours, which is what makes
      // "did it pick the right row" and "did it blend in the right direction" observable.
      rows.push(
        [FIXTURE_STARTING_YEAR, month, month * 100 + hour, hour, hour * 2].join(
          ",",
        ),
      );
    }
  }
  return rows.join("\n");
}

function dateAt(month: number, hourOfDay: number, minuteOfHour = 0) {
  const minute = (month - 1) * 1440 + hourOfDay * 60 + minuteOfHour;
  return getDateFromMinute(minute, FIXTURE_STARTING_YEAR);
}

describe("getWeather", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    // The fixture is deliberately one year rather than the forty the real data has, and the
    // loader warns about that. Silence it so a passing run has a clean log.
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    initWeatherFromCsv("PIT", fixtureCsv());
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("returns the current hour's reading exactly, on the hour", () => {
    expect(getWeather(dateAt(3, 10), SEED)).toEqual({
      YEAR: 1980,
      MONTH: 3,
      TEMP_C: 310,
      CLOUD_PCT: 10,
      WIND_KPH: 20,
    });
  });

  it("blends towards the next hour as the minutes tick over", () => {
    // A quarter past is three parts this hour, one part the next.
    expect(getWeather(dateAt(3, 10, 15), SEED).TEMP_C).toBeCloseTo(
      0.75 * 310 + 0.25 * 311,
    );
    expect(getWeather(dateAt(3, 10, 45), SEED).TEMP_C).toBeCloseTo(
      0.25 * 310 + 0.75 * 311,
    );
  });

  it("moves monotonically from one hour's reading to the next", () => {
    const readings = [0, 15, 30, 45].map(
      (minuteOfHour) => getWeather(dateAt(5, 6, minuteOfHour), SEED).TEMP_C,
    );
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeGreaterThan(readings[i - 1]);
    }
    expect(readings[0]).toEqual(506);
    expect(readings[readings.length - 1]).toBeLessThan(507);
  });

  it("stamps a blended reading with the hour it started in", () => {
    const blended = getWeather(dateAt(7, 12, 30), SEED);
    expect(blended.YEAR).toEqual(1980);
    expect(blended.MONTH).toEqual(7);
  });

  it("forecasts past the end of the data rather than returning holes", () => {
    // The fixture stops at the end of 1980, so this is a year past anything loaded.
    const forecast = getWeather(dateAt(MONTHS_PER_YEAR + 2, 8), SEED);
    expect(Number.isFinite(forecast.TEMP_C)).toBe(true);
    expect(Number.isFinite(forecast.CLOUD_PCT)).toBe(true);
    expect(Number.isFinite(forecast.WIND_KPH)).toBe(true);
    expect(Number.isFinite(forecast.YEAR)).toBe(true);
    expect(Number.isFinite(forecast.MONTH)).toBe(true);
  });

  // The bug this replaced: forecasting filled a single day per cache miss, so a lookup years past
  // the data fell through to DUMMY_WEATHER and stayed there for as many calls as there were
  // missing days. A loaded save jumps straight to its own date, with nothing in between.
  it("forecasts a distant date on the first lookup rather than falling back to a dummy", () => {
    const distant = getWeather(dateAt(MONTHS_PER_YEAR * 10 + 4, 8), SEED);
    expect(distant.TEMP_C).not.toEqual(0);
    expect(distant.YEAR).toEqual(FIXTURE_STARTING_YEAR + 10);
    expect(distant.MONTH).toEqual(4);
  });

  // The whole point of Phase 0: a cache built by jumping to a date has to hold the same weather as
  // one built by walking there, or a loaded game diverges from the one that was saved
  it("forecasts the same weather cold as it does warm", () => {
    const walked = [];
    for (
      let month = MONTHS_PER_YEAR + 1;
      month <= MONTHS_PER_YEAR * 4;
      month++
    ) {
      walked.push(getWeather(dateAt(month, 8), SEED));
    }

    initWeatherFromCsv("PIT", fixtureCsv()); // Back to a cache holding only the loaded data
    const jumped = getWeather(dateAt(MONTHS_PER_YEAR * 4, 8), SEED);

    expect(jumped).toEqual(walked[walked.length - 1]);
  });

  it("forecasts different weather for a different seed", () => {
    const first = getWeather(dateAt(MONTHS_PER_YEAR + 2, 8), SEED);
    initWeatherFromCsv("PIT", fixtureCsv());
    const second = getWeather(dateAt(MONTHS_PER_YEAR + 2, 8), SEED + 1);
    // Wind rather than temperature: the fixture's temperatures are high enough that both seeds
    // clamp to the same 45 degree ceiling
    expect(second.WIND_KPH).not.toEqual(first.WIND_KPH);
  });

  it("keeps forecast values inside their physical bounds", () => {
    for (
      let month = MONTHS_PER_YEAR + 1;
      month <= MONTHS_PER_YEAR + 6;
      month++
    ) {
      for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
        const forecast = getWeather(dateAt(month, hour), SEED);
        expect(forecast.TEMP_C).toBeGreaterThanOrEqual(-20);
        expect(forecast.TEMP_C).toBeLessThanOrEqual(45);
        expect(forecast.CLOUD_PCT).toBeGreaterThanOrEqual(0);
        expect(forecast.CLOUD_PCT).toBeLessThanOrEqual(100);
        expect(forecast.WIND_KPH).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
