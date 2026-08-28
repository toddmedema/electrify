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
    description:
      "Easiest: 40% cheaper facilities, 40% lower operating costs, 80% faster construction, and blackouts cost you the least growth.",
  },
  Employee: {
    buildCost: 0.7,
    expensesOM: 0.7,
    buildTime: 0.3,
    blackoutPenalty: 4,
    description:
      "Easy: 30% cheaper facilities, 30% lower operating costs, 70% faster construction, and lighter blackout penalties.",
  },
  Manager: {
    buildCost: 0.8,
    expensesOM: 0.8,
    buildTime: 0.5,
    blackoutPenalty: 6,
    description:
      "Medium: 20% cheaper facilities, 20% lower operating costs, 50% faster construction, and moderate blackout penalties.",
  },
  VP: {
    buildCost: 0.9,
    expensesOM: 0.9,
    buildTime: 0.7,
    blackoutPenalty: 8,
    description:
      "Hard: 10% cheaper facilities, 10% lower operating costs, 30% faster construction, and heavier blackout penalties.",
  },
  CEO: {
    buildCost: 1,
    expensesOM: 1,
    buildTime: 1,
    blackoutPenalty: 10,
    description:
      "Hardest: full-price facilities, full-price operations, full construction time, and the harshest blackout penalties.",
  },
} as { [index: string]: DifficultyMultipliersType };

export const LOCATIONS = {
  PIT: {
    id: "PIT",
    name: "Pittsburgh, PA",
    lat: 40.4406,
    long: -79.9959,
    timeZone: "America/New_York",
    region: "North America",
    country: "United States",
    admin: "PA",
    resources: { hydro: true },
  },
  SF: {
    id: "SF",
    name: "San Francisco, CA",
    lat: 37.7749,
    long: -122.4194,
    timeZone: "America/Los_Angeles",
    region: "North America",
    country: "United States",
    admin: "CA",
    offshore: true,
    resources: { geothermal: true, hydro: true },
  },
  LA: {
    id: "LA",
    name: "Los Angeles, CA",
    lat: 34.0522,
    long: -118.2437,
    timeZone: "America/Los_Angeles",
    region: "North America",
    country: "United States",
    admin: "CA",
    offshore: true,
    resources: { geothermal: true },
  },
  // Named for where its data was read as coming from, back when it was a CSV of unknown
  // provenance. It now genuinely is the Santa Cruz Mountains: every location is fetched from
  // these coordinates, so the name and the weather can no longer disagree
  CAMountains: {
    id: "CAMountains",
    name: "Santa Cruz Mountains, CA",
    lat: 37.1041,
    long: -122.0308,
    timeZone: "America/Los_Angeles",
    region: "North America",
    country: "United States",
    admin: "CA",
    resources: { geothermal: true, hydro: true },
  },
  HNL: {
    id: "HNL",
    name: "Honolulu, HI",
    lat: 21.3099,
    long: -157.8581,
    timeZone: "Pacific/Honolulu",
    region: "North America",
    country: "United States",
    admin: "HI",
    offshore: true,
    resources: { geothermal: true },
  },
  SJU: {
    id: "SJU",
    name: "San Juan, Puerto Rico",
    lat: 18.4671,
    long: -66.1185,
    timeZone: "America/Puerto_Rico",
    region: "North America",
    country: "United States",
    admin: "Puerto Rico",
    offshore: true,
    resources: { hydro: true },
  },
} as { [id: string]: LocationType & { admin?: string } };
export const OUTSKIRTS_WIND_MULTIPLIER = 2; // https://github.com/toddmedema/electrify/issues/96
export const EQUATOR_RADIANCE = 1000; // at sea level, equator, clear day, noon https://en.wikipedia.org/wiki/Solar_irradiance

// How long between each simulated frame
export const TICK_MS = {
  PAUSED: 250, // pause doesn't actually simulate frames, this is just for setTimeout timers
  SLOW: 200,
  NORMAL: 60,
  FAST: 10,
};

// Fallbacks for the screens that run before any economic data has been loaded, and the anchor
// the projected cycles rest near. The played game reads its rates from data/Economy instead.
export const INFLATION = 0.03;
export const ORGANIC_GROWTH_MAX_ANNUAL = 0.015; // Includes organic / non-blackout attrition; Duke Energy grew 1.6% 2018 -> 2019, and that's with some marketing spending
export const RESERVE_MARGIN = 0.05;
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
  Geothermal: {
    kgCO2ePerBtu: 0,
  },
  Hydro: {
    kgCO2ePerBtu: 0,
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
  "EVENTS",
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
