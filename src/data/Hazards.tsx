import { LocationType, WeatherHazardProfileType } from "../Types";
import { COLD_CLIMATE_BY_LOCATION } from "./ColdClimate";

/**
 * Location exposure to damaging hail and extreme cold, plus the balance constants that turn an
 * occurrence into damage, derates, deductibles and premiums (issue #73).
 *
 * The hail rates are the expected number of storms per year with hail large enough to break
 * utility PV modules at a single site. They are rounded game balance read from published hail
 * climatologies, not a site-specific risk assessment: the ranking between places is the point,
 * and the absolute values are deliberately modest so a 20-year run usually sees zero to two
 * damaging storms even in hail alley, and none at all in most low-risk places. Flooding is out of
 * scope.
 */

const SPC =
  "NOAA SPC severe-hail report climatology 1986-2015 (>=1 in. hail), rounded game balance";
const SATELLITE =
  "NASA passive-microwave hail climatology (Cecil & Blankenship 2012; Bang & Cecil 2019), rounded game balance";
const ESSL =
  "ESSL European Severe Weather Database hail climatology, rounded game balance";
const FALLBACK = "Latitude-band fallback, rounded game balance";

/** Standard winterization every gas plant has. Below this the plant starts to lose units. */
export const STANDARD_GAS_DESIGN_MIN_TEMP_C = -8;

/**
 * The warmest threshold where regional gas supply is strained (wellhead freeze-offs, pipeline
 * pressure), by climate; a place's own rare cold lowers it further, so a shock needs cold well
 * below the local norm. Northern systems are built for deeper cold, as ERCOT's in February 2021
 * was not. Mild regions still sit well below a standard plant's rating, so a plant can trip in a
 * cold snap without the whole region's gas supply failing.
 * Source: FERC-NERC February 2021 Cold Weather Outages report (2021).
 */
export const DEFAULT_REGIONAL_COLD_THRESHOLD_C = { cold: -25, mild: -15 };

/** Hailstorm-to-site hit share: a storm swath misses some panels even within a small region. */
export const HAIL_EXPOSURE_HIT_SHARE = 0.7;
/** Largest share of one array a single storm can break; reported utility-PV losses stay partial. */
export const HAIL_MAX_DAMAGED_FRACTION = 0.6;
/** Hail-resistant arrays (thicker glass, tracker hail stow) break this share of a standard loss. */
export const HAIL_RESISTANT_DAMAGE_FACTOR = 0.3;
/** Deductible as a share of replacement value, capped at the repair cost itself. */
export const HAIL_DEDUCTIBLE_SHARE = 0.02;
/** Build-time premium for hail-resistant design. Source: DOE FEMP solar hail resilience guide. */
export const HAIL_RESISTANT_BUILD_SHARE = 0.03;
/** Retrofitting a standing array (module swaps, stow controls) costs more than building it in. */
export const HAIL_RESISTANT_RETROFIT_SHARE = 0.08;
/**
 * Annual hazard insurance loading on a solar array's replacement value at the reference hail rate.
 * Catalogue O&M already carries average insurance; this is the extra for local exposure.
 */
export const SOLAR_HAIL_INSURANCE_RATE = 0.002;
export const SOLAR_HAIL_INSURANCE_REFERENCE_PER_YEAR = 0.05;
/**
 * Insured-loss vulnerability of hail-resistant arrays relative to standard ones. Anchored on NREL
 * TP-7A40-78588's finding that hail stow and thicker glass remove most hail loss.
 */
export const HAIL_RESISTANT_INSURANCE_VULNERABILITY = 0.4;
/** Gas plants carry no weather insurance loading in v1: cold costs lost output, not assets. */
export const GAS_INSURANCE_VULNERABILITY = 0;

/** Build-time premium for a cold-weather package (heat tracing, enclosures, instrument heat). */
export const COLD_PACKAGE_BUILD_SHARE = 0.02;
/** Retrofitting winterization onto a standing plant. */
export const COLD_PACKAGE_RETROFIT_SHARE = 0.04;
/** A packaged plant is rated this far below the regional threshold, and at least to -25 C. */
export const COLD_PACKAGE_MARGIN_C = 5;
export const COLD_PACKAGE_MAX_DESIGN_MIN_TEMP_C = -25;
/** The largest share of a plant a cold snap can take out. */
export const COLD_MAX_DERATE = 0.75;
/** A packaged plant pushed below its rating loses this share of a standard plant's derate. */
export const COLD_PACKAGE_DERATE_FACTOR = 0.5;
/**
 * Cap on the regional gas price multiple in a deep freeze. Spot prices rose far more in February
 * 2021; this bounds the monthly average for balance.
 */
export const COLD_MAX_GAS_PRICE_MULTIPLIER = 3;

/** Bounds a validated designMinTempC may take. */
export const DESIGN_MIN_TEMP_BOUNDS_C = { min: -60, max: 0 };

/** Seasonal hail weights for the northern hemisphere, index 0 = January, summing to one. */
export const NORTHERN_HAIL_MONTHLY_WEIGHTS: readonly number[] = [
  0, 0, 0.03, 0.12, 0.22, 0.25, 0.18, 0.12, 0.06, 0.02, 0, 0,
];

/**
 * Tutorials teach one mechanic each and must never be interrupted by a random storm. Kept as an
 * explicit list, rather than read from the scenarios, so the hazard model cannot import them;
 * a test checks it against every scenario that carries tutorial steps.
 */
export const WEATHER_HAZARD_TUTORIAL_SCENARIOS: ReadonlySet<number> = new Set([
  0, 1, 2, 3, 4, 5, 112,
]);

/**
 * Scenarios with an authored freeze of their own (103's shale-boom cold snap, 107's Texas deep
 * freeze with its winterization choice). Generic extreme cold would double-count it, so only
 * hail runs there and the cold-weather build option is hidden.
 */
export const WEATHER_HAZARD_AUTHORED_FREEZE_SCENARIOS: ReadonlySet<number> =
  new Set([103, 107]);

/**
 * Scored scenarios whose authored balance would move under random weather hazards. Opt a scenario
 * out here, with a comment explaining why, rather than retuning its authored story.
 */
export const WEATHER_HAZARD_OPT_OUT_SCENARIOS: ReadonlySet<number> = new Set();

type ProfileRow = [damagingHailPerYear: number, source: string];

// Grouped by hail band, highest first. Cold exposure comes from each city's own weather record
// (data/ColdClimate), not from these rows.
const PROFILE_ROWS: Record<string, ProfileRow> = {
  // Hail alley and the Argentine lee of the Andes, the world's most active hail regions. Capped at
  // 0.06 so about nine 20-year runs in ten see at most two damaging storms even here (a probe
  // over 1,000 seeds: 90-91% at 0.06, against 82-83% at the earlier 0.08).
  Denver: [0.06, SPC],
  Dallas: [0.06, SPC],
  KansasCity: [0.06, SPC],
  Cordoba: [0.06, SATELLITE],
  Mendoza: [0.06, SATELLITE],
  Calgary: [0.055, SPC],
  Johannesburg: [0.05, SATELLITE],
  // The wider Plains, Midwest and South, plus the Po valley, Bavaria and the Pampas.
  Austin: [0.05, SPC],
  SanAntonio: [0.05, SPC],
  StLouis: [0.05, SPC],
  Minneapolis: [0.05, SPC],
  Winnipeg: [0.04, SPC],
  Milwaukee: [0.04, SPC],
  Chicago: [0.04, SPC],
  Indianapolis: [0.04, SPC],
  Nashville: [0.04, SPC],
  Memphis: [0.04, SPC],
  Monterrey: [0.04, SATELLITE],
  Milan: [0.05, ESSL],
  Munich: [0.04, ESSL],
  BuenosAires: [0.04, SATELLITE],
  PortoAlegre: [0.04, SATELLITE],
  // Moderate: eastern North America, central Europe, the Caucasus, Central and East Asia.
  PIT: [0.03, SPC],
  Houston: [0.03, SPC],
  Atlanta: [0.03, SPC],
  Columbus: [0.03, SPC],
  Detroit: [0.03, SPC],
  Cleveland: [0.03, SPC],
  Toronto: [0.02, SPC],
  Albuquerque: [0.03, SPC],
  SaltLakeCity: [0.02, SPC],
  Vienna: [0.03, ESSL],
  Zurich: [0.03, ESSL],
  Geneva: [0.03, ESSL],
  Lyon: [0.03, ESSL],
  Frankfurt: [0.02, ESSL],
  Prague: [0.02, ESSL],
  Krakow: [0.02, ESSL],
  Budapest: [0.03, ESSL],
  Belgrade: [0.03, ESSL],
  Bucharest: [0.03, ESSL],
  Sofia: [0.03, ESSL],
  Zagreb: [0.03, ESSL],
  Tbilisi: [0.03, SATELLITE],
  Almaty: [0.03, SATELLITE],
  Beijing: [0.02, SATELLITE],
  Kolkata: [0.02, SATELLITE],
  Durban: [0.02, SATELLITE],
  Harare: [0.02, SATELLITE],
  // Occasional: the Northeast corridor, the desert Southwest, Paris and Iberia.
  NewYork: [0.015, SPC],
  Philadelphia: [0.015, SPC],
  Baltimore: [0.015, SPC],
  Manassas: [0.015, SPC],
  Boston: [0.01, SPC],
  Phoenix: [0.01, SPC],
  Tucson: [0.01, SPC],
  Paris: [0.015, ESSL],
  Madrid: [0.01, ESSL],
  Barcelona: [0.01, ESSL],
  // Rare: marine and Mediterranean climates, and the Gulf.
  SF: [0.003, SPC],
  LA: [0.003, SPC],
  SanDiego: [0.003, SPC],
  Seattle: [0.003, SPC],
  Portland: [0.003, SPC],
  Vancouver: [0.003, SPC],
  Miami: [0.005, SPC],
  London: [0.004, ESSL],
  Dublin: [0.002, ESSL],
  Edinburgh: [0.002, ESSL],
  Oslo: [0.004, ESSL],
  Bergen: [0.002, ESSL],
  Santiago: [0.004, SATELLITE],
  Dubai: [0.002, SATELLITE],
  Doha: [0.002, SATELLITE],
  // Negligible hail: the subarctic, subantarctic and tropical islands.
  Reykjavik: [0.001, ESSL],
  HNL: [0.001, SPC],
  SJU: [0.001, SPC],
  Tromso: [0.001, ESSL],
  Murmansk: [0.001, ESSL],
  Anchorage: [0.001, SPC],
  Ushuaia: [0.001, SATELLITE],
  // Cold-climate cities outside the hail bands above.
  Fairbanks: [0.001, SPC],
  Yellowknife: [0.001, SPC],
  Iqaluit: [0.001, SPC],
  Astana: [0.02, SATELLITE],
  Montreal: [0.01, SPC],
  Buffalo: [0.01, SPC],
  Moscow: [0.01, ESSL],
  StPetersburg: [0.005, ESSL],
  Helsinki: [0.005, ESSL],
  Stockholm: [0.005, ESSL],
  Warsaw: [0.02, ESSL],
  Kyiv: [0.02, ESSL],
  Minsk: [0.015, ESSL],
};

/**
 * Whether a place builds its gas plants for its own winters and where its regional gas supply
 * strains. A place is a cold climate when a standard plant's rating is breached in about one
 * winter in four; regional strain needs the colder of the climate's default threshold and the
 * place's one-winter-in-twelve low. Cities without a weather record fall back to latitude and
 * altitude: plants are winterized at high latitude or at altitude outside the tropics.
 */
function coldExposure(
  location: LocationType,
): Pick<WeatherHazardProfileType, "coldClimate" | "regionalColdThresholdC"> {
  const climate = COLD_CLIMATE_BY_LOCATION[location.id];
  if (!climate) {
    const absLat = Math.abs(location.lat);
    const coldClimate =
      absLat >= 45 || ((location.elevation ?? 0) >= 1500 && absLat >= 30);
    return {
      coldClimate,
      regionalColdThresholdC: coldClimate
        ? DEFAULT_REGIONAL_COLD_THRESHOLD_C.cold
        : DEFAULT_REGIONAL_COLD_THRESHOLD_C.mild,
    };
  }
  const [routineLowC, rareLowC] = climate;
  const coldClimate = routineLowC <= STANDARD_GAS_DESIGN_MIN_TEMP_C;
  const base = coldClimate
    ? DEFAULT_REGIONAL_COLD_THRESHOLD_C.cold
    : DEFAULT_REGIONAL_COLD_THRESHOLD_C.mild;
  return {
    coldClimate,
    regionalColdThresholdC: Math.max(
      DESIGN_MIN_TEMP_BOUNDS_C.min,
      Math.min(base, rareLowC),
    ),
  };
}

// Rarer winters than one in twelve still reach a few degrees below the rare low, so the package is
// offered wherever that low comes within this margin of the standard rating. Without it, places
// such as Atlanta or London saw occasional derates the player had no way to prevent.
const COLD_PACKAGE_OFFER_MARGIN_C = 3;

/**
 * Whether a standard gas plant's rating is ever plausibly breached here, so a cold-weather package
 * could help: the place's one-winter-in-twelve low comes within a few degrees of the standard
 * rating. Cities without a weather record count as exposed outside the lowland subtropics and
 * tropics.
 */
export function coldPackageCanHelp(location: LocationType): boolean {
  const climate = COLD_CLIMATE_BY_LOCATION[location.id];
  if (climate) {
    return (
      climate[1] <= STANDARD_GAS_DESIGN_MIN_TEMP_C + COLD_PACKAGE_OFFER_MARGIN_C
    );
  }
  return Math.abs(location.lat) >= 30 || (location.elevation ?? 0) >= 1500;
}

/** Authored hail rates by location id. Unknown or custom locations use the latitude fallback. */
const HAIL_RATES: Readonly<Record<string, { rate: number; source: string }>> =
  Object.fromEntries(
    Object.entries(PROFILE_ROWS).map(([id, [rate, source]]) => [
      id,
      { rate, source },
    ]),
  );

/** The latitude-band hail fallback: rarest near the poles and in the deep tropics. */
function fallbackHailPerYear(location: LocationType): number {
  const absLat = Math.abs(location.lat);
  return absLat >= 60 ? 0.002 : absLat < 15 ? 0.005 : 0.01;
}

/** The hazard profile for a location: its authored hail rate and its own cold climate. */
export function getWeatherHazardProfile(
  location: LocationType,
): WeatherHazardProfileType {
  const hail = HAIL_RATES[location.id];
  return {
    damagingHailPerYear: hail?.rate ?? fallbackHailPerYear(location),
    ...coldExposure(location),
    source: hail?.source ?? FALLBACK,
  };
}

/** Every authored hail location's profile, for validation and tests. */
export function authoredHailLocationIds(): string[] {
  return Object.keys(PROFILE_ROWS);
}

/** The representative-day minimum below which regional gas supply is strained. */
export function regionalColdThresholdC(
  profile: WeatherHazardProfileType,
): number {
  return (
    profile.regionalColdThresholdC ??
    (profile.coldClimate
      ? DEFAULT_REGIONAL_COLD_THRESHOLD_C.cold
      : DEFAULT_REGIONAL_COLD_THRESHOLD_C.mild)
  );
}

/** The design minimum a cold-weather package buys at this location. */
export function coldPackageDesignMinTempC(
  profile: WeatherHazardProfileType,
): number {
  return Math.min(
    COLD_PACKAGE_MAX_DESIGN_MIN_TEMP_C,
    regionalColdThresholdC(profile) - COLD_PACKAGE_MARGIN_C,
  );
}

/**
 * Structural validation for a profile. Throws on the first problem so a bad data file fails at
 * load and in tests rather than silently producing a degenerate hazard.
 */
export function validateWeatherHazardProfile(
  profile: WeatherHazardProfileType,
  label = "profile",
): void {
  const problems: string[] = [];
  if (
    !Number.isFinite(profile.damagingHailPerYear) ||
    profile.damagingHailPerYear < 0 ||
    profile.damagingHailPerYear > 1
  ) {
    problems.push(`${label}.damagingHailPerYear must be within [0, 1]`);
  }
  if (typeof profile.coldClimate !== "boolean") {
    problems.push(`${label}.coldClimate must be a boolean`);
  }
  if (
    profile.regionalColdThresholdC !== undefined &&
    (!Number.isFinite(profile.regionalColdThresholdC) ||
      profile.regionalColdThresholdC < DESIGN_MIN_TEMP_BOUNDS_C.min ||
      profile.regionalColdThresholdC > DESIGN_MIN_TEMP_BOUNDS_C.max)
  ) {
    problems.push(
      `${label}.regionalColdThresholdC must be within [${DESIGN_MIN_TEMP_BOUNDS_C.min}, ${DESIGN_MIN_TEMP_BOUNDS_C.max}]`,
    );
  }
  if (!profile.source) {
    problems.push(`${label}.source must name its basis`);
  }
  if (problems.length) {
    throw new Error(`Invalid weather hazard profile:\n${problems.join("\n")}`);
  }
}

// Validate the shipped data at module load so a regression in these data files cannot ship.
Object.keys({ ...PROFILE_ROWS, ...COLD_CLIMATE_BY_LOCATION }).forEach((id) =>
  validateWeatherHazardProfile(
    getWeatherHazardProfile({ id, name: id, lat: 0, long: 0 }),
    id,
  ),
);
