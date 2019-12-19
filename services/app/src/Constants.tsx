import {CardNameType, FuelType, GeneratorShoppingType, MonthType} from './Types';

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

// TODO fuel consumption btu = currentW * btuPerW
// then cost and co2 = btu * cost / co2ePerBtu

export const GENERATORS = [
  // FUELED
  {
    name: 'Coal',
    fuel: 'Coal',
    description: 'Dirty, but cheap for dispatchable',
    buildCost: 20000000,
      // Est $3.5k/w https://schlissel-technical.com/docs/reports_35.pdf
    peakW: 200000000,
    btuPerW: 10.5, // steady, increasing ~0.1%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
    spinMinutes: 60,
    annualOperatingCost: 1500000, // about 0.01/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    priority: 3,
    yearsToBuild: 1,
  },
  {
    name: 'Nuclear',
    fuel: 'Uranium',
    description: 'Tons of power, but hard to turn off',
    buildCost: 200000000,
    peakW: 200000000,
    btuPerW: 10.5, // steady - https://www.eia.gov/electricity/annual/html/epa_08_01.html
    spinMinutes: 600,
    annualOperatingCost: 1000000, // about 0.0168/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    priority: 2,
    yearsToBuild: 5,
  },
  {
    name: 'Oil',
    fuel: 'Oil',
    description: 'Dispatchable, but fuel prices swing',
    buildCost: 20000000,
    peakW: 200000000,
    btuPerW: 11, // varies by ~1%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
    spinMinutes: 10,
    annualOperatingCost: 1000000, // about 0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    priority: 5,
    yearsToBuild: 1,
  },
  {
    name: 'Natural Gas',
    fuel: 'Natural Gas',
    description: 'Dispatchable and cleaner than coal',
    buildCost: 20000000,
    peakW: 200000000,
    btuPerW: 7.8, // steadily declining ~0.5%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
    spinMinutes: 10,
    annualOperatingCost: 1000000, // about 0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    priority: 4,
    yearsToBuild: 1,
  },
  {
    name: 'Trash Incinerator',
    fuel: 'Trash',
    description: 'Good substitute for coal when there\'s trash nearby',
    buildCost: 20000000,
    peakW: 200000000,
    btuPerW: 14, // ~20-25% efficiency https://www.planete-energies.com/en/medias/close/incineration-heating-power-refuse
    spinMinutes: 60,
    annualOperatingCost: 1000000, // about 0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    priority: 4,
    yearsToBuild: 1,
  },

  // RENEWABLE
  {
    name: 'Wind',
    fuel: 'Wind',
    description: 'Blows strongest at night',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 500000,
    priority: 1,
    yearsToBuild: 1,
  },
  {
    name: 'Solar',
    fuel: 'Sun',
    description: 'Produces during the day, more during the summer',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 500000,
    priority: 1,
    yearsToBuild: 1,
  },
  {
    name: 'Tidal',
    fuel: 'Tides',
    description: 'Stable output except 4 times per day',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 1000000,
    priority: 1,
    yearsToBuild: 1,
  },
  {
    name: 'Geothermal',
    fuel: 'Ground Heat',
    description: 'Cheap and always on, but limited location options',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 1000000,
    priority: 1,
    yearsToBuild: 1,
  },
  {
    name: 'Hydro',
    fuel: 'Rain',
    description: 'Clean, cheap and dispatchable - until there\'s a drought',
    buildCost: 20000000,
    peakW: 200000000,
    spinMinutes: 1,
    annualOperatingCost: 1000000, // about 0.0017/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    priority: 3,
    yearsToBuild: 1,
  },
].sort((a, b) => a.buildCost > b.buildCost ? 1 : -1) as GeneratorShoppingType[];

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
