import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  DIFFICULTIES,
  INTERTIE_CONSTRUCTION_COST_EXPONENT,
  INTERTIE_CONSTRUCTION_EXISTING_MULTIPLIER,
  INTERTIE_CONSTRUCTION_KGCO2E_PER_W,
  INTERTIE_CONSTRUCTION_REFERENCE_COST_PER_W,
  INTERTIE_UPGRADE_COST_ESCALATION,
  INTERTIE_UPGRADE_COST_SHARE,
  INTERTIE_UPGRADE_OPEX_EXPONENT,
  INTERTIE_UPGRADE_STEP,
  INTERTIE_UPGRADE_TIME_SHARE,
  MAX_INTERTIE_UPGRADES,
  TICK_MINUTES,
} from "../Constants";
import {
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
} from "../data/AdjacentMarkets";
import {
  INTERTIE_ARCHETYPES,
  IntertieArchetypeType,
} from "../data/IntertieArchetypes";
import {
  accessContextForGame,
  effectiveCorridor,
  effectiveMarket,
  IntertieAccessContext,
} from "../data/IntertieAccess";
import { normalAt, randomAt, RANDOM_STREAM } from "./Math";
import {
  AdjacentMarketDefinitionType,
  GameType,
  TradingPolicyType,
  TransmissionCorridorDefinitionType,
  TransmissionLineOperatingType,
} from "../Types";

export interface TransmissionConditions {
  temperatureC: number;
  solarIrradianceWM2: number;
}

/**
 * A compact dynamic line rating: hot conductors shed less heat, while direct sun adds heat.
 * It is intentionally bounded so weather changes capacity without making a built line vanish.
 */
export function transmissionRatingW(
  line: Pick<TransmissionLineOperatingType, "corridorId" | "capacityW">,
  conditions: TransmissionConditions,
): number {
  const corridor = TRANSMISSION_CORRIDORS.find(
    ({ id }) => id === line.corridorId,
  );
  if (!corridor) return 0;
  const heatDerate =
    Math.max(0, conditions.temperatureC - corridor.heatDerateStartsC) *
    corridor.heatDeratePerC;
  const sunDerate =
    Math.min(1, Math.max(0, conditions.solarIrradianceWM2) / 1000) *
    corridor.solarDerateFraction;
  return Math.round(line.capacityW * Math.max(0.6, 1 - heatDerate - sunDerate));
}

export function transmissionCapacityW(
  lines: readonly TransmissionLineOperatingType[],
  conditions: TransmissionConditions,
): number {
  return lines
    .filter(({ yearsToBuildLeft }) => yearsToBuildLeft <= 0)
    .reduce((sum, line) => sum + transmissionRatingW(line, conditions), 0);
}

export interface IntertieContext extends IntertieAccessContext {
  /** Acknowledged tutorial exercise only; never a random market shock. */
  tutorialSupplyLimitW?: number;
  seed: number;
  /** Monthly archetype shapes are written for the north and shift six months in the south */
  southernHemisphere: boolean;
  /** How much of a peak-sharing neighbour's supply disappears at full local stress */
  peakSharingImportLoss: number;
  /**
   * Replace this run's seeded wet/dry years and calm days with their average, for describing a
   * typical year to the player rather than the specific luck the next few years will bring.
   */
  expectedLuck?: boolean;
}

export function intertieContextForGame(
  game: Pick<GameType, "seed" | "location" | "difficulty"> &
    Partial<
      Pick<GameType, "scenarioId" | "customScenario" | "tutorialIntertieStress">
    >,
): IntertieContext {
  return {
    ...accessContextForGame({ ...game, scenarioId: game.scenarioId ?? -1 }),
    tutorialSupplyLimitW: game.tutorialIntertieStress?.active
      ? 150e6
      : undefined,
    seed: game.seed,
    southernHemisphere: game.location.lat < 0,
    peakSharingImportLoss:
      DIFFICULTIES[game.difficulty]?.peakSharingImportLoss ?? 0.5,
  };
}

const HEAT_STRESS_STARTS_C = 30;
const HEAT_STRESS_FULL_C = 38;
const COLD_STRESS_STARTS_C = -5;
const COLD_STRESS_FULL_C = -20;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How hard extreme local weather is pushing the whole region, 0..1 for each of heat and cold.
 * Neighbours usually feel the same weather system, so this doubles as their stress; a neighbour
 * that shares your peaks follows the gentler `loadStress` instead.
 */
export function gridStress(temperatureC: number): {
  heat: number;
  cold: number;
} {
  return {
    heat: clamp01(
      (temperatureC - HEAT_STRESS_STARTS_C) /
        (HEAT_STRESS_FULL_C - HEAT_STRESS_STARTS_C),
    ),
    cold: clamp01(
      (COLD_STRESS_STARTS_C - temperatureC) /
        (COLD_STRESS_STARTS_C - COLD_STRESS_FULL_C),
    ),
  };
}

// A neighbour that shares your peaks is squeezed by the same heating and cooling load you are,
// which builds from the edges of the comfort band, well before the extremes that derate hydro,
// wind and thermal fleets. On the extreme-weather scale above, a temperate city's summer or
// winter peak barely registered, so the peak-sharing penalty (and its difficulty setting) only
// ever showed up in desert and tropical cities.
const LOAD_HEAT_STARTS_C = 24;
const LOAD_HEAT_FULL_C = 34;
const LOAD_COLD_STARTS_C = 8;
const LOAD_COLD_FULL_C = -7;

/** How hard heating and cooling demand is pushing the region, 0..1 for each of heat and cold */
export function loadStress(temperatureC: number): {
  heat: number;
  cold: number;
} {
  return {
    heat: clamp01(
      (temperatureC - LOAD_HEAT_STARTS_C) /
        (LOAD_HEAT_FULL_C - LOAD_HEAT_STARTS_C),
    ),
    cold: clamp01(
      (LOAD_COLD_STARTS_C - temperatureC) /
        (LOAD_COLD_STARTS_C - LOAD_COLD_FULL_C),
    ),
  };
}

/**
 * The stress a neighbour feels: a peak-sharing one (a `null` stress loss) follows your load, every
 * other kind follows extreme weather.
 */
function neighbourStress(
  archetype: IntertieArchetypeType,
  temperatureC: number,
): { heat: number; cold: number } {
  const grid = gridStress(temperatureC);
  const load = loadStress(temperatureC);
  return {
    heat: archetype.heatStressLoss === null ? load.heat : grid.heat,
    cold: archetype.coldStressLoss === null ? load.cold : grid.cold,
  };
}

/** A stable per-market offset, so neighbours with the same archetype still have their own luck */
function marketIndex(marketId: string): number {
  let hash = 0;
  for (let i = 0; i < marketId.length; i++) {
    hash = (Math.imul(hash, 31) + marketId.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) % 100000;
}

const MINUTES_PER_GAME_YEAR = DAYS_PER_YEAR * 1440;

/** Neighbours share the player's hemisphere unless their market data says otherwise */
function marketSouthern(
  market: AdjacentMarketDefinitionType,
  context: Pick<IntertieContext, "southernHemisphere">,
): boolean {
  return market.seasonHemisphere
    ? market.seasonHemisphere === "SOUTH"
    : context.southernHemisphere;
}

/** The yearly and calm-day multipliers, or their averages when describing a typical year */
function neighbourLuck(
  market: AdjacentMarketDefinitionType,
  context: Pick<IntertieContext, "seed" | "expectedLuck">,
  minute: number,
): number {
  if (context.expectedLuck) {
    const archetype = INTERTIE_ARCHETYPES[market.archetype];
    return 1 - archetype.lullChance * (1 - archetype.lullAvailability);
  }
  return (
    neighbourYearFactor(market, context.seed, minute) *
    neighbourLullFactor(market, context.seed, minute)
  );
}

/** 0..11, shifted so archetype shapes written for the north line up with southern seasons */
export function archetypeMonth(minute: number, southernHemisphere: boolean) {
  const month = Math.floor(minute / (DAYS_PER_MONTH * 1440)) % 12;
  return southernHemisphere ? (month + 6) % 12 : month;
}

/** A wet (>1) or dry (<1) year for the neighbour, fixed for each game year */
export function neighbourYearFactor(
  market: AdjacentMarketDefinitionType,
  seed: number,
  minute: number,
): number {
  const archetype = INTERTIE_ARCHETYPES[market.archetype];
  if (!archetype.yearlyVariability) return 1;
  const year = Math.floor(minute / MINUTES_PER_GAME_YEAR);
  const draw = normalAt(
    seed,
    RANDOM_STREAM.transmissionYears,
    marketIndex(market.id) * 1000 + year,
  );
  return Math.min(1.15, Math.max(0.6, 1 + draw * archetype.yearlyVariability));
}

/** Whether the neighbour's simulated day (one per game month) is a calm, low-output spell */
export function neighbourLullFactor(
  market: AdjacentMarketDefinitionType,
  seed: number,
  minute: number,
): number {
  const archetype = INTERTIE_ARCHETYPES[market.archetype];
  if (!archetype.lullChance) return 1;
  const day = Math.floor(minute / 1440);
  const draw = randomAt(
    seed,
    RANDOM_STREAM.transmissionLulls,
    marketIndex(market.id) * 10000 + day,
  );
  return draw < archetype.lullChance ? archetype.lullAvailability : 1;
}

/**
 * Share (0..1) of the independent neighboring supply allocation available right now.
 * Physical line rating is a separate constraint.
 */
export function importAvailabilityFraction(
  corridorId: string,
  context: IntertieContext,
  minute: number,
  conditions: Pick<TransmissionConditions, "temperatureC">,
): number {
  const market = adjacentMarketForCorridor(corridorId);
  if (!market) return 0;
  const archetype = INTERTIE_ARCHETYPES[market.archetype];
  const month = archetypeMonth(minute, marketSouthern(market, context));
  const hour = Math.floor((minute % 1440) / 60);
  const stress = neighbourStress(archetype, conditions.temperatureC);
  const heatLoss = archetype.heatStressLoss ?? context.peakSharingImportLoss;
  const coldLoss = archetype.coldStressLoss ?? context.peakSharingImportLoss;
  const seasonal =
    archetype.monthlyAvailability[month] * archetype.hourlyAvailability[hour];
  const luck = neighbourLuck(market, context, minute);
  return clamp01(
    Math.min(1, seasonal * luck) *
      (1 - heatLoss * stress.heat - coldLoss * stress.cold),
  );
}

/**
 * Watts the neighbour can send: the smaller of weather-adjusted wire capacity and available
 * neighboring generation. Additional paths still share the same market budget at allocation.
 */
export function intertieImportLimitW(
  line: Pick<TransmissionLineOperatingType, "corridorId" | "capacityW">,
  context: IntertieContext,
  minute: number,
  conditions: TransmissionConditions,
): number {
  return Math.min(
    transmissionRatingW(line, conditions),
    neighborImportSupplyW(line.corridorId, context, minute, conditions),
  );
}

/** Offline, seeded wholesale price in dollars per MWh, shaped by the neighbour's archetype. */
export function adjacentMarketPricePerMWh(
  corridorId: string,
  context: Pick<
    IntertieContext,
    "seed" | "southernHemisphere" | "expectedLuck"
  >,
  minute: number,
  conditions: Pick<TransmissionConditions, "temperatureC">,
): number {
  const market = adjacentMarketForCorridor(corridorId);
  if (!market) return 0;
  const archetype = INTERTIE_ARCHETYPES[market.archetype];
  const tick = Math.floor(minute / TICK_MINUTES);
  const month = archetypeMonth(minute, marketSouthern(market, context));
  const hour = Math.floor((minute % 1440) / 60);
  const stress = neighbourStress(archetype, conditions.temperatureC);
  const scarcity = 1 - neighbourLuck(market, context, minute);
  // Each neighbour gets its own noise, so which line is cheaper can change tick to tick.
  // The index wraps to 32 bits inside normalAt; the collisions that allows are harmless here.
  const noise =
    normalAt(
      context.seed,
      RANDOM_STREAM.transmissionMarkets,
      marketIndex(market.id) * 131071 + tick,
    ) * archetype.priceNoise;
  return Math.max(
    5,
    Math.round(
      (market.basePricePerMWh +
        archetype.hourlyPriceOffset[hour] +
        archetype.monthlyPriceOffset[month] +
        archetype.heatStressPremium * stress.heat +
        archetype.coldStressPremium * stress.cold +
        archetype.scarcityPremium * scarcity +
        noise) *
        10,
    ) / 10,
  );
}

export function neighborImportSupplyW(
  corridorId: string,
  context: IntertieContext,
  minute: number,
  conditions: TransmissionConditions,
): number {
  const market = effectiveMarket(corridorId, context);
  const supply =
    corridorId === "california-north" &&
    context.tutorialSupplyLimitW !== undefined
      ? Math.min(market?.availableSupplyW || 0, context.tutorialSupplyLimitW)
      : market?.availableSupplyW || 0;
  return (
    supply * importAvailabilityFraction(corridorId, context, minute, conditions)
  );
}
export interface IntertieOffer {
  marketId?: string;
  marketImportLimitW?: number;
  marketExportLimitW?: number;
  importLimitW: number;
  exportLimitW: number;
  pricePerMWh: number;
}

/**
 * Splits a cleared total across lines in merit order: imports come from the cheapest neighbour
 * first and exports go to the best-paying one first, so which interties you own changes what
 * trading costs, not just how much can flow.
 */
export function allocateIntertieFlows(
  offers: readonly IntertieOffer[],
  importedW: number,
  exportedW: number,
): { importedW: number[]; exportedW: number[] } {
  const imports = offers.map(() => 0);
  const exports = offers.map(() => 0);
  const indexed = offers.map((offer, index) => ({ offer, index }));
  // Equal prices keep line order both ways, so a tie never depends on the direction of trade.
  const cheapestFirst = [...indexed].sort(
    (a, b) => a.offer.pricePerMWh - b.offer.pricePerMWh || a.index - b.index,
  );
  const dearestFirst = [...indexed].sort(
    (a, b) => b.offer.pricePerMWh - a.offer.pricePerMWh || a.index - b.index,
  );
  const importUsed = new Map<string, number>();
  const exportUsed = new Map<string, number>();
  let remaining = importedW;
  for (const { offer, index } of cheapestFirst) {
    if (remaining <= 0) break;
    imports[index] = Math.min(
      remaining,
      Math.max(0, offer.importLimitW),
      Math.max(
        0,
        (offer.marketImportLimitW ?? Infinity) -
          (offer.marketId ? importUsed.get(offer.marketId) || 0 : 0),
      ),
    );
    if (offer.marketId)
      importUsed.set(
        offer.marketId,
        (importUsed.get(offer.marketId) || 0) + imports[index],
      );
    remaining -= imports[index];
  }
  remaining = exportedW;
  for (const { offer, index } of dearestFirst) {
    if (remaining <= 0) break;
    exports[index] = Math.min(
      remaining,
      Math.max(0, offer.exportLimitW),
      Math.max(
        0,
        (offer.marketExportLimitW ?? Infinity) -
          (offer.marketId ? exportUsed.get(offer.marketId) || 0 : 0),
      ),
    );
    if (offer.marketId)
      exportUsed.set(
        offer.marketId,
        (exportUsed.get(offer.marketId) || 0) + exports[index],
      );
    remaining -= exports[index];
  }
  return { importedW: imports, exportedW: exports };
}

export function allowsImports(policy: TradingPolicyType): boolean {
  return policy === "BALANCED" || policy === "RELIABILITY_FIRST";
}

export function allowsExports(policy: TradingPolicyType): boolean {
  return policy === "BALANCED" || policy === "SURPLUS_ONLY";
}

export function clearTransmissionMarket({
  localSupplyW,
  demandW,
  capacityW,
  importLimitW,
  exportLimitW,
  policy,
}: {
  localSupplyW: number;
  demandW: number;
  capacityW: number;
  importLimitW: number;
  exportLimitW: number;
  policy: TradingPolicyType;
}): { importedW: number; exportedW: number; localAvailableSupplyW: number } {
  const shortageW = Math.max(0, demandW - localSupplyW);
  const importedW = allowsImports(policy)
    ? Math.min(shortageW, capacityW, importLimitW)
    : 0;
  const exportedW =
    importedW === 0 && allowsExports(policy)
      ? Math.min(
          Math.max(0, localSupplyW + importedW - demandW),
          capacityW - importedW,
          exportLimitW,
        )
      : 0;
  const availableW = localSupplyW + importedW - exportedW;
  const roundingSlack =
    Number.EPSILON * Math.max(1, Math.abs(availableW), Math.abs(demandW)) * 8;
  return {
    importedW,
    exportedW,
    // Adding a computed deficit back to local supply can round a fraction of a watt
    // below demand and trigger a false blackout. Fully covered demand is exact;
    // capped imports retain the real shortage.
    localAvailableSupplyW:
      Math.abs(availableW - demandW) <= roundingSlack ? demandW : availableW,
  };
}

/**
 * Embodied emissions from building one corridor, in kgCO2e. The authored data records what a
 * route costs but not how long it is, so cost per watt stands in for length and terrain, damped
 * by an exponent because much of what makes an expensive corridor expensive -- land, permits,
 * lawyers, engineers -- emits almost nothing. See docs/construction-emissions.md.
 */
export function corridorConstructionKgco2e(
  corridor: Pick<
    TransmissionCorridorDefinitionType,
    "buildCost" | "capacityW" | "routeType"
  >,
): number {
  if (!(corridor.capacityW > 0)) return 0;
  const costPerW = corridor.buildCost / corridor.capacityW;
  const perW =
    INTERTIE_CONSTRUCTION_KGCO2E_PER_W *
    Math.pow(
      costPerW / INTERTIE_CONSTRUCTION_REFERENCE_COST_PER_W,
      INTERTIE_CONSTRUCTION_COST_EXPONENT,
    ) *
    (corridor.routeType === "EXISTING"
      ? INTERTIE_CONSTRUCTION_EXISTING_MULTIPLIER
      : 1);
  return perW * corridor.capacityW;
}

/**
 * The largest single point-to-point link the world knows how to build, by year. One link means
 * one AC circuit or one HVDC bipole, never a corridor carrying several: Itaipu is 3.15 GW per
 * bipole even though its corridor moves twice that.
 *
 * AC leads until the mid-1980s, when Itaipu's bipole passes 765 kV, and HVDC has led since.
 * The table stops climbing after Changji-Guquan because the binding constraint stops being the
 * hardware: 12 GW arriving on one link is already larger than most grids can absorb losing all
 * at once, so the limit becomes the receiving system's contingency rule rather than the valves.
 */
const INTERTIE_TECHNOLOGY_CEILING: readonly (readonly [number, number])[] = [
  [0, 0.3e9], // 220-230 kV AC, the top commercial class before 345 kV
  [1953, 0.7e9], // First 345 kV line, AEP
  [1965, 2.0e9], // First 735 kV system, Hydro-Quebec
  [1969, 2.4e9], // First 765 kV line, AEP
  [1985, 3.15e9], // Itaipu +/-600 kV bipole overtakes AC
  [2010, 6.4e9], // Xiangjiaba-Shanghai, first +/-800 kV UHVDC
  [2014, 8.0e9], // Hami-Zhengzhou
  [2019, 12.0e9], // Changji-Guquan, +/-1100 kV. Unbeaten since.
  [2050, 15.0e9], // Extrapolated, and deliberately slight
];

export function intertieTechnologyCeilingW(year: number): number {
  let ceiling = INTERTIE_TECHNOLOGY_CEILING[0][1];
  for (const [from, capacityW] of INTERTIE_TECHNOLOGY_CEILING) {
    if (year >= from) ceiling = capacityW;
  }
  return ceiling;
}

export interface IntertieUpgradeQuote {
  targetCapacityW: number;
  buildCost: number;
  annualOperatingCost: number;
  yearsToBuild: number;
  constructionKgco2eTotal: number;
}

/** How many 1.5x steps this line has already taken above its corridor's authored rating. */
export function intertieUpgradeCount(
  line: Pick<TransmissionLineOperatingType, "corridorId" | "capacityW">,
  context?: IntertieAccessContext,
): number {
  const corridor = effectiveCorridor(line.corridorId, context);
  if (!corridor || !(corridor.capacityW > 0)) return 0;
  return Math.max(
    0,
    Math.round(
      Math.log(line.capacityW / corridor.capacityW) /
        Math.log(INTERTIE_UPGRADE_STEP),
    ),
  );
}

/**
 * The most this corridor may ever carry: whichever runs out first, the technology of the day or
 * the regional market's physical supply/demand scale. Purchased utility supply is a separate
 * budget, so a physical upgrade can be partly or entirely stranded; the UI discloses this.
 */
export function intertieCapacityCeilingW(
  corridorId: string,
  year: number,
): number {
  const market = adjacentMarketForCorridor(corridorId);
  return Math.min(
    intertieTechnologyCeilingW(year),
    Math.max(market?.availableSupplyW || 0, market?.availableDemandW || 0) ||
      Infinity,
  );
}

/**
 * What the next upgrade of this line would cost and deliver, or undefined when there is no next
 * one. Priced off the corridor's own per-watt cost so an expensive route stays expensive to
 * widen, at about half of what the same capacity would cost as a fresh corridor, escalating as
 * the work moves from restringing conductor to rebuilding structures.
 */
export function intertieUpgradeQuote(
  line: Pick<
    TransmissionLineOperatingType,
    "corridorId" | "capacityW" | "annualOperatingCost"
  >,
  year: number,
  buildCostMultiplier = 1,
  buildTimeMultiplier = 1,
  context?: IntertieAccessContext,
): IntertieUpgradeQuote | undefined {
  const corridor = effectiveCorridor(line.corridorId, context);
  if (!corridor) return undefined;
  const step = intertieUpgradeCount(line, context);
  if (step >= MAX_INTERTIE_UPGRADES) return undefined;
  const targetCapacityW = Math.round(line.capacityW * INTERTIE_UPGRADE_STEP);
  if (targetCapacityW > intertieCapacityCeilingW(line.corridorId, year)) {
    return undefined;
  }
  const addedW = targetCapacityW - line.capacityW;
  const newBuildCostPerW = corridor.buildCost / corridor.capacityW;
  const buildCost =
    addedW *
    newBuildCostPerW *
    INTERTIE_UPGRADE_COST_SHARE *
    (INTERTIE_UPGRADE_COST_ESCALATION[step] ?? 1) *
    buildCostMultiplier;
  return {
    targetCapacityW,
    buildCost,
    annualOperatingCost:
      line.annualOperatingCost *
      Math.pow(
        targetCapacityW / line.capacityW,
        INTERTIE_UPGRADE_OPEX_EXPONENT,
      ),
    yearsToBuild:
      corridor.yearsToBuild * INTERTIE_UPGRADE_TIME_SHARE * buildTimeMultiplier,
    // The same per-watt intensity as the corridor itself, charged on the watts being added.
    constructionKgco2eTotal:
      (corridorConstructionKgco2e(corridor) / corridor.capacityW) * addedW,
  };
}

/** Build a chosen tier in one project using the same costs, timing and limits as staged upgrades. */
export function intertieBuildQuote(
  corridorId: string,
  year: number,
  tier = 1,
  context?: IntertieAccessContext,
):
  | (TransmissionCorridorDefinitionType & { constructionKgco2eTotal: number })
  | undefined {
  const corridor = effectiveCorridor(corridorId, context);
  if (
    !corridor ||
    !Number.isInteger(tier) ||
    tier < 1 ||
    tier > MAX_INTERTIE_UPGRADES + 1
  )
    return undefined;
  const result = {
    ...corridor,
    constructionKgco2eTotal: corridorConstructionKgco2e(corridor),
  };
  for (let step = 1; step < tier; step++) {
    const upgrade = intertieUpgradeQuote(
      {
        corridorId,
        capacityW: result.capacityW,
        annualOperatingCost: result.annualOperatingCost,
      },
      year,
      1,
      1,
      context,
    );
    if (!upgrade) return undefined;
    result.capacityW = upgrade.targetCapacityW;
    result.buildCost += upgrade.buildCost;
    result.yearsToBuild += upgrade.yearsToBuild;
    result.annualOperatingCost = upgrade.annualOperatingCost;
    result.constructionKgco2eTotal += upgrade.constructionKgco2eTotal;
  }
  return result;
}
