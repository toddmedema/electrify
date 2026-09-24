import {
  ActiveWorldEventType,
  DateType,
  FacilityOperatingType,
  FacilityUpgradeInProgressType,
  GeneratorOperatingType,
  FacilityResilienceType,
  GameType,
  GeneratorShoppingType,
  LocationType,
  ResilienceUpgradeType,
  TickPresentFutureType,
  WeatherHazardProfileType,
  WeatherHazardType,
} from "../Types";
import {
  COLD_MAX_DERATE,
  COLD_MAX_GAS_PRICE_MULTIPLIER,
  COLD_PACKAGE_BUILD_SHARE,
  COLD_PACKAGE_DERATE_FACTOR,
  COLD_PACKAGE_RETROFIT_SHARE,
  coldPackageCanHelp,
  coldPackageDesignMinTempC,
  getWeatherHazardProfile,
  HAIL_EXPOSURE_HIT_SHARE,
  HAIL_MAX_DAMAGED_FRACTION,
  HAIL_RESISTANT_BUILD_SHARE,
  HAIL_RESISTANT_DAMAGE_FACTOR,
  HAIL_RESISTANT_RETROFIT_SHARE,
  NORTHERN_HAIL_MONTHLY_WEIGHTS,
  regionalColdThresholdC,
  STANDARD_GAS_DESIGN_MIN_TEMP_C,
  TRACKER_BUILD_SHARE,
  TRACKER_FIRST_YEAR,
  TRACKER_HAIL_DAMAGE_FACTOR,
  TRACKER_HAIL_PRO_DAMAGE_FACTOR,
  TRACKER_HAIL_PRO_YEAR,
  TRACKER_SHOULDER_GAIN,
  WEATHER_HAZARD_AUTHORED_FREEZE_SCENARIOS,
  WEATHER_HAZARD_OPT_OUT_SCENARIOS,
  WEATHER_HAZARD_TUTORIAL_SCENARIOS,
} from "../data/Hazards";
import { getWeather } from "../data/Weather";
import { storyHash } from "../data/WorldEvents";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import { TICK_MINUTES } from "../Constants";
import { randomAt, RANDOM_STREAM } from "./Math";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

/**
 * Hail damage to solar and extreme cold for gas (issue #73), as pure functions of game state.
 *
 * Like the wildfire hazard, every draw is addressed by (seed, dedicated stream, event key,
 * attribute), so an occurrence is a pure function of its inputs and saving, forecasting or
 * reordering evaluation can never reroll it. The reducer decides when to check a month and how
 * to record the result; this module only answers what would happen and what hardening costs.
 * It must not import scenarios or reducers: both depend on it.
 */

export const HAIL_DEFINITION_ID = "weather-hail";
export const COLD_DEFINITION_ID = "weather-cold";

// A game month is one simulated day standing for a real month, so a repair measured in real days
// lasts that share of the month's minutes.
const REAL_DAYS_PER_MONTH = 365 / 12;
const GAME_MINUTES_PER_REAL_DAY = MINUTES_PER_MONTH / REAL_DAYS_PER_MONTH;

/** Game minutes for a span of real days, rounded up to whole ticks so it ends on a tick. */
export function realDaysToGameMinutes(days: number): number {
  const minutes = days * GAME_MINUTES_PER_REAL_DAY;
  return Math.max(
    TICK_MINUTES,
    Math.ceil(minutes / TICK_MINUTES) * TICK_MINUTES,
  );
}

/** The key for one hazard check in an absolute month, e.g. "hail:Denver:37". */
export function hazardEventKey(
  hazard: WeatherHazardType,
  locationId: string,
  monthsElapsed: number,
): string {
  return `${hazard === "HAIL" ? "hail" : "cold"}:${locationId}:${monthsElapsed}`;
}

/** One addressed draw in [0, 1) for an event attribute; pure and order-independent. */
export function hazardDraw(
  seed: number,
  key: string,
  attribute: string,
): number {
  return randomAt(
    seed,
    RANDOM_STREAM.weatherHazards,
    storyHash(`${key}|${attribute}`),
  );
}

/**
 * Whether a hazard may occur in this game. Tutorials never see one, harness baselines can switch
 * them off, and generic extreme cold stays out of scenarios that author their own freeze.
 */
export function isWeatherHazardEligible(
  game: GameType,
  hazard: WeatherHazardType,
): boolean {
  if (game.storyEffectsDisabled || game.weatherHazardsDisabled) {
    return false;
  }
  if (
    WEATHER_HAZARD_TUTORIAL_SCENARIOS.has(game.scenarioId) ||
    WEATHER_HAZARD_OPT_OUT_SCENARIOS.has(game.scenarioId)
  ) {
    return false;
  }
  if (
    hazard === "EXTREME_COLD" &&
    WEATHER_HAZARD_AUTHORED_FREEZE_SCENARIOS.has(game.scenarioId)
  ) {
    return false;
  }
  return true;
}

/**
 * The chance of a damaging hailstorm this month, `1 - exp(-annualRate * seasonalWeight)`. The
 * northern convective season shifts six months in the south; the tropics have no season.
 */
export function hailMonthlyProbability(
  profile: WeatherHazardProfileType,
  location: LocationType,
  monthIndex: number,
): number {
  const month = ((monthIndex % 12) + 12) % 12;
  let weight: number;
  if (Math.abs(location.lat) < 23.5) {
    weight = 1 / 12;
  } else if (location.lat < 0) {
    weight = NORTHERN_HAIL_MONTHLY_WEIGHTS[(month + 6) % 12];
  } else {
    weight = NORTHERN_HAIL_MONTHLY_WEIGHTS[month];
  }
  const lambda = profile.damagingHailPerYear * weight;
  return lambda > 0 ? 1 - Math.exp(-lambda) : 0;
}

/** Whether this month's addressed occurrence draw lands a damaging hailstorm. */
export function hailOccurs(game: GameType, key: string, monthIndex: number) {
  const profile = getWeatherHazardProfile(game.location);
  return (
    hazardDraw(game.seed, key, "occurrence") <
    hailMonthlyProbability(profile, game.location, monthIndex)
  );
}

/**
 * The coldest hour of the month's representative day, plus any story temperature offset. Only
 * one day per month is simulated, so this is the temperature the month's cold check sees.
 */
export function representativeMinTempC(
  date: DateType,
  seed: number,
  temperatureOffsetC = 0,
): number {
  let min = Infinity;
  for (let hour = 0; hour < 24; hour++) {
    const reading = getWeather(
      { ...date, hourOfDay: hour, minuteOfDay: hour * 60 },
      seed,
    );
    min = Math.min(min, reading.TEMP_C);
  }
  return min + temperatureOffsetC;
}

function isOperational(facility: FacilityOperatingType): boolean {
  return facility.yearsToBuildLeft <= 0;
}

/**
 * What a facility would cost to replace today: its purchase price carried forward by the game's
 * inflation since it was bought. The starting fleet's price is carried from the run start.
 */
export function replacementValue(
  facility: FacilityOperatingType,
  game: GameType,
): number {
  const buildCost = Math.max(0, facility.buildCost || 0);
  if (!hasEconomy()) {
    return buildCost;
  }
  const created = getDateFromMinute(
    Math.max(0, facility.minuteCreated || 0),
    game.startingYear,
  );
  const then = getInflationIndex(created, game.startingYear, game.seed);
  const now = getInflationIndex(game.date, game.startingYear, game.seed);
  return then > 0 ? buildCost * (now / then) : buildCost;
}

/** One solar facility's damage from a hailstorm. */
export interface HailImpactType {
  facilityId: number;
  facilityName: string;
  damagedFraction: number; // Share of nameplate broken, (0, HAIL_MAX_DAMAGED_FRACTION]
  repairDays: number; // Whole days
  repairMinutes: number;
  repairCost: number; // What the company pays, charged once
  hailResistant: boolean;
}

/**
 * The damage a hailstorm does to each operational solar facility: whether the swath hits it,
 * what share of the array breaks, how long repairs take and what they cost. Every quantity comes
 * from the facility's own addressed draws, so the result is independent of fleet order.
 */
export function sampleHailImpacts(args: {
  game: GameType;
  key: string;
}): HailImpactType[] {
  const { game, key } = args;
  const intensity = hazardDraw(game.seed, key, "intensity");
  return game.facilities
    .filter((facility) => facility.fuel === "Sun" && isOperational(facility))
    .filter(
      (facility) =>
        hazardDraw(game.seed, key, `facility|${facility.id}|exposure`) <
        HAIL_EXPOSURE_HIT_SHARE,
    )
    .map((facility) => {
      const damageDraw = hazardDraw(
        game.seed,
        key,
        `facility|${facility.id}|damage`,
      );
      const repairDraw = hazardDraw(
        game.seed,
        key,
        `facility|${facility.id}|repair`,
      );
      const hailResistant = !!facility.resilience?.hailResistant;
      const damagedFraction =
        Math.min(
          HAIL_MAX_DAMAGED_FRACTION,
          (0.04 + 0.36 * intensity * intensity) * (0.5 + damageDraw),
        ) *
        (hailResistant ? HAIL_RESISTANT_DAMAGE_FACTOR : 1) *
        trackerHailFactor(facility);
      const repairDays = Math.ceil(
        (5 + 80 * damagedFraction) * (0.8 + 0.4 * repairDraw),
      );
      const repairCost = damagedFraction * replacementValue(facility, game);
      return {
        facilityId: facility.id,
        facilityName: facility.name,
        damagedFraction,
        repairDays,
        repairMinutes: realDaysToGameMinutes(repairDays),
        repairCost,
        hailResistant,
      };
    })
    .sort((a, b) => a.facilityId - b.facilityId);
}

/** A month's extreme-cold outcome: regional gas strain and per-plant derates. */
export interface ColdImpactType {
  minTempC: number;
  regional: boolean; // Below the regional threshold, so gas prices spike
  gasPriceMultiplier: number; // 1 unless regional
  derates: Array<{
    facilityId: number;
    facilityName: string;
    availableFraction: number;
  }>;
  // Packaged plants that rode the cold out without a derate
  protectedFacilityIds: number[];
}

function designMinTempC(facility: FacilityOperatingType): number {
  return facility.resilience?.designMinTempC ?? STANDARD_GAS_DESIGN_MIN_TEMP_C;
}

/**
 * The effect of a month whose representative day bottoms out at minTempC, or undefined when it
 * is not cold enough to matter. Each operational gas plant colder than its design minimum loses
 * a share of output that grows with the shortfall; a packaged plant loses half as much.
 */
export function resolveColdImpact(args: {
  game: GameType;
  key: string;
  minTempC: number;
}): ColdImpactType | undefined {
  const { game, key, minTempC } = args;
  const profile = getWeatherHazardProfile(game.location);
  const threshold = regionalColdThresholdC(profile);
  const regional = minTempC < threshold;
  const gasPriceMultiplier = regional
    ? Math.min(
        COLD_MAX_GAS_PRICE_MULTIPLIER,
        1.5 + 0.1 * (threshold - minTempC),
      )
    : 1;
  const derates: ColdImpactType["derates"] = [];
  const protectedFacilityIds: number[] = [];
  game.facilities
    .filter(
      (facility) => facility.fuel === "Natural Gas" && isOperational(facility),
    )
    .sort((a, b) => a.id - b.id)
    .forEach((facility) => {
      const packaged = !!facility.resilience?.coldWeatherPackage;
      const shortfall = designMinTempC(facility) - minTempC;
      if (shortfall <= 0) {
        if (packaged) {
          protectedFacilityIds.push(facility.id);
        }
        return;
      }
      const draw = hazardDraw(game.seed, key, `facility|${facility.id}|derate`);
      const derate =
        Math.min(COLD_MAX_DERATE, 0.2 + 0.04 * shortfall) *
        (0.85 + 0.3 * draw) *
        (packaged ? COLD_PACKAGE_DERATE_FACTOR : 1);
      derates.push({
        facilityId: facility.id,
        facilityName: facility.name,
        availableFraction: 1 - Math.min(COLD_MAX_DERATE, derate),
      });
    });
  if (!regional && !derates.length) {
    return undefined;
  }
  return {
    minTempC,
    regional,
    gasPriceMultiplier,
    derates,
    protectedFacilityIds,
  };
}

/** The share of a hailstorm's damage a tracked array still takes; 1 without trackers. */
function trackerHailFactor(facility: FacilityOperatingType): number {
  return facility.resilience?.solarTrackers
    ? (facility.resilience.trackerHailDamageFactor ??
        TRACKER_HAIL_DAMAGE_FACTOR)
    : 1;
}

/** The hail share trackers bought in this year keep: steeper stow arrived with Hail Pro-75. */
export function trackerHailDamageFactorForYear(year: number): number {
  return year >= TRACKER_HAIL_PRO_YEAR
    ? TRACKER_HAIL_PRO_DAMAGE_FACTOR
    : TRACKER_HAIL_DAMAGE_FACTOR;
}

/**
 * A tracked array's output relative to a fixed one at this time of day. Trackers gain little at
 * noon, when a fixed array already faces the sun, and most in the morning and evening; see
 * TRACKER_SHOULDER_GAIN. The simulation clamps the product at nameplate as it does for any array.
 */
export function trackerOutputMultiplier(
  facility: FacilityOperatingType,
  minuteOfDay: number,
): number {
  if (!facility.resilience?.solarTrackers) {
    return 1;
  }
  const hourAngle = ((minuteOfDay / 60 - 12) / 12) * Math.PI;
  return 1 + TRACKER_SHOULDER_GAIN * Math.sin(hourAngle) ** 2;
}

/** The upgrade a standing plant of this technology can have added later, if any. */
function upgradeForFuel(fuel: unknown): ResilienceUpgradeType | undefined {
  if (fuel === "Sun") return "hailResistant";
  if (fuel === "Natural Gas") return "coldWeatherPackage";
  return undefined;
}

/** Every option a new plant of this technology can be bought with. */
function buildUpgradesForFuel(fuel: unknown): ResilienceUpgradeType[] {
  if (fuel === "Sun") return ["solarTrackers", "hailResistant"];
  if (fuel === "Natural Gas") return ["coldWeatherPackage"];
  return [];
}

/**
 * Whether an upgrade is offered in this game at all. Hardening needs its hazard to be able to
 * occur, and a cold-weather package is only sold where cold can plausibly breach a standard
 * plant's rating. Trackers pay for themselves in sunshine alone, so they are offered wherever the
 * technology exists, except in tutorials that teach one mechanic at a time.
 */
function upgradeOffered(
  game: GameType,
  upgrade: ResilienceUpgradeType,
): boolean {
  if (upgrade === "solarTrackers") {
    return (
      !WEATHER_HAZARD_TUTORIAL_SCENARIOS.has(game.scenarioId) &&
      game.date.year >= TRACKER_FIRST_YEAR
    );
  }
  return (
    isWeatherHazardEligible(
      game,
      upgrade === "hailResistant" ? "HAIL" : "EXTREME_COLD",
    ) &&
    (upgrade !== "coldWeatherPackage" || coldPackageCanHelp(game.location))
  );
}

/** How long a retrofit holds a plant offline: one game month. */
export const RETROFIT_DOWNTIME_MINUTES = MINUTES_PER_MONTH;

/** The retrofit being installed on a facility, if any. */
export function upgradeInProgress(
  facility: FacilityOperatingType,
): FacilityUpgradeInProgressType | undefined {
  return (facility as Partial<GeneratorOperatingType>).upgradeInProgress;
}

/** Whether a retrofit holds the facility offline at this minute. */
export function isUpgradingAt(
  facility: FacilityOperatingType,
  minute: number,
): boolean {
  const upgrade = upgradeInProgress(facility);
  return !!upgrade && minute < upgrade.completesMinute;
}

/** Whole real days of downtime a retrofit has left at this minute, at least one. */
export function upgradeDaysLeft(
  upgrade: FacilityUpgradeInProgressType,
  minute: number,
): number {
  return Math.max(
    1,
    Math.ceil((upgrade.completesMinute - minute) / GAME_MINUTES_PER_REAL_DAY),
  );
}

/** How far a retrofit has got at this minute, in [0, 1]. */
export function upgradeProgress(
  upgrade: FacilityUpgradeInProgressType,
  minute: number,
): number {
  const span = upgrade.completesMinute - upgrade.startsMinute;
  if (!(span > 0)) return 1;
  return Math.max(0, Math.min(1, (minute - upgrade.startsMinute) / span));
}

/**
 * What adding an upgrade to a standing facility costs, or undefined when it is not offered: the
 * wrong technology, already installed, still under construction, or a game where that hazard
 * never occurs. The reducer and the facility details pane share this one rule.
 */
export function retrofitCost(
  facility: FacilityOperatingType,
  game: GameType,
  upgrade: ResilienceUpgradeType,
): number | undefined {
  if (
    !isOperational(facility) ||
    upgradeInProgress(facility) ||
    upgradeForFuel(facility.fuel) !== upgrade ||
    facility.resilience?.[upgrade] ||
    !upgradeOffered(game, upgrade)
  ) {
    return undefined;
  }
  const share =
    upgrade === "hailResistant"
      ? HAIL_RESISTANT_RETROFIT_SHARE
      : COLD_PACKAGE_RETROFIT_SHARE;
  return Math.round(replacementValue(facility, game) * share);
}

/**
 * The facility's resilience once an upgrade is installed. A cold-weather package re-rates the
 * plant to the location's package design minimum; the rating is then fixed on the facility.
 */
export function retrofittedResilience(
  facility: FacilityOperatingType,
  game: GameType,
  upgrade: ResilienceUpgradeType,
): FacilityResilienceType {
  if (upgrade === "hailResistant") {
    return { ...facility.resilience, hailResistant: true };
  }
  return {
    ...facility.resilience,
    coldWeatherPackage: true,
    designMinTempC: coldPackageDesignMinTempC(
      getWeatherHazardProfile(game.location),
    ),
  };
}

/** One of the build dialog's optional upgrades for a quote. */
export interface ResilienceBuildOptionType {
  upgrade: ResilienceUpgradeType;
  label: string;
  extraBuildCost: number;
  defaultSelected: boolean;
  selected: boolean;
}

/** Which of a quote's build options the player has chosen; an absent key is unchosen. */
export type ResilienceSelectionType = Partial<
  Record<ResilienceUpgradeType, boolean>
>;

const BUILD_OPTION_LABELS: Record<ResilienceUpgradeType, string> = {
  solarTrackers: "Solar trackers",
  hailResistant: "Hail-resistant panels",
  coldWeatherPackage: "Cold-weather package",
};

const BUILD_OPTION_SHARES: Record<ResilienceUpgradeType, number> = {
  solarTrackers: TRACKER_BUILD_SHARE,
  hailResistant: HAIL_RESISTANT_BUILD_SHARE,
  coldWeatherPackage: COLD_PACKAGE_BUILD_SHARE,
};

/** The quote's price without any build option folded in. */
function baseBuildCost(quote: GeneratorShoppingType): number {
  return quote.buildCost - (quote.resilienceExtraBuildCost || 0);
}

/** The build options offered for a quote, in the order the dialog lists them. */
export function resilienceBuildOptions(
  quote: GeneratorShoppingType,
  game: GameType,
): ResilienceBuildOptionType[] {
  const base = baseBuildCost(quote);
  return buildUpgradesForFuel(quote.fuel)
    .filter((upgrade) => upgradeOffered(game, upgrade))
    .map((upgrade) => ({
      upgrade,
      label: BUILD_OPTION_LABELS[upgrade],
      extraBuildCost: Math.round(base * BUILD_OPTION_SHARES[upgrade]),
      defaultSelected:
        upgrade === "coldWeatherPackage" &&
        getWeatherHazardProfile(game.location).coldClimate,
      selected: !!quote.resilience?.[upgrade],
    }));
}

/** The options a quote currently carries, as a selection. */
export function resilienceSelection(
  quote: GeneratorShoppingType,
  game: GameType,
): ResilienceSelectionType {
  return Object.fromEntries(
    resilienceBuildOptions(quote, game).map((option) => [
      option.upgrade,
      option.selected,
    ]),
  );
}

/**
 * The quote with its build options set to the selection. Each chosen option's whole-dollar price
 * is added to buildCost and their sum remembered in resilienceExtraBuildCost, so changing the
 * selection restores the original price and repeating it is a no-op.
 * Gas quotes always carry their resolved design temperature, and tracked arrays their hail stow.
 * Returns a new quote.
 */
export function withResilienceOptions(
  quote: GeneratorShoppingType,
  game: GameType,
  selection: ResilienceSelectionType,
): GeneratorShoppingType {
  const options = resilienceBuildOptions(quote, game);
  const chosen = new Set(
    options
      .filter((option) => selection[option.upgrade])
      .map((option) => option.upgrade),
  );
  const extra = options
    .filter((option) => chosen.has(option.upgrade))
    .reduce((total, option) => total + option.extraBuildCost, 0);
  const next: GeneratorShoppingType = {
    ...quote,
    buildCost: baseBuildCost(quote) + extra,
  };
  delete next.resilienceExtraBuildCost;
  if (extra > 0) {
    next.resilienceExtraBuildCost = extra;
  }
  let resilience: FacilityResilienceType | undefined;
  if (quote.fuel === "Sun" && options.length) {
    resilience = {};
    options.forEach((option) => {
      resilience![option.upgrade] = chosen.has(option.upgrade);
    });
    if (chosen.has("solarTrackers")) {
      resilience.trackerHailDamageFactor = trackerHailDamageFactorForYear(
        game.date.year,
      );
    }
  } else if (quote.fuel === "Natural Gas") {
    const packaged = chosen.has("coldWeatherPackage");
    resilience = {
      coldWeatherPackage: packaged,
      designMinTempC: packaged
        ? coldPackageDesignMinTempC(getWeatherHazardProfile(game.location))
        : STANDARD_GAS_DESIGN_MIN_TEMP_C,
    };
  }
  if (resilience) {
    next.resilience = resilience;
  } else {
    delete next.resilience;
  }
  return next;
}

/** The quote with the location's default options applied, as the build list first shows it. */
export function applyDefaultResilience(
  quote: GeneratorShoppingType,
  game: GameType,
): GeneratorShoppingType {
  return withResilienceOptions(
    quote,
    game,
    Object.fromEntries(
      resilienceBuildOptions(quote, game).map((option) => [
        option.upgrade,
        option.defaultSelected,
      ]),
    ),
  );
}

/** A facility's current weather outage, for its fleet row. */
export interface FacilityHazardStatusType {
  hazard: WeatherHazardType;
  label: "Hail damage" | "Extreme cold";
  availableFraction: number; // Product of every active weather multiplier on the facility
  daysLeft?: number; // Hail repairs only; a cold snap lasts the month
  endsMinute: number;
}

/**
 * The weather-hazard occurrences limiting a facility at a minute. An occurrence that began before
 * the facility was bought belonged to an earlier facility with the same ID, so it never applies.
 */
export function activeWeatherHazardsFor(
  game: GameType,
  facility: FacilityOperatingType,
  minute: number,
): ActiveWorldEventType[] {
  return (game.worldEvents?.active ?? []).filter((event) => {
    if (
      event.definitionId !== HAIL_DEFINITION_ID &&
      event.definitionId !== COLD_DEFINITION_ID
    ) {
      return false;
    }
    if (minute < event.startsMinute || minute >= event.endsMinute) {
      return false;
    }
    if (event.startsMinute < (facility.minuteCreated || 0)) {
      return false;
    }
    const multiplier =
      event.effects.facilityOutputMultipliersById?.[String(facility.id)];
    return multiplier !== undefined && multiplier < 1;
  });
}

/**
 * The facility's combined active weather outage right now, if any. Overlapping storms multiply,
 * as the simulation applies them, and a hail outage lasts until its last repair finishes.
 */
export function facilityHazardStatus(
  game: GameType,
  facility: FacilityOperatingType,
): FacilityHazardStatusType | undefined {
  const minute = game.date.minute;
  const events = activeWeatherHazardsFor(game, facility, minute);
  if (!events.length) {
    return undefined;
  }
  const availableFraction = events.reduce(
    (product, event) =>
      product *
      (event.effects.facilityOutputMultipliersById?.[String(facility.id)] ?? 1),
    1,
  );
  const hailEvents = events.filter(
    (event) => event.definitionId === HAIL_DEFINITION_ID,
  );
  const endsMinute = Math.max(
    ...(hailEvents.length ? hailEvents : events).map((e) => e.endsMinute),
  );
  if (hailEvents.length) {
    return {
      hazard: "HAIL",
      label: "Hail damage",
      availableFraction,
      daysLeft: Math.max(
        1,
        Math.ceil((endsMinute - minute) / GAME_MINUTES_PER_REAL_DAY),
      ),
      endsMinute,
    };
  }
  return {
    hazard: "EXTREME_COLD",
    label: "Extreme cold",
    availableFraction,
    endsMinute,
  };
}

/** What the facility details pane shows about a facility's weather hardening. */
export interface FacilityResilienceSummaryType {
  upgrade: ResilienceUpgradeType;
  label: string;
  installed: boolean;
  detail?: string; // Hail only; gas shows its temperature rating instead
  retrofitCost?: number; // Absent once installed
  replacementValue: number;
}

/** The resilience summary for a solar or gas facility, or undefined when none applies. */
export function facilityResilienceSummary(
  game: GameType,
  facility: FacilityOperatingType,
): FacilityResilienceSummaryType | undefined {
  const upgrade = upgradeForFuel(facility.fuel);
  if (!upgrade || !upgradeOffered(game, upgrade)) {
    return undefined;
  }
  const installed = !!facility.resilience?.[upgrade];
  let label: string;
  let detail: string | undefined;
  if (upgrade === "hailResistant") {
    const tracked = !!facility.resilience?.solarTrackers;
    label = installed ? "Hail-resistant panels" : "Standard panels";
    if (installed) {
      detail = tracked
        ? "Breaks less in a hailstorm, and trackers stow ahead of it."
        : "Breaks less in a hailstorm.";
    } else {
      detail = tracked
        ? "Trackers stow ahead of hail."
        : "Takes full hail damage.";
    }
  } else {
    // The pane shows the plant's rating instead, in the player's temperature unit.
    label = installed ? "Cold-weather package" : "Standard winterization";
  }
  return {
    upgrade,
    label,
    installed,
    detail,
    retrofitCost: retrofitCost(facility, game, upgrade),
    replacementValue: replacementValue(facility, game),
  };
}

/**
 * One-time hazard costs (hail repairs) falling due in the window (prev, now]. Each is charged
 * at `oneTimeCostMinute`, one tick after onset, so the month-boundary pre-roll frames -- which run
 * with prev === now -- and a re-forecast from the current tick can never charge one twice.
 */
export function oneTimeWorldEventCost(
  occurrences: ActiveWorldEventType[],
  prev: Pick<TickPresentFutureType, "minute"> | undefined,
  now: Pick<TickPresentFutureType, "minute">,
): number {
  if (!prev || prev === now || prev.minute >= now.minute) {
    return 0;
  }
  return occurrences.reduce((total, event) => {
    const cost = event.attributes.oneTimeCost;
    const minute = event.attributes.oneTimeCostMinute;
    if (typeof cost !== "number" || typeof minute !== "number") {
      return total;
    }
    return prev.minute < minute && minute <= now.minute ? total + cost : total;
  }, 0);
}

/** The minute a hazard occurrence starting at startsMinute charges its one-time cost. */
export function oneTimeCostMinute(startsMinute: number): number {
  return startsMinute + TICK_MINUTES;
}

/** Aggregate weather-hazard impact over a run, for balance comparison across seeds. */
export interface WeatherHazardImpactSummaryType {
  hailEvents: number; // Distinct storms
  hailFacilityHits: number;
  hailRepairCosts: number;
  coldEvents: number;
  coldRegionalEvents: number;
  coldDerates: number; // Plant-months derated
}

/** Sums hazard occurrences. Pure in its input; the occurrences may be in any order. */
export function summarizeWeatherHazardImpact(
  occurrences: ActiveWorldEventType[],
): WeatherHazardImpactSummaryType {
  const storms = new Set<string>();
  const summary: WeatherHazardImpactSummaryType = {
    hailEvents: 0,
    hailFacilityHits: 0,
    hailRepairCosts: 0,
    coldEvents: 0,
    coldRegionalEvents: 0,
    coldDerates: 0,
  };
  occurrences.forEach((event) => {
    if (event.definitionId === HAIL_DEFINITION_ID) {
      storms.add(String(event.attributes.eventKey ?? event.key));
      summary.hailFacilityHits += 1;
      summary.hailRepairCosts += Number(event.attributes.oneTimeCost) || 0;
    } else if (event.definitionId === COLD_DEFINITION_ID) {
      summary.coldEvents += 1;
      if (event.attributes.regional === true) {
        summary.coldRegionalEvents += 1;
      }
      const affected = event.attributes.affectedFacilityIds;
      summary.coldDerates += Array.isArray(affected) ? affected.length : 0;
    }
  });
  summary.hailEvents = storms.size;
  return summary;
}
