/** Fixed generation-mix proxies, not marginal dispatch or a historical reconstruction.
 * Unknown neighboring mixes use the IEA world average explicitly rather than zero emissions.
 * g/kWh and kg/MWh are numerically identical. EIA/IEA generation CO2 is treated as CO2e;
 * Quebec retains CER's reported generation CO2e, including generation greenhouse gases.
 * These factors omit upstream and infrastructure emissions, as the local operating boundary does.
 */
export interface ImportEmissionsAssumption {
  emissionsKgco2ePerMWh: number;
  emissionsBasis: string;
  emissionsSource: string;
}

const WORLD: ImportEmissionsAssumption = {
  emissionsKgco2ePerMWh: 445,
  emissionsBasis: "World-average proxy, 2024; neighboring mix not measured",
  emissionsSource: "https://www.iea.org/reports/electricity-2025/emissions",
};
const EUROPE: ImportEmissionsAssumption = {
  emissionsKgco2ePerMWh: 175,
  emissionsBasis: "EU-average proxy, 2024; not an hourly or historical mix",
  emissionsSource:
    "https://www.iea.org/reports/electricity-mid-year-update-2025/emissions-power-generation-co2-emissions-are-plateauing",
};
const WASHINGTON: ImportEmissionsAssumption = {
  emissionsKgco2ePerMWh: 249 * 0.45359237,
  emissionsBasis: "Washington generation proxy for Pacific Northwest, 2024",
  emissionsSource: "https://www.eia.gov/electricity/state/washington/",
};
const CALIFORNIA: ImportEmissionsAssumption = {
  emissionsKgco2ePerMWh: 407 * 0.45359237,
  emissionsBasis: "California generation proxy, 2024",
  emissionsSource: "https://www.eia.gov/electricity/state/california/",
};
const QUEBEC: ImportEmissionsAssumption = {
  emissionsKgco2ePerMWh: 1.2,
  emissionsBasis: "Québec generation CO2e proxy, 2022",
  emissionsSource:
    "https://www.cer-rec.gc.ca/en/data-analysis/energy-markets/province-territory-energy-profiles/quebec.html",
};

const MARKET_ASSUMPTIONS: Readonly<Record<string, ImportEmissionsAssumption>> =
  {
    "pacific-northwest": WASHINGTON,
    "pnw-california-upgrade-market": CALIFORNIA,
    "desert-california-upgrade-market": CALIFORNIA,
    "ny-quebec-upgrade-market": QUEBEC,
    "newengland-quebec-upgrade-market": QUEBEC,
    "ontario-quebec-upgrade-market": QUEBEC,
    "geo-london-continental-core": EUROPE,
    "geo-dublin-continental-core": EUROPE,
    "geo-paris-continental-core": EUROPE,
  };

export function importEmissionsAssumption(
  marketId: string,
): ImportEmissionsAssumption {
  return MARKET_ASSUMPTIONS[marketId] || WORLD;
}
