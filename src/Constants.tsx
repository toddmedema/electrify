import {
  CardNameType,
  DifficultyMultipliersType,
  FuelType,
  LocationType,
  MonthType,
} from "./Types";

export const DIFFICULTIES = {
  Intern: {
    buildCost: 0.6,
    expensesOM: 0.6,
    buildTime: 0.2,
    blackoutPenalty: 2,
  },
  Employee: {
    buildCost: 0.7,
    expensesOM: 0.7,
    buildTime: 0.3,
    blackoutPenalty: 4,
  },
  Manager: {
    buildCost: 0.8,
    expensesOM: 0.8,
    buildTime: 0.5,
    blackoutPenalty: 6,
  },
  VP: {
    buildCost: 0.9,
    expensesOM: 0.9,
    buildTime: 0.7,
    blackoutPenalty: 8,
  },
  CEO: {
    buildCost: 1,
    expensesOM: 1,
    buildTime: 1,
    blackoutPenalty: 10,
  },
} as { [index: string]: DifficultyMultipliersType };

export const LOCATIONS = {
  PIT: {
    id: "PIT",
    name: "Pittsburgh, PA",
    lat: 40.4406,
    long: -79.9959,
  },
  SF: {
    id: "SF",
    name: "San Fransisco, CA",
    lat: 37.7749,
    long: -122.4194,
  },
  HNL: {
    id: "HNL",
    name: "Honolulu, HI",
    lat: 21.3099,
    long: -157.8581,
  },
  SJU: {
    id: "SJU",
    name: "San Juan, Puero Rico",
    lat: 18.4671,
    long: -66.1185,
  },
} as { [id: string]: LocationType };
export const OUTSKIRTS_WIND_MULTIPLIER = 2; // https://github.com/toddmedema/electrify/issues/96
export const EQUATOR_RADIANCE = 1000; // at sea level, equator, clear day, noon https://en.wikipedia.org/wiki/Solar_irradiance

// How long between each simulated frame
export const TICK_MS = {
  PAUSED: 250, // pause doesn't actually simulate frames, this is just for setTimeout timers
  SLOW: 200,
  NORMAL: 60,
  FAST: 10,
};

export const INFLATION = 0.03;
export const ORGANIC_GROWTH_MAX_ANNUAL = 0.015; // Includes organic / non-blackout attrition; Duke Energy grew 1.6% 2018 -> 2019, and that's with some marketing spending
export const RESERVE_MARGIN = 0.05;
export const GENERATOR_SELL_MULTIPLIER = 0.5;
export const DOWNPAYMENT_PERCENT = 0.2;
export const INTEREST_RATE_YEARLY = 0.04;
export const LOAN_MONTHS = 30 * 12;

export const TICK_MINUTES = 15;
export const TICKS_PER_HOUR = 60 / TICK_MINUTES;
export const TICKS_PER_DAY = Math.ceil(1440 / TICK_MINUTES);
export const DAYS_PER_MONTH = 1;
export const TICKS_PER_MONTH = TICKS_PER_DAY / DAYS_PER_MONTH;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * 12;
export const HOURS_PER_YEAR_REAL = 24 * 365;
export const GAME_TO_REAL_YEARS = 365 / DAYS_PER_YEAR;
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as MonthType[];
export const YEARS_PER_TICK = TICK_MINUTES / (DAYS_PER_YEAR * 1440);

export const INIT_DELAY = {
  LOAD_AUDIO_MILLIS: 2000,
};

// Lifetime GHG for all fuels: https://en.wikipedia.org/wiki/Life-cycle_greenhouse-gas_emissions_of_energy_sources
export const FUELS = {
  Coal: {
    kgCO2ePerBtu: 0.000112, // https://www.epa.gov/sites/production/files/2015-08/documents/aberdeen-merged-deter-ltr.pdf
  },
  "Natural Gas": {
    kgCO2ePerBtu: 0.000068, // https://www.epa.gov/sites/production/files/2015-08/documents/aberdeen-merged-deter-ltr.pdf
  },
  Uranium: {
    kgCO2ePerBtu: 0,
  },
  Oil: {
    kgCO2ePerBtu: 0.00002031, // https://www.epa.gov/energy/greenhouse-gases-equivalencies-calculator-calculations-and-references
  },
  // TODO https://www.planete-energies.com/en/medias/close/incineration-heating-power-refuse
  // 'Trash': {
  //   kgCO2ePerBtu: 999,
  // },
} as { [fuel: string]: FuelType };

export const NAV_CARDS = [
  "FACILITIES",
  "FINANCES",
  "FORECASTS",
] as CardNameType[];
export const CARD_TRANSITION_ANIMATION_MS = 300;
export const NAVIGATION_DEBOUNCE_MS = 600;
export const DOUBLE_TAP_MS = 500; // Maximum ms between tap / clicks to count as a double click
export const AUDIO_COMMAND_DEBOUNCE_MS = 300;
export const MUSIC_INTENSITY_MAX = 10;

export interface MusicDefinition {
  directory: string;
  tracks: string[];
  durationMs: number;
  minIntensity: number;
  maxIntensity: number;
}

export const MUSIC_DEFINITIONS: { [key: string]: MusicDefinition } = {
  intro: {
    directory: "intro/",
    tracks: ["intro"],
    durationMs: 29309,
    minIntensity: 1,
    maxIntensity: 1,
  },
  basic: {
    directory: "basic/",
    tracks: ["low", "medium", "high"],
    durationMs: 392119,
    minIntensity: 0,
    maxIntensity: MUSIC_INTENSITY_MAX,
  },
};

export const MUSIC_FADE_SECONDS = 1.5;
