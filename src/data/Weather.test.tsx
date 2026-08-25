import {
  getWeather,
  initWeatherFromRows,
  WEATHER_STARTING_YEAR,
} from "./Weather";
import { getDateFromMinute } from "../helpers/DateTime";
import { RawWeatherType } from "../Types";

// Weather rows are looked up by position, one row per hour, with DAYS_PER_MONTH = 1 -- so a
// single year of data is 12 months x 24 hours. The fixture starts at 1980, the first year the
// real CSVs cover.
const FIXTURE_STARTING_YEAR = 1980;
const HOURS_PER_MONTH = 24;
const MONTHS_PER_YEAR = 12;
const SEED = 1;

// Several years rather than one, because everything the forecast does now is derived from the
// spread of the loaded record: with a single year every month has a standard deviation of zero
// and every forecast year comes out identical. Eight is enough for a stable mean and standard
// deviation per month while keeping the fixture small enough to reason about.
const FIXTURE_YEARS = 8;

// 1 in January, 0 in July. The fixture is built around this so that the loader has a real
// seasonal signal to find -- cold, cloudy, windy, wildly variable winters against warm, clear,
// calm, steady summers -- which is exactly the shape the real CSVs have.
function winterness(month: number): number {
  return (1 + Math.cos((2 * Math.PI * (month - 1)) / MONTHS_PER_YEAR)) / 2;
}

// A zero mean wave over the fixture's span, so each month's average across the record is exactly
// its stated level and the year to year spread is a known multiple of this. Deliberately not
// random: every statistic the tests below assert on can be worked out by hand from these lines.
function yearWave(yearIndex: number): number {
  return Math.sin((2 * Math.PI * yearIndex) / FIXTURE_YEARS);
}

// The level each month sits at, which is what the forecast has to keep returning to
const monthlyTempC = (month: number) => 25 - 25 * winterness(month);
const monthlyCloudPct = (month: number) => 30 + 40 * winterness(month);
const monthlyWindKph = (month: number) => 2 + 3 * winterness(month);
// ...and how far a given year strays from it. Roughly 8x the swing in January that July gets,
// mirroring Pittsburgh's real 5.8C January against its 2.3C August.
const tempSpreadC = (month: number) => 1 + 7 * winterness(month);
// Rain before dawn in the winter half of the year and never in the summer half, which is the
// shape precipitation really has -- mostly nothing, occasionally something -- and is the reason
// it is resampled from a real day rather than drawn from a distribution like the other fields
const precipMm = (month: number, hour: number) =>
  winterness(month) > 0.5 && hour >= 2 && hour < 6 ? 0.5 : 0;

function fixtureRow(
  yearIndex: number,
  month: number,
  hour: number,
): RawWeatherType {
  const wave = yearWave(yearIndex);
  // Amplitude varies by year so that the hour to hour shape genuinely differs between the
  // historic days a forecast can borrow from, which is what makes the resampling observable
  const diurnal =
    (5 + 2 * wave) * Math.sin((2 * Math.PI * (hour - 6)) / HOURS_PER_MONTH);
  return {
    YEAR: FIXTURE_STARTING_YEAR + yearIndex,
    MONTH: month,
    // A full sine over the 24 hours, so the diurnal swing cancels out of a daily mean and each
    // day's average is precisely its month's level plus that year's departure from it
    TEMP_C: monthlyTempC(month) + diurnal + tempSpreadC(month) * wave,
    CLOUD_PCT: Math.min(
      100,
      Math.max(0, monthlyCloudPct(month) + 6 * diurnal + 20 * wave),
    ),
    WIND_KPH: Math.max(0, monthlyWindKph(month) + 0.2 * diurnal + 1.5 * wave),
    PRECIP_MM: precipMm(month, hour),
  };
}

function fixtureRows(): RawWeatherType[] {
  const rows: RawWeatherType[] = [];
  for (let yearIndex = 0; yearIndex < FIXTURE_YEARS; yearIndex++) {
    for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
      for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
        rows.push(fixtureRow(yearIndex, month, hour));
      }
    }
  }
  return rows;
}

function dateAt(month: number, hourOfDay: number, minuteOfHour = 0) {
  const minute = (month - 1) * 1440 + hourOfDay * 60 + minuteOfHour;
  return getDateFromMinute(minute, FIXTURE_STARTING_YEAR);
}

// Absolute month index for a calendar month in a forecast year, counting on past the record
function monthIndex(yearIndex: number, month: number) {
  return yearIndex * MONTHS_PER_YEAR + month;
}

// The average of one forecast day, which is the level the forecast chose for it -- the diurnal
// swing averages out, leaving only that year's departure from the month's norm
function forecastDailyMean(
  yearIndex: number,
  month: number,
  field: "TEMP_C" | "CLOUD_PCT" | "WIND_KPH",
  cumulativeMegatons = 0,
) {
  let total = 0;
  for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
    total += getWeather(
      dateAt(monthIndex(yearIndex, month), hour),
      SEED,
      cumulativeMegatons,
    )[field];
  }
  return total / HOURS_PER_MONTH;
}

function forecastDailyMeans(
  month: number,
  field: "TEMP_C" | "CLOUD_PCT" | "WIND_KPH",
  years: number,
  cumulativeMegatons = 0,
) {
  const means = [];
  for (
    let yearIndex = FIXTURE_YEARS;
    yearIndex < FIXTURE_YEARS + years;
    yearIndex++
  ) {
    means.push(forecastDailyMean(yearIndex, month, field, cumulativeMegatons));
  }
  return means;
}

const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const standardDeviation = (values: number[]) => {
  const mu = mean(values);
  return Math.sqrt(mean(values.map((v) => Math.pow(v - mu, 2))));
};

describe("getWeather", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    // The fixture is deliberately eight years rather than the forty the real data has, and the
    // loader warns about that. Silence it so a passing run has a clean log.
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    initWeatherFromRows("PIT", fixtureRows());
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("returns the current hour's reading exactly, on the hour", () => {
    expect(getWeather(dateAt(3, 10), SEED)).toEqual(fixtureRow(0, 3, 10));
  });

  // A forecast day is last year's same day nudged, so with less than a year loaded forecastDay
  // reaches back past the start of the array and dies on `previous.YEAR` -- mid-tick, a long way
  // from the load that caused it, and only once the player has started playing. Said here
  // instead, the way decodeWeather refuses a file it cannot vouch for
  it("refuses a record too short to forecast from", () => {
    const short = fixtureRows().slice(0, MONTHS_PER_YEAR * HOURS_PER_MONTH - 1);
    expect(() => initWeatherFromRows("PIT", short)).toThrow(/at least/);
    expect(() => initWeatherFromRows("PIT", [])).toThrow(/at least/);
    // Exactly a year is enough: there is a year to forecast the next one from
    expect(() =>
      initWeatherFromRows(
        "PIT",
        fixtureRows().slice(0, MONTHS_PER_YEAR * HOURS_PER_MONTH),
      ),
    ).not.toThrow();
  });

  it("blends towards the next hour as the minutes tick over", () => {
    const here = fixtureRow(0, 3, 10).TEMP_C;
    const next = fixtureRow(0, 3, 11).TEMP_C;
    // A quarter past is three parts this hour, one part the next.
    expect(getWeather(dateAt(3, 10, 15), SEED).TEMP_C).toBeCloseTo(
      0.75 * here + 0.25 * next,
    );
    expect(getWeather(dateAt(3, 10, 45), SEED).TEMP_C).toBeCloseTo(
      0.25 * here + 0.75 * next,
    );
  });

  it("moves monotonically from one hour's reading to the next", () => {
    const readings = [0, 15, 30, 45].map(
      (minuteOfHour) => getWeather(dateAt(5, 6, minuteOfHour), SEED).TEMP_C,
    );
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeGreaterThan(readings[i - 1]);
    }
    expect(readings[0]).toBeCloseTo(fixtureRow(0, 5, 6).TEMP_C);
    expect(readings[readings.length - 1]).toBeLessThan(
      fixtureRow(0, 5, 7).TEMP_C,
    );
  });

  it("stamps a blended reading with the hour it started in", () => {
    const blended = getWeather(dateAt(7, 12, 30), SEED);
    expect(blended.YEAR).toEqual(1980);
    expect(blended.MONTH).toEqual(7);
  });

  it("forecasts past the end of the data rather than returning holes", () => {
    const forecast = getWeather(dateAt(monthIndex(FIXTURE_YEARS, 2), 8), SEED);
    expect(Number.isFinite(forecast.TEMP_C)).toBe(true);
    expect(Number.isFinite(forecast.CLOUD_PCT)).toBe(true);
    expect(Number.isFinite(forecast.WIND_KPH)).toBe(true);
    expect(Number.isFinite(forecast.PRECIP_MM)).toBe(true);
    expect(Number.isFinite(forecast.YEAR)).toBe(true);
    expect(Number.isFinite(forecast.MONTH)).toBe(true);
  });

  // Precipitation is the one field that isn't given an anomaly of its own: a forecast day takes
  // it whole from the real day it borrowed its shape from. So it has to stay in the record's own
  // vocabulary -- a wet hour of that month, or nothing -- rather than becoming a drizzle that
  // never stops, which is what a mean plus a normal shock would make of a mostly-zero field.
  it("forecasts precipitation by resampling real days rather than averaging them", () => {
    const januaryHours = [];
    const julyHours = [];
    for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
      januaryHours.push(
        getWeather(dateAt(monthIndex(FIXTURE_YEARS + 2, 1), hour), SEED)
          .PRECIP_MM,
      );
      julyHours.push(
        getWeather(dateAt(monthIndex(FIXTURE_YEARS + 2, 7), hour), SEED)
          .PRECIP_MM,
      );
    }
    // Every value is one the record actually holds for that month, and January's wet hours are
    // still the small hours rather than being smeared across the day
    expect(new Set(januaryHours)).toEqual(new Set([0, 0.5]));
    expect(januaryHours.filter((mm: number) => mm > 0).length).toEqual(4);
    // ...and a month that has never rained in this fixture still doesn't
    expect(julyHours.every((mm: number) => mm === 0)).toBe(true);
  });

  // The custom game screen builds its year list off WEATHER_STARTING_YEAR, so a date before the
  // record can only arrive from a hand-edited save or an older scenario. Pinned here because
  // opening the timeline makes the year a thing players choose: it has to come back as an empty
  // reading rather than reaching into the arrays at a negative index.
  it("survives a date before the data starts", () => {
    const before = getWeather(dateAt(-24, 8), SEED, 100);
    expect(Number.isFinite(before.TEMP_C)).toBe(true);
    expect(Number.isFinite(before.CLOUD_PCT)).toBe(true);
    expect(Number.isFinite(before.WIND_KPH)).toBe(true);
  });

  it("starts the record at the year the custom game screen offers as its floor", () => {
    expect(WEATHER_STARTING_YEAR).toBe(FIXTURE_STARTING_YEAR);
  });

  // The bug this replaced: forecasting filled a single day per cache miss, so a lookup years past
  // the data fell through to DUMMY_WEATHER and stayed there for as many calls as there were
  // missing days. A loaded save jumps straight to its own date, with nothing in between.
  it("forecasts a distant date on the first lookup rather than falling back to a dummy", () => {
    const distant = getWeather(
      dateAt(monthIndex(FIXTURE_YEARS + 9, 4), 8),
      SEED,
    );
    expect(distant.TEMP_C).not.toEqual(0);
    expect(distant.YEAR).toEqual(FIXTURE_STARTING_YEAR + FIXTURE_YEARS + 9);
    expect(distant.MONTH).toEqual(4);
  });

  // The whole point of Phase 0: a cache built by jumping to a date has to hold the same weather as
  // one built by walking there, or a loaded game diverges from the one that was saved
  it("forecasts the same weather cold as it does warm", () => {
    const walked = [];
    for (
      let month = monthIndex(FIXTURE_YEARS, 1);
      month <= monthIndex(FIXTURE_YEARS + 3, 12);
      month++
    ) {
      walked.push(getWeather(dateAt(month, 8), SEED));
    }

    initWeatherFromRows("PIT", fixtureRows()); // Back to a cache holding only the loaded data
    const jumped = getWeather(
      dateAt(monthIndex(FIXTURE_YEARS + 3, 12), 8),
      SEED,
    );

    expect(jumped).toEqual(walked[walked.length - 1]);
  });

  it("forecasts different weather for a different seed", () => {
    const first = getWeather(dateAt(monthIndex(FIXTURE_YEARS, 2), 8), SEED);
    initWeatherFromRows("PIT", fixtureRows());
    const second = getWeather(
      dateAt(monthIndex(FIXTURE_YEARS, 2), 8),
      SEED + 1,
    );
    expect(second.TEMP_C).not.toEqual(first.TEMP_C);
  });

  it("keeps forecast values inside the range the location has actually recorded", () => {
    for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
      // The widest single hourly readings on record for this month, across every fixture year
      let low = Infinity;
      let high = -Infinity;
      for (let yearIndex = 0; yearIndex < FIXTURE_YEARS; yearIndex++) {
        for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
          const { TEMP_C } = fixtureRow(yearIndex, month, hour);
          low = Math.min(low, TEMP_C);
          high = Math.max(high, TEMP_C);
        }
      }
      // Some headroom past the record is deliberate -- eight years is not every heatwave there
      // will ever be -- but a forecast must not invent a climate
      const headroom = 2 * tempSpreadC(month);
      for (
        let yearIndex = FIXTURE_YEARS;
        yearIndex < FIXTURE_YEARS + 40;
        yearIndex++
      ) {
        for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
          const forecast = getWeather(
            dateAt(monthIndex(yearIndex, month), hour),
            SEED,
          );
          expect(forecast.TEMP_C).toBeGreaterThanOrEqual(low - headroom);
          expect(forecast.TEMP_C).toBeLessThanOrEqual(high + headroom);
          expect(forecast.CLOUD_PCT).toBeGreaterThanOrEqual(0);
          expect(forecast.CLOUD_PCT).toBeLessThanOrEqual(100);
          expect(forecast.WIND_KPH).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  // The regression this whole change exists for. Forecasting used to be an unbounded random walk
  // off last year, one step per year with no pull back towards normal, so a long game wandered
  // somewhere else entirely: a Pittsburgh January reached 17.6C by 2060 on one seed, -4.8C on
  // another, and cloud cover pinned itself at 0 or 100 within about fifteen years on most.
  describe("does not drift", () => {
    it("keeps a century of forecasts centred on the month's own average", () => {
      for (const month of [1, 4, 7, 10]) {
        const means = forecastDailyMeans(month, "TEMP_C", 100);
        // Judged against the standard error rather than a flat tolerance. A hundred draws of a
        // month whose spread is `tempSpreadC` puts the error on their mean at a tenth of that --
        // 0.8C for January -- so a fixed 0.5C was inside the noise and passed or failed on which
        // seed the fixture happened to use: measured across forty of them the bias averages
        // 0.04C with a standard deviation of 0.78C, and better than half of them clear 0.5C.
        // Three standard errors keeps that at a fraction of a percent while still being a long
        // way inside the walk this guards against, which reached +12C.
        const standardError = tempSpreadC(month) / 10;
        expect(Math.abs(mean(means) - monthlyTempC(month))).toBeLessThan(
          3 * standardError,
        );
        // And well inside the month's own year to year spread, whatever the seed
        expect(Math.abs(mean(means) - monthlyTempC(month))).toBeLessThan(
          tempSpreadC(month),
        );
      }
    });

    it("holds the line over a thousand years, where a random walk would be long gone", () => {
      const means = forecastDailyMeans(1, "TEMP_C", 1000);
      expect(Math.abs(mean(means) - monthlyTempC(1))).toBeLessThan(1);
      // A walk with this step size would be tens of degrees out by year 1000
      const worst = Math.max(
        ...means.map((m) => Math.abs(m - monthlyTempC(1))),
      );
      expect(worst).toBeLessThan(5 * tempSpreadC(1));
    });

    it("never lets cloud cover saturate at nothing or total overcast", () => {
      const means = forecastDailyMeans(1, "CLOUD_PCT", 200);
      // The old walk clamped to an extreme and stayed there; a well behaved forecast spends its
      // time around the month's average
      expect(mean(means)).toBeCloseTo(monthlyCloudPct(1), -1);
      expect(Math.min(...means)).toBeGreaterThan(0);
      expect(Math.max(...means)).toBeLessThan(100);
    });
  });

  describe("seasonality", () => {
    it("forecasts the winter the location actually has, not an average one", () => {
      const januaryTemp = mean(forecastDailyMeans(1, "TEMP_C", 60));
      const julyTemp = mean(forecastDailyMeans(7, "TEMP_C", 60));
      const januaryCloud = mean(forecastDailyMeans(1, "CLOUD_PCT", 60));
      const julyCloud = mean(forecastDailyMeans(7, "CLOUD_PCT", 60));
      const januaryWind = mean(forecastDailyMeans(1, "WIND_KPH", 60));
      const julyWind = mean(forecastDailyMeans(7, "WIND_KPH", 60));

      expect(januaryTemp).toBeLessThan(julyTemp - 15);
      expect(januaryCloud).toBeGreaterThan(julyCloud + 20);
      expect(januaryWind).toBeGreaterThan(julyWind + 1);
    });

    it("carries each month's own year to year variability into the forecast", () => {
      // January swings roughly eight times as much as July in the fixture, and the forecast has
      // to reproduce that rather than applying one nudge to every month alike -- which is what
      // the old fixed plus or minus 4C did
      const januarySpread = standardDeviation(
        forecastDailyMeans(1, "TEMP_C", 200),
      );
      const julySpread = standardDeviation(
        forecastDailyMeans(7, "TEMP_C", 200),
      );

      // The fixture's own spread is the wave's standard deviation times the month's multiplier
      const expected = (month: number) =>
        tempSpreadC(month) *
        standardDeviation(
          Array.from({ length: FIXTURE_YEARS }, (_, y) => yearWave(y)),
        );
      expect(januarySpread).toBeGreaterThan(0.5 * expected(1));
      expect(januarySpread).toBeLessThan(2 * expected(1));
      expect(julySpread).toBeGreaterThan(0.5 * expected(7));
      expect(julySpread).toBeLessThan(2 * expected(7));
      expect(januarySpread).toBeGreaterThan(3 * julySpread);
    });
  });

  describe("emissions", () => {
    it("returns the record's own weather to a player who emits nothing", () => {
      const clean = getWeather(
        dateAt(monthIndex(FIXTURE_YEARS, 3), 14),
        SEED,
        0,
      );
      initWeatherFromRows("PIT", fixtureRows());
      const unspecified = getWeather(
        dateAt(monthIndex(FIXTURE_YEARS, 3), 14),
        SEED,
      );
      expect(clean).toEqual(unspecified);
      // ...including on historic rows, which are read straight from the CSV
      expect(getWeather(dateAt(3, 10), SEED, 0)).toEqual(fixtureRow(0, 3, 10));
    });

    it("warms the weather in proportion to what the player has emitted", () => {
      const clean = mean(forecastDailyMeans(7, "TEMP_C", 40, 0));
      const dirty = mean(forecastDailyMeans(7, "TEMP_C", 40, 80));
      const filthy = mean(forecastDailyMeans(7, "TEMP_C", 40, 400));

      expect(dirty).toBeGreaterThan(clean + 1);
      expect(filthy).toBeGreaterThan(dirty);
    });

    it("saturates rather than running away", () => {
      const clean = mean(forecastDailyMeans(7, "TEMP_C", 40, 0));
      const warming = (megatons: number) =>
        mean(forecastDailyMeans(7, "TEMP_C", 40, megatons)) - clean;

      // Ten times the emissions is nowhere near ten times the warming, and nothing exceeds the cap
      expect(warming(800)).toBeLessThan(5 * warming(80));
      expect(warming(100000)).toBeLessThan(3.01);
    });

    it("widens the gap between the hot hours and the cold ones", () => {
      const spreadWithin = (cumulativeMegatons: number) => {
        const readings = [];
        for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
          readings.push(
            getWeather(
              dateAt(monthIndex(FIXTURE_YEARS, 7), hour),
              SEED,
              cumulativeMegatons,
            ).TEMP_C,
          );
        }
        return Math.max(...readings) - Math.min(...readings);
      };

      expect(spreadWithin(400)).toBeGreaterThan(spreadWithin(0));
    });

    it("applies to historic weather too, so pre-2020 scenarios still respond", () => {
      const clean = getWeather(dateAt(3, 14), SEED, 0).TEMP_C;
      const dirty = getWeather(dateAt(3, 14), SEED, 200).TEMP_C;
      expect(dirty).toBeGreaterThan(clean);
    });

    it("keeps forced readings inside their physical bounds", () => {
      for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
        for (let hour = 0; hour < HOURS_PER_MONTH; hour++) {
          const forced = getWeather(
            dateAt(monthIndex(FIXTURE_YEARS + 5, month), hour),
            SEED,
            100000,
          );
          expect(forced.CLOUD_PCT).toBeGreaterThanOrEqual(0);
          expect(forced.CLOUD_PCT).toBeLessThanOrEqual(100);
          expect(forced.WIND_KPH).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(forced.TEMP_C)).toBe(true);
        }
      }
    });
  });
});
