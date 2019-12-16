import {AUTH_SETTINGS as AUTH_SETTINGS_BASE} from 'shared/schema/Constants';
import {CardNameType, GeneratorShoppingType, MonthType} from './Types';

export const TICK_MS = {
  SLOW: 80,
  NORMAL: 40,
  FAST: 1,
};
export const TICK_MINUTES = 15;
export const DAYS_PER_MONTH = 1;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * 12;
export const STARTING_YEAR = 1990;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'] as MonthType[];

export const AUTH_SETTINGS = {
  ...AUTH_SETTINGS_BASE,
};

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

export const GENERATOR_SELL_MULTIPLIER = 0.5;
export const GENERATORS = [
  {
    name: 'Coal',
    fuel: 'Coal',
    description: 'Dirty, but cheap for dispatchable',
    buildCost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 60,
    annualOperatingCost: 1500000,
    priority: 3,
  },
  {
    name: 'Wind',
    fuel: 'Wind',
    description: 'Blows strongest at night',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 500000,
    priority: 1,
  },
  {
    name: 'Solar',
    fuel: 'Sun',
    description: 'Produces during the day, more during the summer',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 500000,
    priority: 1,
  },
  {
    name: 'Tidal',
    fuel: 'Tides',
    description: 'Stable output except 4 times per day',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 1000000,
    priority: 1,
  },
  {
    name: 'Nuclear',
    fuel: 'Uranium',
    description: 'Tons of power, but hard to turn off',
    buildCost: 200000000,
    peakW: 200000000,
    fuelConsumption: 1,
    spinMinutes: 600,
    annualOperatingCost: 1000000,
    priority: 2,
  },
  {
    name: 'Oil',
    fuel: 'Oil',
    description: 'Dispatchable, but fuel prices swing',
    buildCost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 10,
    annualOperatingCost: 1000000,
    priority: 5,
  },
  {
    name: 'Geothermal',
    fuel: 'Ground Heat',
    description: 'Cheap and always on, but limited location options',
    buildCost: 20000000,
    peakW: 200000000,
    annualOperatingCost: 1000000,
    priority: 1,
  },
  {
    name: 'Hydro',
    fuel: 'Rain',
    description: 'Clean, cheap and dispatchable - until there\'s a drought',
    buildCost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 1,
    annualOperatingCost: 1000000,
    priority: 3,
  },
  {
    name: 'Natural Gas',
    fuel: 'Natural Gas',
    description: 'Dispatchable and cleaner than coal',
    buildCost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 10,
    annualOperatingCost: 1000000,
    priority: 4,
  },
  {
    name: 'Trash Incinerator',
    fuel: 'Trash',
    description: 'Good substitute for coal when there\'s trash nearby',
    buildCost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 60,
    annualOperatingCost: 1000000,
    priority: 4,
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
