import {INFLATION} from '../Constants';
import {DateType, FuelPricesType} from '../Types';

// GOOGLE SHEET: https://docs.google.com/spreadsheets/d/1IFc_5NOuU-y0pJGml1IBd2HlKV8unhgIpnhZQmsMCs4/edit#gid=0
// Sources: (all prices real / in that year's $'s, per million BTU)

// Coal: lignite https://www.eia.gov/totalenergy/data/annual/xls/stb0709.xls
// ^^ 1949 - 2011, whole years only

// Natural gas: https://www.eia.gov/dnav/ng/hist/n3020us3M.htm
// ^^ 2019 - 1983, whole years only

// Uranium: https://www.eia.gov/uranium/marketing/html/summarytable1b.php
  // 35Bbtu / lb - https://smartenergy.illinois.edu/energy-efficiency-basics/energy-concepts-and-terms

// Oil: imported crude oil prices https://www.eia.gov/outlooks/steo/realprices/

const Papa = require('papaparse');

interface RawFuelPricesType {
  month: number;
  year: number;
  naturalgas: number;
  coal: number;
  uranium: number;
  oil: number;
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
      fuelPrices[+data.year] = fuelPrices[+data.year] || {};
      fuelPrices[+data.year][+data.month] = {
        'Natural Gas': +data.naturalgas,
        'Coal': +data.coal,
        'Uranium': +data.uranium,
        'Oil': +data.oil,
      };
    },
    complete() {
      if (callback) {
        callback();
      }
    },
  });
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
function getRandomArbitrary(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

// Returns fuel prices per MBTU (UNITS!!!)
export function getFuelPricesPerMBTU(date: DateType): FuelPricesType {
  if (fuelPrices[date.year] === undefined) {
    let referenceYear = date.year - 1;
    while (fuelPrices[referenceYear] === undefined) {
      referenceYear--;
    }
    fuelPrices[date.year] = {};
    let previous = fuelPrices[referenceYear][12];
    for (let month = 1; month <= 12; month++) {
      fuelPrices[date.year][month] = {...previous};
      Object.keys(fuelPrices[date.year][month]).forEach((fuel: string) => {
        fuelPrices[date.year][month][fuel] *= 1 + getRandomArbitrary(-0.06, 0.06 + INFLATION / 12);
      });
      previous = {...fuelPrices[date.year][month]};
    }
  }
  return fuelPrices[date.year][date.monthNumber];
}
