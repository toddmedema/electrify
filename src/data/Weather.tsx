import { DAYS_PER_MONTH, DAYS_PER_YEAR, EQUATOR_RADIANCE } from "../Constants";
import { DateType, RawWeatherType } from "../Types";
import { getRandomRange } from "../helpers/Math";
import { getSunriseSunset } from "../helpers/DateTime";

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

// TODO download weather for all locations at start with a 2s init delay, like loading audio (but after audio) for offline play
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
      if (weather.length < EXPECTED_ROWS) {
        console.warn(
          `Weather data for ${location} appears to be incomplete. Found ${weather.length} rows, expected ${EXPECTED_ROWS}`
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
 * @param {number} lat - The latitude of the location to calculate the irradiance for.
 * @param {number} long - The longitude of the location to calculate the irradiance for.
 * @param {number} cloudCoverPercent - The percentage of cloud cover, from 0 to 100.
 * @returns {number} - The calculated raw solar irradiance in W/m2.
 */
export function getRawSolarIrradianceWM2(
  date: DateType,
  lat: number,
  long: number,
  cloudCoverPercent: number
) {
  let irradiance = EQUATOR_RADIANCE; //* (1 - 0.007 * Math.abs(lat)); // w/m2 - redundant with day length bell curve?
  irradiance *= 1 - cloudCoverPercent / 400; // Very cloudy days = 25% reduction
  const { sunrise, sunset } = getSunriseSunset(date, lat, long);
  if (date.minuteOfDay >= sunrise && date.minuteOfDay <= sunset) {
    const minutesFromDark = Math.min(
      date.minuteOfDay - sunrise,
      sunset - date.minuteOfDay
    );
    return (
      irradiance / (1 + Math.pow(Math.E, -0.015 * (minutesFromDark - 200)))
    );
  }
  return 0;
}

function forecastNextDay() {
  const length = weather.length;
  const temperatureModifier = getRandomRange(-4, 4.05);
  const windModifier = getRandomRange(-3, 3.05);
  const cloudModifier = getRandomRange(-20, 20);
  for (let row = 0; row < ROWS_PER_DAY; row++) {
    const prev = weather[length - ROWS_PER_YEAR + row];
    weather.push({
      TEMP_C: Math.min(45, Math.max(-20, prev.TEMP_C + temperatureModifier)),
      CLOUD_PCT: Math.min(100, Math.max(0, prev.CLOUD_PCT + cloudModifier)),
      WIND_KPH: Math.max(0, prev.WIND_KPH + windModifier),
    });
  }
}
