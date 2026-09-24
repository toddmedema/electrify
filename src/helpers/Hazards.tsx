import {
  ActiveWorldEventType,
  DateType,
  FacilityOperatingType,
  FacilityResilienceType,
  GameType,
  GeneratorOperatingType,
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
  GAS_INSURANCE_VULNERABILITY,
  getWeatherHazardProfile,
  HAIL_DEDUCTIBLE_SHARE,
  HAIL_EXPOSURE_HIT_SHARE,
  HAIL_MAX_DAMAGED_FRACTION,
  HAIL_RESISTANT_BUILD_SHARE,
  HAIL_RESISTANT_DAMAGE_FACTOR,
  HAIL_RESISTANT_INSURANCE_VULNERABILITY,
  HAIL_RESISTANT_RETROFIT_SHARE,
  NORTHERN_HAIL_MONTHLY_WEIGHTS,
  regionalColdThresholdC,
  SOLAR_HAIL_INSURANCE_RATE,
  SOLAR_HAIL_INSURANCE_REFERENCE_PER_YEAR,
  STANDARD_GAS_DESIGN_MIN_TEMP_C,
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

function isGenerator(
  facility: FacilityOperatingType,
): facility is GeneratorOperatingType {
  return facility.fuel !== undefined;
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

/**
 * The location-specific weather insurance loading for one facility, per year. Only solar carries
 * one in v1: hail breaks modules, while cold costs a gas plant output rather than assets.
 */
export function annualInsuranceCost(
  facility: FacilityOperatingType,
  game: GameType,
): number {
  if (facility.fuel === "Natural Gas") {
    return replacementValue(facility, game) * GAS_INSURANCE_VULNERABILITY;
  }
  if (facility.fuel !== "Sun" || !isWeatherHazardEligible(game, "HAIL")) {
    return 0;
  }
  const profile = getWeatherHazardProfile(game.location);
  const vulnerability = facility.resilience?.hailResistant
    ? HAIL_RESISTANT_INSURANCE_VULNERABILITY
    : 1;
  return (
    replacementValue(facility, game) *
    SOLAR_HAIL_INSURANCE_RATE *
    (profile.damagingHailPerYear / SOLAR_HAIL_INSURANCE_REFERENCE_PER_YEAR) *
    vulnerability
  );
}

/**
 * A build quote's annual weather insurance without and with its hail upgrade, priced as if built
 * today, or undefined when the quote has no hail option in this game.
 */
export function hazardInsuranceComparison(
  quote: GeneratorShoppingType,
  game: GameType,
): { standard: number; hardened: number } | undefined {
  const option = resilienceBuildOption(quote, game);
  if (!option || option.upgrade !== "hailResistant") {
    return undefined;
  }
  const premium = (selected: boolean) =>
    annualInsuranceCost(
      {
        ...withResilienceOption(quote, game, selected),
        minuteCreated: game.date.minute,
      } as GeneratorOperatingType,
      game,
    );
  return { standard: premium(false), hardened: premium(true) };
}

/** Refreshes every generator's premium in place, at each monthly rollover. */
export function refreshInsurancePremiums(game: GameType): void {
  game.facilities.forEach((facility) => {
    if (!isGenerator(facility)) {
      return;
    }
    const premium = annualInsuranceCost(facility, game);
    if (premium > 0) {
      facility.annualInsuranceCost = premium;
    } else {
      delete facility.annualInsuranceCost;
    }
  });
}

/** One solar facility's damage from a hailstorm. */
export interface HailImpactType {
  facilityId: number;
  facilityName: string;
  damagedFraction: number; // Share of nameplate broken, (0, HAIL_MAX_DAMAGED_FRACTION]
  repairDays: number; // Whole days
  repairMinutes: number;
  repairCost: number; // Insured cost of the repair
  deductible: number; // What the company pays, charged once
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
        ) * (hailResistant ? HAIL_RESISTANT_DAMAGE_FACTOR : 1);
      const repairDays = Math.ceil(
        (5 + 80 * damagedFraction) * (0.8 + 0.4 * repairDraw),
      );
      const value = replacementValue(facility, game);
      const repairCost = damagedFraction * value;
      return {
        facilityId: facility.id,
        facilityName: facility.name,
        damagedFraction,
        repairDays,
        repairMinutes: realDaysToGameMinutes(repairDays),
        repairCost,
        deductible: Math.min(repairCost, HAIL_DEDUCTIBLE_SHARE * value),
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

function upgradeForFuel(fuel: unknown): ResilienceUpgradeType | undefined {
  if (fuel === "Sun") return "hailResistant";
  if (fuel === "Natural Gas") return "coldWeatherPackage";
  return undefined;
}

function hazardForUpgrade(upgrade: ResilienceUpgradeType): WeatherHazardType {
  return upgrade === "hailResistant" ? "HAIL" : "EXTREME_COLD";
}

/**
 * Whether an upgrade is offered in this game at all: its hazard must be able to occur, and a
 * cold-weather package is only sold where cold can plausibly breach a standard plant's rating.
 */
function upgradeOffered(
  game: GameType,
  upgrade: ResilienceUpgradeType,
): boolean {
  return (
    isWeatherHazardEligible(game, hazardForUpgrade(upgrade)) &&
    (upgrade !== "coldWeatherPackage" || coldPackageCanHelp(game.location))
  );
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

/** The build dialog's optional hardening for a quote. */
export interface ResilienceBuildOptionType {
  upgrade: ResilienceUpgradeType;
  label: string;
  extraBuildCost: number;
  defaultSelected: boolean;
  selected: boolean;
}

/** The quote's price without any resilience option folded in. */
function baseBuildCost(quote: GeneratorShoppingType): number {
  return quote.buildCost - (quote.resilienceExtraBuildCost || 0);
}

/** The hardening offered for a quote, or undefined for technologies or games without one. */
export function resilienceBuildOption(
  quote: GeneratorShoppingType,
  game: GameType,
): ResilienceBuildOptionType | undefined {
  const upgrade = upgradeForFuel(quote.fuel);
  if (!upgrade || !upgradeOffered(game, upgrade)) {
    return undefined;
  }
  const selected = !!quote.resilience?.[upgrade];
  if (upgrade === "hailResistant") {
    return {
      upgrade,
      label: "Hail-resistant panels",
      extraBuildCost: Math.round(
        baseBuildCost(quote) * HAIL_RESISTANT_BUILD_SHARE,
      ),
      defaultSelected: false,
      selected,
    };
  }
  const profile = getWeatherHazardProfile(game.location);
  return {
    upgrade,
    label: "Cold-weather package",
    extraBuildCost: Math.round(baseBuildCost(quote) * COLD_PACKAGE_BUILD_SHARE),
    defaultSelected: profile.coldClimate,
    selected,
  };
}

/**
 * The quote with the resilience option set or cleared. The option's whole-dollar price is added to
 * buildCost and remembered in resilienceExtraBuildCost, so toggling restores the original price
 * and repeating it is a no-op.
 * Gas quotes always carry their resolved design temperature. Returns a new quote.
 */
export function withResilienceOption(
  quote: GeneratorShoppingType,
  game: GameType,
  selected: boolean,
): GeneratorShoppingType {
  const option = resilienceBuildOption(quote, game);
  const chosen = !!option && selected;
  const extra = chosen ? option.extraBuildCost : 0;
  const next: GeneratorShoppingType = {
    ...quote,
    buildCost: baseBuildCost(quote) + extra,
  };
  delete next.resilienceExtraBuildCost;
  if (extra > 0) {
    next.resilienceExtraBuildCost = extra;
  }
  let resilience: FacilityResilienceType | undefined;
  if (quote.fuel === "Sun" && option) {
    resilience = { hailResistant: chosen };
  } else if (quote.fuel === "Natural Gas") {
    resilience = {
      coldWeatherPackage: chosen,
      designMinTempC: chosen
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

/** The quote with the location's default hardening applied, as the build list first shows it. */
export function applyDefaultResilience(
  quote: GeneratorShoppingType,
  game: GameType,
): GeneratorShoppingType {
  const option = resilienceBuildOption(quote, game);
  return withResilienceOption(quote, game, !!option?.defaultSelected);
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
  annualInsuranceCost?: number; // Absent when nothing is charged
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
  const premium = annualInsuranceCost(facility, game);
  let label: string;
  let detail: string | undefined;
  if (upgrade === "hailResistant") {
    label = installed ? "Hail-resistant panels" : "Standard panels";
    detail = installed
      ? "Less hail damage, lower insurance."
      : "Takes full hail damage.";
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
    annualInsuranceCost: premium > 0 ? premium : undefined,
    replacementValue: replacementValue(facility, game),
  };
}

/**
 * One-time hazard costs (hail deductibles) falling due in the window (prev, now]. Each is charged
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
  hailDeductibles: number;
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
    hailDeductibles: 0,
    coldEvents: 0,
    coldRegionalEvents: 0,
    coldDerates: 0,
  };
  occurrences.forEach((event) => {
    if (event.definitionId === HAIL_DEFINITION_ID) {
      storms.add(String(event.attributes.eventKey ?? event.key));
      summary.hailFacilityHits += 1;
      summary.hailDeductibles += Number(event.attributes.oneTimeCost) || 0;
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
