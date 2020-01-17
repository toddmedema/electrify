import {DateType, FuelPricesType} from 'app/Types';

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
