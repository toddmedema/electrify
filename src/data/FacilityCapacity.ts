import type { GameType } from "../Types";
import { pow } from "../helpers/Pow";
import { isUtilityExpansionGame } from "../helpers/ExpansionContext";
import { legacyGeneratorMaxPeakW } from "./LegacyEra";
import { gasSteamMaxPeakW } from "./GasPlantVintages";

type CapacityContext = Pick<
  GameType,
  "date" | "scenarioId" | "customScenario" | "utilityExpansion"
>;

export function airborneWindMaxPeakW(year: number): number {
  return Math.min(500000000, 1200000 * pow(2, (year - 2028) / 2));
}

/** Immutable physical bounds; no prices, fuel tables, weather or self-authored save quotes. */
export function generatorMaxPeakW(
  game: CapacityContext,
  name: string,
  hydroMaxPeakW = 0,
): number {
  const legacy = legacyGeneratorMaxPeakW(game, name);
  if (legacy !== undefined) return legacy;
  const year = game.date.year;
  switch (name) {
    case "Coal":
    case "Natural Gas CC":
    case "Oil":
      return 6000000000;
    case "Nuclear":
      return 8000000000;
    case "Natural Gas Peaker":
      return 2000000000;
    case "Natural Gas Steam":
      return gasSteamMaxPeakW(year);
    case "Biomass":
      return 50000000;
    case "Wind":
      return 1500000000;
    case "Offshore Wind":
      return Math.min(1500000000, 5000000 * pow(2, (year - 1991) / 3.5));
    case "Airborne Wind":
      return airborneWindMaxPeakW(year);
    case "Solar":
      return year < 2000 ? 100000000 : 2000000000;
    case "Hydro":
      return hydroMaxPeakW;
    case "Geothermal":
      return game.utilityExpansion && isUtilityExpansionGame(game)
        ? 25e6
        : 800000000;
    case "Enhanced Geothermal":
      return 500000000;
    default:
      return 0;
  }
}

export function storageMaxPeakWh(name: string, year: number): number {
  switch (name) {
    case "Battery":
      return (year < 2021 ? 200000000 : 600000000) * pow(2, (year - 2018) / 4);
    case "Iron-Air Battery":
      return 10000000000;
    case "Pumped Hydro":
      return 20000000000;
    default:
      return 0;
  }
}

/** Added storage retains the canonical technology duration even for inherited plant geometry. */
export function storagePowerW(name: string, peakWh: number): number {
  switch (name) {
    case "Battery":
      return 0.25 * peakWh;
    case "Iron-Air Battery":
      return peakWh / 100;
    case "Pumped Hydro":
      return 0.1 * peakWh;
    default:
      return 0;
  }
}
