import { intertieMarketTrend, seriesAt } from "./IntertieTrends";

/** Generation-mix proxies by year, not marginal dispatch or an hourly reconstruction.
 * Each researched neighbour carries its own intensity trend from about 1990 to 2050, held flat
 * beyond either end; unknown neighbours use the IEA world average explicitly rather than zero.
 * g/kWh and kg/MWh are numerically identical. Generation CO2 is treated as CO2e.
 * These factors omit upstream and infrastructure emissions, as the local operating boundary does.
 */
export interface ImportEmissionsAssumption {
  emissionsBasis: string;
  emissionsSource: string;
}

const WORLD_KGCO2E_PER_MWH = 445;
const WORLD: ImportEmissionsAssumption = {
  emissionsBasis: "World-average proxy, 2024; neighboring mix not measured",
  emissionsSource: "https://www.iea.org/reports/electricity-2025/emissions",
};

export function importEmissionsAssumption(
  marketId: string,
): ImportEmissionsAssumption {
  const trend = intertieMarketTrend(marketId);
  return trend
    ? {
        emissionsBasis: trend.emissionsBasis,
        emissionsSource: trend.emissionsSource,
      }
    : WORLD;
}

/** kg CO2e per MWh of the neighbour's generation in a (possibly fractional) year. */
export function importEmissionsKgco2ePerMWh(
  marketId: string,
  year: number,
): number {
  const emissions = intertieMarketTrend(marketId)?.emissions;
  return emissions?.length ? seriesAt(emissions, year) : WORLD_KGCO2E_PER_MWH;
}
