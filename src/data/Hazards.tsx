import { LocationType, WeatherHazardProfileType } from "../Types";

/**
 * Location exposure to damaging hail and extreme cold, plus the balance constants that turn an
 * occurrence into damage, derates, deductibles and premiums (issue #73).
 *
 * The hail rates are the expected number of storms per year with hail large enough to break
 * utility PV modules at a single site. They are rounded game balance read from published hail
 * climatologies, not a site-specific risk assessment: the ranking between places is the point,
 * and the absolute values are deliberately modest so a 20-year run sees a handful of storms at
 * most even in hail alley. Flooding is out of scope.
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
 * The regional threshold where gas supply is strained (wellhead freeze-offs, pipeline pressure),
 * by climate. Northern systems are built for deeper cold, as ERCOT's in February 2021 was not.
 * Source: FERC-NERC February 2021 Cold Weather Outages report (2021).
 */
export const DEFAULT_REGIONAL_COLD_THRESHOLD_C = { cold: -25, mild: -8 };

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

type ProfileRow = [
  damagingHailPerYear: number,
  coldClimate: boolean,
  source: string,
  regionalColdThresholdC?: number,
];

// Grouped by hail band, highest first. Cold thresholds are overridden only where the default
// for the climate would be clearly wrong: the far north runs through much deeper cold routinely.
const PROFILE_ROWS: Record<string, ProfileRow> = {
  // Hail alley and the Argentine lee of the Andes, the world's most active hail regions.
  Denver: [0.08, true, SPC],
  Dallas: [0.08, false, SPC],
  KansasCity: [0.08, true, SPC],
  Cordoba: [0.08, false, SATELLITE],
  Mendoza: [0.08, false, SATELLITE],
  Calgary: [0.07, true, SPC, -30],
  Johannesburg: [0.06, false, SATELLITE],
  // The wider Plains, Midwest and South, plus the Po valley, Bavaria and the Pampas.
  Austin: [0.05, false, SPC],
  SanAntonio: [0.05, false, SPC],
  StLouis: [0.05, true, SPC],
  Minneapolis: [0.05, true, SPC, -30],
  Winnipeg: [0.04, true, SPC, -35],
  Milwaukee: [0.04, true, SPC],
  Chicago: [0.04, true, SPC],
  Indianapolis: [0.04, true, SPC],
  Nashville: [0.04, false, SPC],
  Memphis: [0.04, false, SPC],
  Monterrey: [0.04, false, SATELLITE],
  Milan: [0.05, false, ESSL],
  Munich: [0.04, true, ESSL],
  BuenosAires: [0.04, false, SATELLITE],
  PortoAlegre: [0.04, false, SATELLITE],
  // Moderate: eastern North America, central Europe, the Caucasus, Central and East Asia.
  PIT: [0.03, true, SPC],
  Houston: [0.03, false, SPC],
  Atlanta: [0.03, false, SPC],
  Columbus: [0.03, true, SPC],
  Detroit: [0.03, true, SPC],
  Cleveland: [0.03, true, SPC],
  Toronto: [0.02, true, SPC],
  Albuquerque: [0.03, true, SPC],
  SaltLakeCity: [0.02, true, SPC],
  Vienna: [0.03, true, ESSL],
  Zurich: [0.03, true, ESSL],
  Geneva: [0.03, true, ESSL],
  Lyon: [0.03, false, ESSL],
  Frankfurt: [0.02, true, ESSL],
  Prague: [0.02, true, ESSL],
  Krakow: [0.02, true, ESSL],
  Budapest: [0.03, true, ESSL],
  Belgrade: [0.03, true, ESSL],
  Bucharest: [0.03, true, ESSL],
  Sofia: [0.03, true, ESSL],
  Zagreb: [0.03, true, ESSL],
  Tbilisi: [0.03, false, SATELLITE],
  Almaty: [0.03, true, SATELLITE],
  Beijing: [0.02, true, SATELLITE],
  Kolkata: [0.02, false, SATELLITE],
  Durban: [0.02, false, SATELLITE],
  Harare: [0.02, false, SATELLITE],
  // Occasional: the Northeast corridor, the desert Southwest, Paris and Iberia.
  NewYork: [0.015, true, SPC],
  Philadelphia: [0.015, true, SPC],
  Baltimore: [0.015, true, SPC],
  Manassas: [0.015, true, SPC],
  Boston: [0.01, true, SPC],
  Phoenix: [0.01, false, SPC],
  Tucson: [0.01, false, SPC],
  Paris: [0.015, false, ESSL],
  Madrid: [0.01, false, ESSL],
  Barcelona: [0.01, false, ESSL],
  // Rare: marine and Mediterranean climates, and the Gulf.
  SF: [0.003, false, SPC],
  LA: [0.003, false, SPC],
  SanDiego: [0.003, false, SPC],
  Seattle: [0.003, false, SPC],
  Portland: [0.003, false, SPC],
  Vancouver: [0.003, false, SPC],
  Miami: [0.005, false, SPC],
  London: [0.004, false, ESSL],
  Dublin: [0.002, false, ESSL],
  Edinburgh: [0.002, false, ESSL],
  Oslo: [0.004, true, ESSL],
  Bergen: [0.002, false, ESSL],
  Santiago: [0.004, false, SATELLITE],
  Dubai: [0.002, false, SATELLITE],
  Doha: [0.002, false, SATELLITE],
  // Negligible hail: the subarctic, subantarctic and tropical islands.
  Reykjavik: [0.001, true, ESSL],
  HNL: [0.001, false, SPC],
  SJU: [0.001, false, SPC],
  Tromso: [0.001, true, ESSL],
  Murmansk: [0.001, true, ESSL, -35],
  Anchorage: [0.001, true, SPC],
  Ushuaia: [0.001, true, SATELLITE],
  // Cold-climate cities outside the hail bands above, listed for their cold thresholds.
  Fairbanks: [0.001, true, SPC, -40],
  Yellowknife: [0.001, true, SPC, -40],
  Iqaluit: [0.001, true, SPC, -40],
  Astana: [0.02, true, SATELLITE, -35],
  Montreal: [0.01, true, SPC],
  Buffalo: [0.01, true, SPC],
  Moscow: [0.01, true, ESSL],
  StPetersburg: [0.005, true, ESSL],
  Helsinki: [0.005, true, ESSL],
  Stockholm: [0.005, true, ESSL],
  Warsaw: [0.02, true, ESSL],
  Kyiv: [0.02, true, ESSL],
  Minsk: [0.015, true, ESSL],
};

/** Authored profiles by location id. Unknown or custom locations use the latitude fallback. */
export const WEATHER_HAZARD_PROFILES: Readonly<
  Record<string, WeatherHazardProfileType>
> = Object.fromEntries(
  Object.entries(PROFILE_ROWS).map(
    ([id, [damagingHailPerYear, coldClimate, source, threshold]]) => [
      id,
      {
        damagingHailPerYear,
        coldClimate,
        source,
        ...(threshold === undefined
          ? {}
          : { regionalColdThresholdC: threshold }),
      },
    ],
  ),
);

/**
 * A coarse profile for a location with no authored entry: hail is rarest near the poles and in
 * the deep tropics, and plants are winterized at high latitude or at altitude outside the tropics.
 */
function fallbackProfile(location: LocationType): WeatherHazardProfileType {
  const absLat = Math.abs(location.lat);
  const damagingHailPerYear = absLat >= 60 ? 0.002 : absLat < 15 ? 0.005 : 0.01;
  const coldClimate =
    absLat >= 45 || ((location.elevation ?? 0) >= 1500 && absLat >= 30);
  return { damagingHailPerYear, coldClimate, source: FALLBACK };
}

/** The hazard profile for a location: its authored entry, or the latitude fallback. */
export function getWeatherHazardProfile(
  location: LocationType,
): WeatherHazardProfileType {
  return WEATHER_HAZARD_PROFILES[location.id] ?? fallbackProfile(location);
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

// Validate the shipped profiles at module load so a regression in this data file cannot ship.
Object.entries(WEATHER_HAZARD_PROFILES).forEach(([id, profile]) =>
  validateWeatherHazardProfile(profile, id),
);
