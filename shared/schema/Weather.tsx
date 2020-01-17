import {DateType, RawWeatherType} from 'app/Types';

const Papa = require('papaparse');

const weather = {} as any;

const DUMMY_WEATHER = {
  COOLING_HRS: 0,
  HEATING_HRS: 0,
  TEMP_C: 0,
  CLOUD_PCT_NO: 1,
  CLOUD_PCT_FEW: 0,
  CLOUD_PCT_ALL: 0,
  WIND_KPH: 10,
  WIND_PCT_CALM: 50,
};

export function initWeather(location: string, callback?: any) {
  weather[location] = new Array(8760); // Perf optimization: initialize at expected length
  let rowNumber = 0;
  Papa.parse(`/data/WeatherRaw${location}.csv`, {
    download: true,
    dynamicTyping: true,
    header: true,
    // worker: true,
    step(row: any) {
      weather[location][rowNumber++] = row.data as RawWeatherType;
    },
    complete() {
      if (callback) {
        callback();
      }
    },
  });
}

// TODO download weather with a 1s init delay, like loading audio
// But only if worker: true starts working - TICKET: https://github.com/mholt/PapaParse/issues/753
export function getWeather(location: string, hourOfYear: number): RawWeatherType {
  return weather[location][hourOfYear] || DUMMY_WEATHER;
}

// 0-1, percent of sun's energy hitting a unit of land relative to max
// Is later multiplied by cloudiness
// TODO change to watts per sq meter or some fixed value, and verify that it's returning reasonably accurate values per location and season
// (hoping that day length alone is a sufficient proxy / ideally don't need to make it any more complex)
export function getRawSunlightPercent(date: DateType) {
  if (date.minuteOfDay >= date.sunrise && date.minuteOfDay <= date.sunset) {
    const minutesFromDark = Math.min(date.minuteOfDay - date.sunrise, date.sunset - date.minuteOfDay);
    // TODO fix the pointiness, esp in shorter winter months
    // Maybe by factoring in day lenght to determine the shape of the curve?

    // Day length / minutes from dark used as proxy for season / max sun height
    // Rough approximation of solar output: https://www.wolframalpha.com/input/?i=plot+1%2F%281+%2B+e+%5E+%28-0.015+*+%28x+-+260%29%29%29+from+0+to+420
    // Solar panels generally follow a Bell curve
    return 1 / (1 + Math.pow(Math.E, (-0.015 * (minutesFromDark - 260))));
  }
  return 0;
}
