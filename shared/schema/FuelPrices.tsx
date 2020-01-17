import {DateType, FuelPricesType} from 'app/Types';

// GOOGLE SHEET: https://docs.google.com/spreadsheets/d/1IFc_5NOuU-y0pJGml1IBd2HlKV8unhgIpnhZQmsMCs4/edit#gid=0
// Sources: (all prices real / in that year's $'s)
// Coal: lignite https://www.eia.gov/totalenergy/data/annual/xls/stb0709.xls
// ^^ 1949 - 2011
// Natural gas: https://www.eia.gov/dnav/ng/hist/n3020us3M.htm
// ^^ 2019 - 1983
// Uranium: https://www.eia.gov/uranium/marketing/html/summarytable1b.php

const Papa = require('papaparse');

interface RawFuelPricesType {
  month: number;
  year: number;
  naturalgas: number;
  coal: number;
  uranium: number;
}

const fuelPrices = {} as any;

export function initFuelPrices(callback?: any) {
  Papa.parse(`/data/FuelPricesRaw.csv`, {
    download: true,
    dynamicTyping: true,
    header: true,
    // worker: true,
    step(row: any) {
      const data = row.data as RawFuelPricesType;
      fuelPrices[data.year] = fuelPrices[data.year] || {};
      fuelPrices[data.year][data.month] = {
        'Natural Gas': data.naturalgas,
        'Coal': data.coal,
        'Uranium': data.uranium,
      };
    },
    complete() {
      if (callback) {
        callback();
      }
    },
  });
}

export function getFuelPrices(date: DateType): FuelPricesType {
  return (fuelPrices[date.year] || {})[date.monthNumber] || {};
}
