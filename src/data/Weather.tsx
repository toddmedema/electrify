import { DAYS_PER_MONTH, DAYS_PER_YEAR } from "../Constants";
import { DateType, RawWeatherType } from "../Types";
import { getRandomRange } from "../helpers/Math";

const Papa = require("papaparse");

const STARTING_YEAR = 1980; // for weather data, Jan 1st, assumed to be the same for all locations
const ENDING_YEAR = 2019; // for weather data, Dec 31st, assumed to be the same for all locations
const ROWS_PER_DAY = 24;
const ROWS_PER_YEAR = DAYS_PER_YEAR * ROWS_PER_DAY;
const EXPECTED_ROWS = (ENDING_YEAR - STARTING_YEAR + 1) * ROWS_PER_YEAR;

let weather = [] as any;
// Ordred oldest first
const DUMMY_WEATHER = {
  YEAR: 0,
  MONTH: 0,
  TEMP_C: 0,
  CLOUD_PCT: 0,
  WIND_KPH: 10,
};

// TODO download weather for all locations at start with a 2s init delay, like loading audio (but after audio)
// But only if worker: true starts working - TICKET: https://github.com/mholt/PapaParse/issues/753
// Ideally caching this... so maybe upgrade to use https://tanstack.com/query/latest/docs/framework/react/overview ?
export function initWeather(location: string, callback?: any) {
  weather = [] as any; // reset each time to prevent accidentally appending to old state
  Papa.parse(`/data/WeatherRaw${location}.csv`, {
    download: true,
    dynamicTyping: true,
    header: true,
    // worker: true,
    step(row: any) {
      const data = row.data as RawWeatherType;
      if (data && data.YEAR) {
        weather.push(data);
      }
    },
    complete() {
      if (weather.length !== EXPECTED_ROWS) {
        console.warn(
          `Weather data for ${location} appears to be incomplete. Found ${weather.length} rows, expected ${EXPECTED_ROWS}`,
        );
      }
      if (callback) {
        callback();
      }
    },
  });
}

export function getWeather(date: DateType): RawWeatherType {
  const minuteOfHour = date.minuteOfDay % 60;
  const yearOffset = (date.year - STARTING_YEAR) * ROWS_PER_YEAR;
  const monthOffset = (date.monthNumber - 1) * DAYS_PER_MONTH * ROWS_PER_DAY;
  const dayOffset = 0; // Only relevant if I later simulated multiple days per month
  const hourOffset = date.hourOfDay;
  const row = yearOffset + monthOffset + dayOffset + hourOffset;
  const nextRow = row + 1;

  // Forecase more weather if it doesn't exist - Simple singular check to prevent infinite looping / freezing
  if (!weather[row] || !weather[nextRow]) {
    forecastNextDay();
    return weather[row] || DUMMY_WEATHER;
  }

  // Otherwise, blend hours for smoother weather
  const prev = weather[row];
  const next = weather[nextRow];
  const prevPerc = minuteOfHour / 60;
  const nextPerc = 1 - prevPerc;
  return {
    YEAR: next.year,
    MONTH: next.month,
    TEMP_C: prev.TEMP_C * prevPerc + next.TEMP_C * nextPerc,
    CLOUD_PCT: prev.CLOUD_PCT * prevPerc + next.CLOUD_PCT * nextPerc,
    WIND_KPH: prev.WIND_KPH * prevPerc + next.WIND_KPH * nextPerc,
  };
}

// 0-1, percent of sun's energy hitting a unit of land relative to max
// Is later multiplied by cloudiness
// TODO change to watts per sq meter or some fixed value, and verify that it's returning reasonably accurate values per location and season
// (hoping that day length alone is a sufficient proxy / ideally don't need to make it any more complex)
export function getRawSunlightPercent(date: DateType) {
  if (date.minuteOfDay >= date.sunrise && date.minuteOfDay <= date.sunset) {
    const minutesFromDark = Math.min(
      date.minuteOfDay - date.sunrise,
      date.sunset - date.minuteOfDay,
    );
    // TODO fix the pointiness, esp in shorter winter months
    // Maybe by factoring in day lenght to determine the shape of the curve?

    // Day length / minutes from dark used as proxy for season / max sun height
    // Rough approximation of solar output: https://www.wolframalpha.com/input/?i=plot+1%2F%281+%2B+e+%5E+%28-0.015+*+%28x+-+260%29%29%29+from+0+to+420
    // Solar panels generally follow a Bell curve
    return 1 / (1 + Math.pow(Math.E, -0.015 * (minutesFromDark - 260)));
  }
  return 0;
}

function forecastNextDay() {
  const length = weather.length;
  // TODO factor in emissions, i.e. less vs more emissions = smaller vs larger std deviation + positive bias
  const temperatureModifier = getRandomRange(-4, 4.05);
  const windModifier = getRandomRange(-3, 3.05);
  const cloudModifier = getRandomRange(-20, 20);
  for (let row = 0; row < ROWS_PER_DAY; row++) {
    const prev = weather[length - ROWS_PER_YEAR + row];
    weather.push({
      TEMP_C: prev.TEMP_C + temperatureModifier,
      CLOUD_PCT: Math.min(100, Math.max(0, prev.CLOUD_PCT + cloudModifier)),
      WIND_KPH: Math.max(0, prev.WIND_KPH + windModifier),
    });
  }
}
