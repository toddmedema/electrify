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
]);

function multipliersFor(location?: LocationType): FuelMultipliers {
  const regional =
    (location?.region && REGION_FUEL_MULTIPLIERS[location.region]) || US_PRICES;
  if (location?.country === "Japan") {
    return { ...regional, "Natural Gas": 3 };
  }
  if (location?.country === "Australia" || location?.country === "Indonesia") {
    return { ...regional, Coal: 0.6 };
  }
  return regional;
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
  return !!location?.country && GEOTHERMAL_COUNTRIES.has(location.country);
}

export function hasHydroResource(location?: LocationType): boolean {
  if (location?.resources?.hydro !== undefined) {
    return location.resources.hydro;
  }
  return !!location?.country && HYDRO_COUNTRIES.has(location.country);
}
