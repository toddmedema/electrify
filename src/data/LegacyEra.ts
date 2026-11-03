import type {
  FuelPricesType,
  GameType,
  GeneratorShoppingType,
  ModFacilityNameType,
  StorageShoppingType,
} from "../Types";
import { isLegacyCampaignScenario } from "./LegacyCampaign";

/** Trusted native scenario IDs. A custom/mod copy never acquires campaign privileges. */
export function isLegacyCampaignScenarioId(id: number): boolean {
  return isLegacyCampaignScenario(id);
}

type LegacyContext = Pick<GameType, "scenarioId" | "customScenario" | "date">;
export function isLegacyEraGame(game: LegacyContext): boolean {
  return isLegacyCampaignScenarioId(game.scenarioId) && !game.customScenario;
}

export function getLegacyBuildBounds(
  game: LegacyContext & {
    campaign?: Pick<NonNullable<GameType["campaign"]>, "peakMW">;
  },
): { minW: number; defaultW: number; maxW: number } | undefined {
  if (!isLegacyEraGame(game)) return undefined;
  if (game.date.year < 1902)
    return { minW: 50000, defaultW: 100000, maxW: 500000 };
  if (game.date.year < 1942)
    return { minW: 50000, defaultW: 500000, maxW: 5000000 };
  const minW = 1000000;
  // Match the ordinary slider ceiling; the individual technology/site still owns its cap.
  const maxW = 8000000000;
  const peakMW = game.campaign?.peakMW;
  const targetW =
    peakMW !== undefined && Number.isFinite(peakMW) && peakMW > 0
      ? Math.max(minW, Math.min(maxW, peakMW * 1000000))
      : game.date.year < 1982
        ? 1000000
        : 5000000;
  let magnitudeW = minW;
  while (magnitudeW * 10 < targetW) magnitudeW *= 10;
  const defaultW = Math.min(
    maxW,
    [1, 2, 5, 10].find((leading) => leading * magnitudeW >= targetW)! *
      magnitudeW,
  );
  return { minW, defaultW, maxW };
}

/**
 * Simulation assumptions, not a reconstructed nineteenth-century price index. Before the BLS
 * series begins in 1913 we hold its opening level flat. Later anchors are annual CPI-U (BLS,
 * 1982–84=100); intervening years are interpolated. No recorded 1975+ economy row is replaced.
 * https://www.bls.gov/regions/mid-atlantic/data/ConsumerPriceIndexAnnualandSemiAnnual_Table.htm
 */
const EARLY_CPI: readonly (readonly [number, number])[] = [
  [1882, 9.9],
  [1913, 9.9],
  [1917, 12.8],
  [1920, 20],
  [1922, 16.8],
  [1929, 17.1],
  [1933, 13],
  [1940, 14],
  [1942, 16.3],
  [1945, 18],
  [1950, 24.1],
  [1955, 26.8],
  [1960, 29.6],
  [1962, 30.2],
  [1965, 31.5],
  [1970, 38.8],
  [1973, 44.4],
  [1974, 49.3],
  [1975, 53.8],
];

function interpolate(
  anchors: readonly (readonly [number, number])[],
  year: number,
): number {
  if (year <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [end, value] = anchors[i];
    if (year <= end) {
      const [start, previous] = anchors[i - 1];
      return previous + ((year - start) / (end - start)) * (value - previous);
    }
  }
  return anchors[anchors.length - 1][1];
}

export function legacyCpi(year: number): number {
  return interpolate(EARLY_CPI, year);
}

/** Modeled annual rates: a fixed 6% borrowing benchmark, with CPI-anchor price changes. */
export function legacyEconomy(year: number): {
  prime: number;
  inflation: number;
} {
  return {
    prime: 0.06,
    inflation: legacyCpi(year + 1) / legacyCpi(year) - 1,
  };
}

/**
 * Pre-receipts fuel proxy: carry the first loaded 1975 nominal quote back with the modeled CPI.
 * Oil's 1973–74 transition is a deliberately authored shock, not recovered monthly receipts.
 * The 1979 and 2000–01 rises remain solely in the unchanged recorded series.
 */
export function legacyFuelPrices(
  year: number,
  month: number,
  reference: FuelPricesType,
): FuelPricesType {
  const scale = legacyCpi(year) / legacyCpi(1975);
  const oilTransition =
    year < 1973 ? 0.45 : year === 1973 ? (month < 10 ? 0.45 : 0.75) : 1;
  return Object.freeze({
    Coal: reference.Coal * scale,
    "Natural Gas": reference["Natural Gas"] * scale,
    Oil: reference.Oil * scale * oilTransition,
    Uranium: reference.Uranium * scale,
    Biomass: reference.Biomass * scale,
  });
}

/** One shared, physical inventory survives all CEO generations. Values are fictional sites. */
export const LEGACY_HYDRO_INVENTORY_KEY = "legacy-sierra";
export const LEGACY_HYDRO_SITES = [
  {
    id: "legacy-sierra-first-falls",
    name: "First Falls",
    maxPeakW: 750000,
    availableFromYear: 1895,
    lat: 38.65,
    lon: -121.15,
  },
  {
    id: "legacy-sierra-upper-river",
    name: "Upper River",
    maxPeakW: 5000000,
    availableFromYear: 1902,
    lat: 38.8,
    lon: -120.9,
  },
  {
    id: "legacy-sierra-valley-reservoir",
    name: "Valley Reservoir",
    maxPeakW: 30000000,
    availableFromYear: 1922,
    lat: 38.9,
    lon: -120.7,
  },
  {
    id: "legacy-sierra-regional-reservoir",
    name: "Regional Reservoir",
    maxPeakW: 150000000,
    availableFromYear: 1942,
    lat: 39,
    lon: -120.5,
  },
] as const;

/**
 * All cost inputs below are fictional utility-scale gameplay proxies in 2023 dollars. Early
 * quotes include implicit operating overhead because distribution is outside this model.
 * They are NOT inferred generator-only costs from Pearl Street's bundled district investment.
 * https://edison.rutgers.edu/images/archive/innovations/EL/PearlStreetHeadnote.pdf
 * Heat-rate anchors: ~138 Btu/Wh early steam (IURC glossary p84); national steam 11.699 in 1955
 * and 10.760 in 1960 (EIA A6). Intermediate steam/peaker efficiencies, fixed sizes, ramps,
 * lives and build times are authored assumptions, not additional observed historical anchors.
 * https://pubs.naruc.org/pub/DD7DB67E-1866-DAAC-99FB-36526B06C7C6#page=87
 * https://www.eia.gov/totalenergy/data/annual/txt/ptb1206.html
 */
function eraCost(
  quote: GeneratorShoppingType,
  referenceW: number,
  referenceCost: number,
  fixedShare = 0.15,
): number {
  return (
    referenceCost * (fixedShare + (1 - fixedShare) * (quote.peakW / referenceW))
  );
}

export function applyLegacyGeneratorEra(
  game: LegacyContext,
  quote: GeneratorShoppingType,
): void {
  if (!isLegacyEraGame(game)) return;
  const year = game.date.year;
  if (quote.name === "Coal") {
    if (year < 1902) {
      quote.buildCost = eraCost(quote, 100000, 180000 * (304.702 / 9.9));
      quote.annualOperatingCost = quote.peakW * 0.3 * (304.702 / 9.9);
      quote.maxPeakW = 500000;
      quote.btuPerWh = 138;
      quote.yearsToBuild = 1;
      quote.spinMinutes = 60;
      quote.minimumStableOutput = 0.2;
      quote.lifespanYears = 20;
    } else if (year < 1942) {
      quote.buildCost = eraCost(quote, 1000000, 12000000);
      quote.annualOperatingCost = quote.peakW * 0.45;
      quote.maxPeakW = 5000000;
      quote.btuPerWh = year < 1922 ? 35 : 16.5;
      quote.yearsToBuild = year < 1922 ? 2 : 3;
      quote.spinMinutes = 120;
      quote.minimumStableOutput = 0.2;
      quote.lifespanYears = 30;
    } else {
      // Oil and gas, rather than new coal stations, characterize this regional campaign.
      quote.available = false;
    }
    if (year < 1942) {
      quote.variableOperatingCostPerMWh = 0;
      quote.costPerStart = 0;
      quote.tracksStarts = false;
      quote.description =
        "Era steam proxy: high fuel use and operating overhead";
    }
  } else if (quote.name === "Hydro" && year < 1942) {
    const referenceW = year < 1902 ? 750000 : 5000000;
    quote.buildCost = eraCost(quote, referenceW, referenceW * 8);
    quote.annualOperatingCost = quote.peakW * 0.12;
    quote.yearsToBuild = 3;
  } else if (quote.name === "Oil" && year < 1982) {
    quote.available = year >= 1942;
    quote.buildCost = eraCost(quote, 100000000, 350000000);
    quote.annualOperatingCost = quote.peakW * 0.08;
    quote.maxPeakW = 350000000;
    quote.btuPerWh = year < 1960 ? 11.7 : 10.76;
    quote.spinMinutes = 240;
    quote.minimumStableOutput = 0.2;
    quote.yearsToBuild = 3;
    quote.description =
      "Era oil-fired steam proxy: slow to change and exposed to fuel prices";
  } else if (quote.name === "Nuclear") {
    quote.available = year >= 1960 && year < 1976;
    quote.maxPeakW = 100000000;
    quote.buildCost = eraCost(quote, 100000000, 850000000);
    quote.yearsToBuild = 6.5;
  } else if (quote.name === "Natural Gas Peaker" && year < 1982) {
    quote.available = year >= 1950;
    quote.maxPeakW = 30000000;
    quote.btuPerWh = 13.5;
    quote.buildCost = eraCost(quote, 10000000, 22000000);
    quote.yearsToBuild = 1.5;
  }
  const opens: Partial<Record<ModFacilityNameType, number>> = {
    Geothermal: 1960,
    "Natural Gas CC": 1990,
    Wind: 1982,
    "Offshore Wind": 2022,
    "Airborne Wind": 2028,
    Solar: 1983,
    Biomass: 1982,
  };
  const firstYear = Object.entries(opens).find(
    ([name]) => name === quote.name,
  )?.[1];
  if (firstYear !== undefined && year < firstYear) quote.available = false;
  // Conservative fictional project ceilings, rather than offering today's largest projects in
  // the first commercial year. Solar's 1980s megawatt scale is discussed in DOE's timeline:
  // https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
  if (quote.name === "Solar" && year < 2010)
    quote.maxPeakW = year < 2000 ? 10000000 : 100000000;
  if (quote.name === "Wind" && year < 2010)
    quote.maxPeakW =
      year < 1990 ? 50000000 : year < 2000 ? 200000000 : 500000000;
  if (quote.fuel === "Sun" && year < 1983) quote.available = false;
  if (quote.fuel === "Wind" && year < 1982) quote.available = false;
}

export function applyLegacyStorageEra(
  game: LegacyContext,
  quote: StorageShoppingType,
): void {
  if (!isLegacyEraGame(game)) return;
  // Regional planning assumptions: San Luis opened in 1968; Helms in 1984. No Li-ion before 2009.
  // https://www.usbr.gov/projects/index.php?id=577
  if (quote.name === "Pumped Hydro" && game.date.year < 1968)
    quote.available = false;
}
