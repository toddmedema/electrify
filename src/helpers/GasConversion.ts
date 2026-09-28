import { MINUTES_PER_MONTH } from "./DateTime";
import { facilityAgeYears } from "./Financials";
import { GENERATORS } from "../data/Facilities";
import { getInflationIndex } from "../data/Economy";
import { FacilityOperatingType, GameType, isStorage } from "../Types";

// Game-design assumptions: retain the turbine and nameplate capacity, add the steam side for
// half the price of a new CC, and take six months offline. This is not a site engineering quote.
export const GAS_CONVERSION_MINUTES = 6 * MINUTES_PER_MONTH;

export function gasConversionQuote(
  facility: FacilityOperatingType,
  game: GameType,
) {
  if (
    isStorage(facility) ||
    facility.gasCycle !== "simple" ||
    facility.fuel !== "Natural Gas" ||
    facility.yearsToBuildLeft > 0 ||
    facility.upgradeInProgress ||
    game.date.year < 1990 ||
    facility.lifespanYears - facilityAgeYears(facility, game.date.minute) <= 0.5
  )
    return undefined;
  const target = GENERATORS(game, facility.peakW, [], []).find(
    (g) => g.gasCycle === "combined",
  );
  return target
    ? { cost: Math.round(target.buildCost * 0.5), target }
    : undefined;
}

export function completeGasConversion(
  facility: FacilityOperatingType,
  game: GameType,
) {
  if (isStorage(facility) || facility.gasCycle !== "simple") return;
  const target = GENERATORS(game, facility.peakW, [], []).find(
    (g) => g.gasCycle === "combined",
  );
  if (!target) return;
  const index = getInflationIndex(game.date, game.startingYear, game.seed);
  const moneyScale = (facility.costIndexAtBuild ?? 1) / index;
  // Keep identity, age, debt, dispatch position, resilience and lifetime accounting intact.
  facility.name = target.name;
  facility.description = target.description;
  facility.gasCycle = "combined";
  facility.btuPerWh = target.btuPerWh;
  facility.spinMinutes = target.spinMinutes;
  facility.minimumStableOutput = target.minimumStableOutput;
  facility.capacityFactor = target.capacityFactor;
  facility.annualOperatingCost = target.annualOperatingCost * moneyScale;
  facility.variableOperatingCostPerMWh =
    (target.variableOperatingCostPerMWh ?? 0) * moneyScale;
  facility.costPerStart = (target.costPerStart ?? 0) * moneyScale;
  facility.assumedStartsPerYear = target.assumedStartsPerYear;
  facility.currentW = 0;
  facility.committed = false;
  facility.generatingLastRealTick = false;
}
