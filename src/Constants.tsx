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
    peakSharingImportLoss: 0.25,
    description:
      "Most forgiving: much lower game costs, very fast building, and smaller gameplay penalties from outages.",
  },
  Employee: {
    buildCost: 0.7,
    expensesOM: 0.7,
    buildTime: 0.3,
    blackoutPenalty: 4,
    peakSharingImportLoss: 0.3,
    description:
      "Forgiving: lower game costs, faster building, and smaller gameplay penalties from outages.",
  },
  Manager: {
    buildCost: 0.8,
    expensesOM: 0.8,
    buildTime: 0.5,
    blackoutPenalty: 6,
    peakSharingImportLoss: 0.375,
    description:
      "Balanced: some help with game costs, building time, and outage penalties.",
  },
  VP: {
    buildCost: 0.9,
    expensesOM: 0.9,
    buildTime: 0.7,
    blackoutPenalty: 8,
    peakSharingImportLoss: 0.45,
    description: "Demanding: a little help with game costs and building time.",
  },
  CEO: {
    buildCost: 1,
    expensesOM: 1,
    buildTime: 1,
    blackoutPenalty: 10,
    peakSharingImportLoss: 0.5,
    description:
      "Full challenge: unadjusted game costs, building times, and outage penalties.",
  },
} as { [index: string]: DifficultyMultipliersType };

export const DIFFICULTY_LABELS: Record<string, string> = {
  Intern: "Beginner",
  Employee: "Easy",
  Manager: "Medium",
  VP: "Hard",
  CEO: "Expert",
};

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
    watershedId: "AlleghenyUpper",
    watershedName: "Upper Allegheny watershed",
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
    watershedId: "CAMountains",
    watershedName: "Sierra Nevada watershed",
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
  // Echo Summit stands in for the snow-fed Sierra headwaters supplying California hydro.
  CAMountains: {
    id: "CAMountains",
    name: "Echo Summit, CA",
    lat: 38.93,
    long: -120.03,
    timeZone: "America/Los_Angeles",
    region: "North America",
    country: "United States",
    admin: "CA",
    watershedId: "CAMountains",
    watershedName: "Sierra Nevada watershed",
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
} as { [id: string]: LocationType };
export const EQUATOR_RADIANCE = 1000; // at sea level, equator, clear day, noon https://en.wikipedia.org/wiki/Solar_irradiance

// How long between each simulated frame. FAST and ULTRA divide evenly into both 60 and 120 Hz
// display frames (one or two ticks per frame), so neither stutters the way a 10 ms step did.
// ULTRA is only offered on desktop-sized screens.
export const TICK_MS = {
  PAUSED: 250, // pause doesn't actually simulate frames, this is just for setTimeout timers
  SLOW: 200,
  NORMAL: 60,
  FAST: 1000 / 60,
  ULTRA: 1000 / 120,
};

// Fallbacks for the screens that run before any economic data has been loaded, and the anchor
// the projected cycles rest near. The played game reads its rates from data/Economy instead.
export const INFLATION = 0.03;
export const ORGANIC_GROWTH_MAX_ANNUAL = 0.015; // Includes organic / non-blackout attrition; Duke Energy grew 1.6% from 2018 to 2019
export const DOWNPAYMENT_PERCENT = 0.2;
export const INTEREST_RATE_YEARLY = 0.04;
export const LOAN_MONTHS = 30 * 12;

// Embodied emissions from building one watt of interconnector, for a corridor priced like the
// reference below. The authored corridors carry no route length, so cost per watt stands in for
// how far and how hard the route is -- but only with the exponent below, never linearly: a third
// to a half of transmission capex is right of way, permitting, legal and engineering work that
// emits almost nothing, and that share is exactly what grows on the expensive routes.
// See docs/construction-emissions.md.
export const INTERTIE_CONSTRUCTION_KGCO2E_PER_W = 0.08;
// $560k per MW, which is the Desert connection, the reference this scale is anchored on.
export const INTERTIE_CONSTRUCTION_REFERENCE_COST_PER_W = 0.56;
export const INTERTIE_CONSTRUCTION_COST_EXPONENT = 0.7;
// Reinforcing a standing corridor reuses its towers, foundations and cleared route, which are
// over half of a new line's embodied emissions. Deliberately mild, because the authored costs
// already price existing routes about a third below new ones; the full structural discount
// applied on top of that would count the same saving twice.
export const INTERTIE_CONSTRUCTION_EXISTING_MULTIPLIER = 0.7;

// Capacity added to a standing line, as a multiple of what it carries now. Reconductoring with
// advanced conductors -- the commonest real upgrade -- roughly doubles a line on its existing
// towers, while uprating an HVDC converter typically buys 1.1-1.3x. This sits between them.
export const INTERTIE_UPGRADE_STEP = 1.5;
// Three times, and then the corridor is full. The first upgrade restrings the conductor, the
// second hangs a second circuit or lifts the voltage, and the third rebuilds the structures for
// something close to the price of a new line. Past that the limit stops being the conductor and
// becomes the width of the right of way and the substation land at either end, neither of which
// a player can buy their way out of. 1.5^3 is a 3.4x corridor, which is where real ones top out.
export const MAX_INTERTIE_UPGRADES = 3;
// Each upgrade costs this share of what the same added capacity would cost as a new corridor.
// Reconductoring runs about half of new build for the capacity it adds, because the towers,
// foundations and right of way are already there. The escalation is the work changing: conductor,
// then steel, then substations.
export const INTERTIE_UPGRADE_COST_SHARE = 0.5;
export const INTERTIE_UPGRADE_COST_ESCALATION = [1, 1.6, 2.8];
// Upgrades skip the routing and land acquisition a new corridor needs, so they are quicker as
// well as cheaper. Applied to the corridor's own authored schedule.
export const INTERTIE_UPGRADE_TIME_SHARE = 0.45;
// Transmission operating cost is mostly proportional to route length, not to what the line
// carries: the same towers get inspected and the same corridor gets mowed whether the conductor
// is at half load or full. Only the terminal equipment really scales with capacity, so O&M grows
// far slower than the rating does. This is what makes upgrading cheaper to run than building
// alongside, which is the real-world incentive behind reconductoring.
export const INTERTIE_UPGRADE_OPEX_EXPONENT = 0.3;

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
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const YEARS_PER_TICK = TICK_MINUTES / (DAYS_PER_YEAR * 1440);

export const INIT_DELAY = {
  LOAD_AUDIO_MILLIS: 2000,
};

// Operating combustion CO2, stored under the legacy CO2e field name (CO2 has GWP 1).
// Excludes upstream methane, construction, regrowth credits and other lifecycle effects.
// Coal is modeled as bituminous; geothermal as zero-venting/binary cycle.
// https://www.eia.gov/electricity/annual/table.php?t=epa_a_03.html
export const FUELS = {
  Coal: {
    kgCO2ePerBtu: 0.00009324, // Bituminous coal: 93.24 kg CO2/MMBtu.
  },
  Biomass: {
    // 195 lb CO2/MMBtu for biomass, converted to kg/Btu. This is direct combustion CO2:
    // net biogenic emissions depend on the feedstock and regrowth and cannot be assumed zero.
    // https://www.eia.gov/outlooks/capitalcost/pdf/updated_capcost.pdf
    kgCO2ePerBtu: 0.000088451,
  },
  "Natural Gas": {
    kgCO2ePerBtu: 0.00005291, // Natural gas: 52.91 kg CO2/MMBtu.
  },
  Uranium: {
    kgCO2ePerBtu: 0,
  },
  Oil: {
    // EIA distillate fuel oil: 74.14 kg CO2/MMBtu, converted to kg/Btu.
    // https://www.eia.gov/electricity/annual/table.php?t=epa_a_03.html
    kgCO2ePerBtu: 0.00007414,
  },
  Geothermal: {
    kgCO2ePerBtu: 0,
  },
  Hydro: {
    kgCO2ePerBtu: 0,
  },
} as { [fuel: string]: FuelType };

export const NAV_CARDS = ["FACILITIES", "INSIGHTS", "EVENTS"] as CardNameType[];
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
