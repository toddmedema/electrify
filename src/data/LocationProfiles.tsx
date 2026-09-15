import { FuelPricesType, LocationType } from "../Types";

type PricedFuel = "Coal" | "Natural Gas" | "Oil" | "Uranium";
type FuelMultipliers = { [fuel in PricedFuel]: number };

const US_PRICES: FuelMultipliers = {
  Coal: 1,
  "Natural Gas": 1,
  Oil: 1,
  Uranium: 1,
};

// The game has one long, deterministic US price history. These broad landed-price ratios keep
// that history and its shocks while moving its level to something recognisably regional.
const REGION_FUEL_MULTIPLIERS: Record<string, FuelMultipliers> = {
  "North America": US_PRICES,
  "South America": { Coal: 1.05, "Natural Gas": 1.25, Oil: 1.05, Uranium: 1.1 },
  Europe: { Coal: 1.5, "Natural Gas": 3, Oil: 1.15, Uranium: 1.2 },
  Africa: { Coal: 1.05, "Natural Gas": 1.35, Oil: 1.2, Uranium: 1.2 },
  "Middle East": { Coal: 1.7, "Natural Gas": 0.6, Oil: 0.65, Uranium: 1.2 },
  // Caspian gas and Kazakh coal are produced and burned inside the region at administered
  // prices, so the level sits near or below the US series rather than at the Gulf's export
  // discount. Coal is the outlier: Ekibastuz burns at the mine.
  "Central Asia": { Coal: 0.5, "Natural Gas": 0.7, Oil: 0.9, Uranium: 1 },
  // Georgia and Armenia buy gas from Russia and Azerbaijan on negotiated contracts, above the
  // producers' domestic level and below Europe's marginal LNG. Azerbaijan is a producer and
  // takes the override below.
  Caucasus: { Coal: 1.5, "Natural Gas": 1.4, Oil: 1.1, Uranium: 1.2 },
  "South Asia": { Coal: 0.75, "Natural Gas": 1.7, Oil: 1.15, Uranium: 1.15 },
  "East Asia": { Coal: 1.05, "Natural Gas": 2.5, Oil: 1.15, Uranium: 1.1 },
  "Southeast Asia": { Coal: 0.8, "Natural Gas": 1.5, Oil: 1.05, Uranium: 1.15 },
  Oceania: { Coal: 0.65, "Natural Gas": 1.7, Oil: 1.1, Uranium: 1.2 },
};

const REGION_CUSTOMERS: Record<string, number> = {
  "North America": 1000000,
  "South America": 800000,
  Europe: 900000,
  Africa: 350000,
  "Middle East": 700000,
  "Central Asia": 600000,
  Caucasus: 500000,
  "South Asia": 1500000,
  "East Asia": 1800000,
  "Southeast Asia": 1200000,
  Oceania: 650000,
};

const GEOTHERMAL_COUNTRIES = new Set([
  "Chile",
  "Costa Rica",
  "El Salvador",
  "Guatemala",
  "Iceland",
  "Indonesia",
  "Italy",
  "Japan",
  "Kenya",
  "Mexico",
  "New Zealand",
  "Nicaragua",
  "Philippines",
  "Turkey",
]);

const HYDRO_COUNTRIES = new Set([
  "Austria",
  "Bhutan",
  "Brazil",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Costa Rica",
  "Ecuador",
  "Ethiopia",
  "Iceland",
  "Laos",
  "Nepal",
  "New Zealand",
  "Norway",
  "Paraguay",
  "Peru",
  "Sweden",
  "Switzerland",
  "Tajikistan",
  "Venezuela",
  // The two halves of Kariba. Hydro is about 85% of Zambia's generation and the larger share of
  // Zimbabwe's, which is the whole premise of the scenario set in Lusaka.
  "Zambia",
  "Zimbabwe",
]);

// A country-wide US fallback would make hydro available almost everywhere. Use state profiles
// instead: these states generated at least 1 TWh of conventional hydro in 2024 (EIA table 3.14),
// a deliberately material threshold that excludes small producers such as Ohio (0.468 TWh).
// https://www.eia.gov/electricity/annual/table.php?t=epa_03_14.html
const US_HYDRO_STATES = new Set([
  "AK",
  "AL",
  "AR",
  "AZ",
  "CA",
  "CO",
  "GA",
  "ID",
  "IA",
  "KY",
  "ME",
  "MI",
  "MO",
  "MT",
  "NC",
  "ND",
  "NE",
  "NH",
  "NV",
  "NY",
  "OK",
  "OR",
  "PA",
  "SC",
  "SD",
  "TN",
  "VA",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
]);

// The seven states with utility-scale geothermal generation in 2025.
// https://www.eia.gov/energyexplained/geothermal/use-of-geothermal-energy.php
const US_GEOTHERMAL_STATES = new Set([
  "CA",
  "HI",
  "ID",
  "NM",
  "NV",
  "OR",
  "UT",
]);

function stateFor(location?: LocationType): string | undefined {
  return location?.admin;
}

// Countries that sit at a different level from the region around them, usually because they
// produce what their neighbours import. Only the fuels named here move; the rest stay regional.
const COUNTRY_FUEL_OVERRIDES: Record<string, Partial<FuelMultipliers>> = {
  Japan: { "Natural Gas": 3 },
  Australia: { Coal: 0.6 },
  Indonesia: { Coal: 0.6 },
  // Russia is split across Europe and East Asia in the catalogue and belongs to neither price
  // level. Regulated domestic gas has long sold far below Henry Hub, and Kuzbass coal reaches
  // domestic plants by rail well under the seaborne price, so Europe's import multipliers were
  // inverting the real ordering: Moscow was paying triple for the gas it exports.
  Russia: { Coal: 0.6, "Natural Gas": 0.5, Oil: 0.85, Uranium: 0.9 },
  // Azerbaijan produces Caspian gas rather than buying it in like the rest of the Caucasus.
  Azerbaijan: { "Natural Gas": 0.7, Oil: 0.8 },
  // Afghanistan produces almost no fuel and trucks the rest in over long land routes.
  Afghanistan: { Coal: 1.3, "Natural Gas": 2, Oil: 1.6 },
};

function multipliersFor(location?: LocationType): FuelMultipliers {
  const regional =
    (location?.region && REGION_FUEL_MULTIPLIERS[location.region]) || US_PRICES;
  const override =
    location?.country && COUNTRY_FUEL_OVERRIDES[location.country];
  return override ? { ...regional, ...override } : regional;
}

const regionalPriceCache = new WeakMap<
  FuelPricesType,
  Map<string, FuelPricesType>
>();

/** Applies a location's stable regional level to one immutable month of the US series. */
export function regionalizeFuelPrices(
  prices: FuelPricesType,
  location?: LocationType,
): FuelPricesType {
  const multipliers = multipliersFor(location);
  if (multipliers === US_PRICES) {
    return prices;
  }
  const key = `${location?.region || ""}|${location?.country || ""}`;
  let byRegion = regionalPriceCache.get(prices);
  if (!byRegion) {
    byRegion = new Map<string, FuelPricesType>();
    regionalPriceCache.set(prices, byRegion);
  }
  const cached = byRegion.get(key);
  if (cached) {
    return cached;
  }
  const scaled = Object.freeze({
    ...prices,
    Coal: prices.Coal * multipliers.Coal,
    "Natural Gas": prices["Natural Gas"] * multipliers["Natural Gas"],
    Oil: prices.Oil * multipliers.Oil,
    Uranium: prices.Uranium * multipliers.Uranium,
  });
  byRegion.set(key, scaled);
  return scaled;
}

export function getStartingCustomers(location?: LocationType): number {
  return (
    (location?.region && REGION_CUSTOMERS[location.region]) ||
    REGION_CUSTOMERS["North America"]
  );
}

export function hasGeothermalResource(location?: LocationType): boolean {
  if (location?.resources?.geothermal !== undefined) {
    return location.resources.geothermal;
  }
  if (location?.country === "United States") {
    const state = stateFor(location);
    return !!state && US_GEOTHERMAL_STATES.has(state);
  }
  return !!location?.country && GEOTHERMAL_COUNTRIES.has(location.country);
}

export function hasHydroResource(location?: LocationType): boolean {
  if (location?.resources?.hydro !== undefined) {
    return location.resources.hydro;
  }
  if (location?.country === "United States") {
    const state = stateFor(location);
    return !!state && US_HYDRO_STATES.has(state);
  }
  return !!location?.country && HYDRO_COUNTRIES.has(location.country);
}
