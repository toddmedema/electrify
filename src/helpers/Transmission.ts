import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  DIFFICULTIES,
  TICK_MINUTES,
} from "../Constants";
import {
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
} from "../data/AdjacentMarkets";
import { INTERTIE_ARCHETYPES } from "../data/IntertieArchetypes";
import { normalAt, randomAt, RANDOM_STREAM } from "./Math";
import {
  AdjacentMarketDefinitionType,
  GameType,
  TradingPolicyType,
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

export interface IntertieContext {
  seed: number;
  /** Monthly archetype shapes are written for the north and shift six months in the south */
  southernHemisphere: boolean;
  /** How much of a peak-sharing neighbour's supply disappears at full local stress */
  peakSharingImportLoss: number;
}

export function intertieContextForGame(
  game: Pick<GameType, "seed" | "location" | "difficulty">,
): IntertieContext {
  return {
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
 * How hard local weather is pushing the whole region, 0..1 for each of heat and cold. Neighbours
 * usually feel the same weather system, so this doubles as their stress.
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

/** A stable per-market offset, so neighbours with the same archetype still have their own luck */
function marketIndex(marketId: string): number {
  let hash = 0;
  for (let i = 0; i < marketId.length; i++) {
    hash = (Math.imul(hash, 31) + marketId.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) % 100000;
}

const MINUTES_PER_GAME_YEAR = DAYS_PER_YEAR * 1440;

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
 * Share (0..1) of a line's weather-adjusted rating the neighbour can fill with imports right now.
 * The market's absolute `availableSupplyW` still applies on top.
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
  const month = archetypeMonth(minute, context.southernHemisphere);
  const hour = Math.floor((minute % 1440) / 60);
  const stress = gridStress(conditions.temperatureC);
  const heatLoss = archetype.heatStressLoss ?? context.peakSharingImportLoss;
  const coldLoss = archetype.coldStressLoss ?? context.peakSharingImportLoss;
  const seasonal =
    archetype.monthlyAvailability[month] * archetype.hourlyAvailability[hour];
  const luck =
    neighbourYearFactor(market, context.seed, minute) *
    neighbourLullFactor(market, context.seed, minute);
  return clamp01(
    Math.min(1, seasonal * luck) *
      (1 - heatLoss * stress.heat - coldLoss * stress.cold),
  );
}

/** Offline, seeded wholesale price in dollars per MWh, shaped by the neighbour's archetype. */
export function adjacentMarketPricePerMWh(
  corridorId: string,
  context: Pick<IntertieContext, "seed" | "southernHemisphere">,
  minute: number,
  conditions: Pick<TransmissionConditions, "temperatureC">,
): number {
  const market = adjacentMarketForCorridor(corridorId);
  if (!market) return 0;
  const archetype = INTERTIE_ARCHETYPES[market.archetype];
  const tick = Math.floor(minute / TICK_MINUTES);
  const month = archetypeMonth(minute, context.southernHemisphere);
  const hour = Math.floor((minute % 1440) / 60);
  const stress = gridStress(conditions.temperatureC);
  const scarcity =
    1 -
    neighbourYearFactor(market, context.seed, minute) *
      neighbourLullFactor(market, context.seed, minute);
  const noise =
    normalAt(context.seed, RANDOM_STREAM.transmissionMarkets, tick) *
    archetype.priceNoise;
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

export interface IntertieOffer {
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
  let remaining = importedW;
  for (const { offer, index } of cheapestFirst) {
    if (remaining <= 0) break;
    imports[index] = Math.min(remaining, Math.max(0, offer.importLimitW));
    remaining -= imports[index];
  }
  remaining = exportedW;
  for (const { offer, index } of dearestFirst) {
    if (remaining <= 0) break;
    exports[index] = Math.min(remaining, Math.max(0, offer.exportLimitW));
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
  const exportedW = allowsExports(policy)
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
