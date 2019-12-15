import {AUTH_SETTINGS as AUTH_SETTINGS_BASE} from 'shared/schema/Constants';
import {CardNameType, GeneratorShoppingType, MonthType} from './Types';

export const TICK_MS = 30;
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
    cost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 60,
  },
  {
    name: 'Wind',
    fuel: 'Wind',
    cost: 20000000,
    peakW: 200000000,
  },
  {
    name: 'Solar',
    fuel: 'Sun',
    cost: 20000000,
    peakW: 200000000,
  },
  {
    name: 'Tidal',
    fuel: 'Tides',
    cost: 20000000,
    peakW: 200000000,
  },
  {
    name: 'Nuclear',
    fuel: 'Uranium',
    cost: 200000000,
    peakW: 200000000,
    fuelConsumption: 1,
    spinMinutes: 600,
  },
  {
    name: 'Oil',
    fuel: 'Oil',
    cost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 10,
  },
  {
    name: 'Geothermal',
    fuel: 'Ground Heat',
    cost: 20000000,
    peakW: 200000000,
  },
  {
    name: 'Hydro',
    fuel: 'Rain',
    cost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 1,
  },
  {
    name: 'Natural Gas',
    fuel: 'Natural Gas',
    cost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 10,
  },
  {
    name: 'Trash Incinerator',
    fuel: 'Trash',
    cost: 20000000,
    peakW: 200000000,
    fuelConsumption: 10,
    spinMinutes: 60,
  },
] as GeneratorShoppingType[];

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

export const NAV_CARDS = ['DEMAND', 'SUPPLY', 'FINANCES'] as CardNameType[];
