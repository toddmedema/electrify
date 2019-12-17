import {RawWeatherType} from 'app/Types';

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

function downloadWeather(location: string) {
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
      console.log('Weather downloaded for ' + location);
    },
  });
}

// TODO download weather with a 1s init delay, like loading audio
// But only if worker: true starts working - TICKET: https://github.com/mholt/PapaParse/issues/753
export function getWeather(location: string, hourOfYear: number): RawWeatherType {
  if (!weather[location]) {
    downloadWeather(location);
    return DUMMY_WEATHER;
  } else {
    return weather[location][hourOfYear] || DUMMY_WEATHER;
  }
}
