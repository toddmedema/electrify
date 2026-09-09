import { TICK_MINUTES } from "../Constants";
import {
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
} from "../data/AdjacentMarkets";
import { normalAt, RANDOM_STREAM } from "./Math";
import { TradingPolicyType, TransmissionLineOperatingType } from "../Types";

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

/** Offline, seeded wholesale price in dollars per MWh. */
export function adjacentMarketPricePerMWh(
  corridorId: string,
  seed: number,
  minute: number,
  conditions: TransmissionConditions,
): number {
  const market = adjacentMarketForCorridor(corridorId);
  if (!market) return 0;
  const tick = Math.floor(minute / TICK_MINUTES);
  const hour = Math.floor((minute % 1440) / 60);
  const eveningPeak = hour >= 17 && hour < 22 ? 18 : 0;
  const solarDiscount =
    (Math.min(1000, Math.max(0, conditions.solarIrradianceWM2)) / 1000) * 16;
  const heatPremium = Math.max(0, conditions.temperatureC - 28) * 1.6;
  const noise = normalAt(seed, RANDOM_STREAM.transmissionMarkets, tick) * 4;
  return Math.max(
    5,
    Math.round(
      (market.basePricePerMWh +
        eveningPeak +
        heatPremium -
        solarDiscount +
        noise) *
        10,
    ) / 10,
  );
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
