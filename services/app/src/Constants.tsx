import {CardNameType, FuelType, GameStateType, GeneratorShoppingType, MonthType} from './Types';

export const TICK_MS = {
  SLOW: 80,
  NORMAL: 40,
  FAST: 1,
};
export const GENERATOR_SELL_MULTIPLIER = 0.5;
export const TICK_MINUTES = 15;
export const DAYS_PER_MONTH = 1;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * 12;
export const STARTING_YEAR = 1990;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'] as MonthType[];
export const YEARS_PER_TICK = TICK_MINUTES / (DAYS_PER_YEAR * 1440);

export const UNSUPPORTED_BROWSERS = /^(.*amazon silk.*)|(.*(iphone|ipad|ipod|ios) os 9_.*)$/i;

export const URLS = {
  // lowercase to match lowercase platform names
  android: 'TODO',
  ios: 'TODO',
  web: 'http://electrifygame.com',
};

export const INIT_DELAY = {
  LOAD_AUDIO_MILLIS: 2000,
};

// TODO additional sources of information
// Lifetime GHG for all fuels: https://en.wikipedia.org/wiki/Life-cycle_greenhouse-gas_emissions_of_energy_sources

export const FUELS = {
  // ~31kJ/g - https://hypertextbook.com/facts/2006/LunChen.shtml
  // Thus 1GJ = 32kg
  // Historic price per short ton (907kg): https://www.eia.gov/energyexplained/coal/prices-and-outlook.php
  // Just CO2 emission per MBTu (215lb/1.05GJ): https://www.eia.gov/tools/faqs/faq.php?id=73&t=11
  'Coal': {
    costPerBtu: 0.0000017, // pretty even 2000-2018
    kgCO2ePerBtu: 0.000098,
  },

  // ~1030Btu/cf https://www.eia.gov/todayinenergy/detail.php?id=18371
  // Thus 1GJ = .92cf
  // Historic price per thousand cf: https://www.eia.gov/dnav/ng/hist/n3035us3m.htm
    // California about national average, but does vary by location: http://www.ppinys.org/reports/jtf2004/naturalgas.htm
  // Natural gas has a large methane component, not just CO2 https://www.epa.gov/sites/production/files/2018-01/documents/2018_executive_summary.pdf
  // 15lbs CO2e per 100cf http://www.co2list.org/files/carbon.htm
  'Natural Gas': {
    costPerBtu: 0.0000000049, // Between 2000 and 2018, sometimes spiked to 3x price - using $5/1k cf avg here, ranges $4-12
    kgCO2ePerBtu: 0.000000066,
  },

  // TODO  - once I do oil, check to see whether it's closer to natural gas or coal, one of those is off by ~2 orders
  // TODO sanity check vs fuel costs here - https://www.eia.gov/electricity/annual/html/epa_08_04.html
  'Oil': {
    costPerBtu: 999,
    kgCO2ePerBtu: 999,
  },

  // TODO
  'Uranium': {
    costPerBtu: 999,
    kgCO2ePerBtu: 999,
  },

  // TODO https://www.planete-energies.com/en/medias/close/incineration-heating-power-refuse
  'Trash': {
    costPerBtu: 999,
    kgCO2ePerBtu: 999,
  },
} as { [fuel: string]: FuelType };

// TODO additional sources of inforomation
// Generator construction cost changes over time - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table2.xls
// Output is sorted lowest cost first (TODO let user choose sort)
export function GENERATORS(state: GameStateType, peakW: number) {
  return [
    // FUELED
    {
      name: 'Coal',
      fuel: 'Coal',
      description: 'Dirty, but cheap for dispatchable',
      buildCost: 376000000 + 2.6 * peakW, // TODO update to factor in cost growth over time (this is 2008 cost)
        // ~$3500/kw in 2008 - https://schlissel-technical.com/docs/reports_35.pdf
        // $3,500 to $5,000 in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // 591 plants in the US in 2019 - https://docs.google.com/spreadsheets/d/1JKJJa-jwK6YpkEQKP2bcENHR2yoS40ur8baQnIXHtIU/edit#gid=0
        // With 254,332 MW capacity - https://docs.google.com/spreadsheets/d/1W-gobEQugqTR_PP0iczJCrdaR-vYkJ0DzztSsCJXuKw/edit#gid=0
        // Thus 2019 avg plant is 430 MW and cost $1.5b
        // 1/4 fixed = $376m, 3/4 variable = $2.6/w
      peakW,
      btuPerW: 10.5,
        // steady, increasing ~0.1%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
        // Can be 20% lower depending on tech https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      spinMinutes: 60,
      annualOperatingCost: 0.05 * peakW,
        // ~$0.01/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
        // ~$0.05/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      priority: 3,
      yearsToBuild: 4,
        // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    },
    {
      name: 'Nuclear',
      fuel: 'Uranium',
      description: 'Consistent and no air pollution, but expensive',
      buildCost: 1500000000 + 4.5 * peakW,
        // $6,000/kw in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // 98 reactors with 100GW of capacity - https://en.wikipedia.org/wiki/Nuclear_power_in_the_United_States
        // Thus 2019 avg plant is ~1GW and cost $6b
        // 1/4 fixed = $1.5b, 3/4 variable = $4.5/w
      peakW,
      btuPerW: 10.5,
        // steady - https://www.eia.gov/electricity/annual/html/epa_08_01.html
      spinMinutes: 600,
      annualOperatingCost: 0.1 * peakW,
        // ~$0.0168/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
        // ~$0.1/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      priority: 2,
      yearsToBuild: 6,
        // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    },
    // {
    //   name: 'Oil', // Aka petroleum
    //   fuel: 'Oil',
    //   description: 'Dispatchable, but fuel prices swing',
    //   buildCost: 200000000,
      // 1,087 plants in 2018 - https://www.eia.gov/electricity/annual/html/epa_04_01.html
      // 40 GW in 2019 ("fuel oil") - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
    //   peakW,
    //   btuPerW: 11,
    //     // varies by ~1%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
    //   spinMinutes: 10,
    //   annualOperatingCost: 1000000, // TODO make variable
    //     // about 0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    //   priority: 5,
    //   yearsToBuild: 2,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    // },
    {
      name: 'Natural Gas',
      fuel: 'Natural Gas',
      description: 'Dispatchable and cleaner than coal',
      buildCost: 71000000 + 0.75 * peakW,
        // ~$1,000/kw in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // 1,854 plants in 2018 - https://www.eia.gov/electricity/annual/html/epa_04_01.html
        // 528GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
        // Thus 2018/9 avg plant is 284MW and cost $284M
        // 1/4 fixed = $71m, 3/4 variable = $0.75/w
      peakW,
      btuPerW: 7.8,
        // steadily declining ~0.5%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
        // varies by up to 40% based on tech - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      spinMinutes: 10,
      annualOperatingCost: 0.01 * peakW,
        // ~$0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
        // ~$0.01/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // varies by up to 3x based on tech - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      priority: 4,
      yearsToBuild: 3,
        // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    },
    // {
    //   name: 'Trash Incinerator',
    //   fuel: 'Trash',
    //   description: 'Good substitute for coal when there\'s trash nearby',
    //   buildCost: 200000000,
    //   peakW,
    //   btuPerW: 14, // ~20-25% efficiency https://www.planete-energies.com/en/medias/close/incineration-heating-power-refuse
    //   spinMinutes: 60,
    //   annualOperatingCost: 1000000, // about 0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    //   priority: 4,
    //   yearsToBuild: 1,
    // },

    // RENEWABLE
    {
      name: 'Wind',
      fuel: 'Wind',
      description: 'Blows strongest at night',
      buildCost: 43000000 + 1.4 * peakW,
        // ~$1,900/kw in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // 95GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
        // Added in 2017: 64 generators, 5.8GW total - https://www.eia.gov/electricity/generatorcosts/
        // Thus 2017 new avg plant is 90MW and cost $172m
        // 1/4 fixed = $43m, 3/4 variable = $1.4/w
      peakW,
      annualOperatingCost: 0.04 * peakW,
        // ~$0.04/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      priority: 1,
      yearsToBuild: 3,
        // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    },
    {
      name: 'Solar',
      fuel: 'Sun',
      description: 'Produces during the day, more during the summer',
      buildCost: 3900000 + 1.275 * peakW,
        // ~$1,700/kw in 2020 for fixed tilt - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
        // 36GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
        // Added in 2017: 541 generators, 5GW total - https://www.eia.gov/electricity/generatorcosts/
        // Thus 2017 new avg plant is 9.2MW and cost $15.6m
        // 1/4 fixed = $3.9m, 3/4 variable = $1.275/w
      peakW,
      annualOperatingCost: 0.023 * peakW,
        // ~$0.023/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // ~$0.025/wy in 2018 - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      priority: 1,
      yearsToBuild: 2,
        // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    },
    // {
    //   name: 'Tidal',
    //   fuel: 'Tides',
    //   description: 'Stable output except 4 times per day',
    //   buildCost: 200000000,
    //   peakW,
    //   annualOperatingCost: 1000000,
    //   priority: 1,
    //   yearsToBuild: 1,
    // },
    // {
        // Still only has a capacity factor of .733, why? https://en.wikipedia.org/wiki/Electricity_sector_of_the_United_States#Renewable_energy
    //   name: 'Geothermal',
    //   fuel: 'Ground Heat',
    //   description: 'Cheap and always on, but limited location options',
    //   buildCost: 200000000,
    //   peakW,
    //   annualOperatingCost: 1000000,
    //   priority: 1,
    //   yearsToBuild: 4,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    // },
    // {
    //   name: 'Hydro',
    //   fuel: 'Rain',
    //   description: 'Clean, cheap and dispatchable - until there\'s a drought',
    //   buildCost: 200000000,
      // 1,458 plants in 2018 - https://www.eia.gov/electricity/annual/html/epa_04_01.html
      // 100GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
    //   peakW,
    //   spinMinutes: 1,
    //   annualOperatingCost: 1000000, // about 0.0017/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    //   priority: 3,
    //   yearsToBuild: 4,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    // },
  ].sort((a, b) => a.buildCost > b.buildCost ? 1 : -1) as GeneratorShoppingType[];
}

export const NAV_CARDS = ['GENERATORS', 'STORAGE', 'FINANCES'] as CardNameType[];
export const CARD_TRANSITION_ANIMATION_MS = 300;
export const VIBRATION_SHORT_MS = 30; // for navigation / card changes
export const VIBRATION_LONG_MS = 400; // for unique events, like start of the timer
export const NAVIGATION_DEBOUNCE_MS = 600;
export const DOUBLE_TAP_MS = 500; // Maximum ms between tap / clicks to count as a double click
export const AUDIO_COMMAND_DEBOUNCE_MS = 300;
export const MUSIC_INTENSITY_MAX = 36;

export interface MusicDefinition {
  baselineInstruments: string[];
  bpm: number;
  directory: string;
  instruments: string[];
  loopMs: number;
  maxIntensity: number;
  minIntensity: number;
  peakingInstrument: string;
  variants: number;
}

export const MUSIC_DEFINITIONS: {[key: string]: {[key: string]: MusicDefinition}} = {
  combat: {
    heavy: {
      baselineInstruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings'],
      bpm: 140,
      directory: 'combat/heavy/',
      instruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings', 'HighBrass'],
      loopMs: 13712,
      maxIntensity: MUSIC_INTENSITY_MAX,
      minIntensity: 12,
      peakingInstrument: 'HighBrass',
      variants: 6,
    },
    light: {
      // peakingInstrument always at the end
      baselineInstruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings'],
      bpm: 120,
      directory: 'combat/light/',
      instruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings', 'HighBrass'],
      loopMs: 8000,
      maxIntensity: 24,
      minIntensity: 0,
      peakingInstrument: 'HighBrass',
      variants: 12,
    },
  },
};

export const MUSIC_FADE_SECONDS = 1.5;
