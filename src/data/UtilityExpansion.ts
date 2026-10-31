import type {
  LocationType,
  ScenarioFacilityType,
  UtilityId,
  UtilityTargetId,
} from "../Types";

/** Fictional 2005-dollar portfolios; the historical reference years are not a reconstruction. */
export const EXPANSION_SCENARIO_ID = 116;
/** Existing Ridge package, quoted by winterizationPrice for 100 MW in January 2005 dollars.
 * Freeze inherited book cost so import validation does not depend on economy loading.
 * New construction continues to use the dated winterization owner.
 */
export const INHERITED_COLD_PACKAGE_COST_2005: Readonly<
  Record<string, number | undefined>
> = {
  "scenario-116-ridge-gas-cc": 147475,
};

export type UtilityEnergyShares = Readonly<{
  Residential: number;
  Commercial: number;
  Industrial: number;
}>;
export interface UtilityEntitlementDefinition {
  id: string;
  name: string;
  nominalW: number;
  deliverability: number;
  pricePerMWh: number;
  marketId?: string;
  emissionsKgPerMWh?: number;
  balancing?: boolean;
  reductionYear?: number;
  reducedNominalW?: number;
}
export interface UtilityAreaDefinition {
  id: UtilityId;
  name: string;
  location: LocationType;
  customers: number;
  addressablePool: number;
  annualEnergyMWh: number;
  peakDemandW: number;
  energyShares: UtilityEnergyShares;
  annualNetworkOM: number;
  demandScale: number;
  demandShapeExponent: number;
  facilities: ScenarioFacilityType[];
  sourceInterfaceW: number;
  entitlements: UtilityEntitlementDefinition[];
}
export interface UtilityTargetDefinition {
  id: UtilityTargetId;
  name: string;
  corridorId: string;
  equityPrice: number;
  assumedDebt: number;
  fee: number;
}
const location = (
  id: string,
  name: string,
  lat: number,
  long: number,
): LocationType => ({
  id,
  name: `${name}, VT`,
  admin: "VT",
  country: "United States",
  region: "North America",
  timeZone: "America/New_York",
  lat,
  long,
  offshore: false,
  // Existing fictional hydro claims are seeded separately; no new sites are authored.
  resources: { hydro: false, geothermal: false },
});
export const VERMONT_REGIONAL_MARKET_ID = "vt-valley-pool";
export const UTILITY_AREAS: Readonly<Record<UtilityId, UtilityAreaDefinition>> =
  {
    champlain: {
      id: "champlain",
      name: "Champlain Electric",
      location: location("BurlingtonVT", "Burlington", 44.4759, -73.2121),
      customers: 90000,
      addressablePool: 180000,
      annualEnergyMWh: 2000000,
      peakDemandW: 352e6,
      energyShares: { Residential: 0.35, Commercial: 0.45, Industrial: 0.2 },
      annualNetworkOM: 40e6,
      // Fitted against fixed-account, neutral-price 2005 weather; see calibration fixture.
      demandScale: 6.595735259684209,
      demandShapeExponent: 1.1099837624991467,
      sourceInterfaceW: 300e6,
      facilities: [
        {
          assetId: "scenario-116-champlain-hydro",
          fuel: "Hydro",
          peakW: 36e6,
          initialAgeYears: 12,
          hydroSiteId: "scenario-116-champlain-hydro-site",
          initialReservoirFraction: 0.5,
        },
        {
          assetId: "scenario-116-champlain-oil-a",
          fuel: "Oil",
          peakW: 40e6,
          initialAgeYears: 15,
        },
        {
          assetId: "scenario-116-champlain-oil-b",
          fuel: "Oil",
          peakW: 40e6,
          initialAgeYears: 10,
        },
        {
          assetId: "scenario-116-champlain-gas-cc",
          name: "Natural Gas CC",
          fuel: "Natural Gas",
          peakW: 50e6,
          initialAgeYears: 8,
        },
        {
          assetId: "scenario-116-champlain-biomass",
          fuel: "Biomass",
          peakW: 6e6,
          initialAgeYears: 10,
        },
        {
          assetId: "scenario-116-champlain-wind",
          fuel: "Wind",
          peakW: 6e6,
          initialAgeYears: 3,
        },
      ],
      entitlements: [
        {
          id: "champlain-nuclear",
          name: "Regional nuclear",
          nominalW: 100e6,
          deliverability: 0.95,
          pricePerMWh: 40,
          emissionsKgPerMWh: 0,
        },
        {
          id: "champlain-quebec",
          name: "Québec hydro",
          nominalW: 120e6,
          deliverability: 0.95,
          pricePerMWh: 60,
          marketId: "newengland-quebec-upgrade-market",
        },
      ],
    },
    "valley-electric": {
      id: "valley-electric",
      name: "Valley Electric",
      location: location("RutlandVT", "Rutland", 43.6106, -72.9726),
      customers: 159000,
      addressablePool: 318000,
      annualEnergyMWh: 2200000,
      peakDemandW: 406e6,
      energyShares: { Residential: 0.45, Commercial: 0.38, Industrial: 0.17 },
      annualNetworkOM: 45e6,
      demandScale: 4.1378209720279155,
      demandShapeExponent: 1.1856851657201783,
      sourceInterfaceW: 350e6,
      facilities: [
        {
          assetId: "scenario-116-valley-hydro",
          fuel: "Hydro",
          peakW: 45e6,
          initialAgeYears: 15,
          hydroSiteId: "scenario-116-valley-hydro-site",
          initialReservoirFraction: 0.5,
        },
        {
          assetId: "scenario-116-valley-oil",
          fuel: "Oil",
          peakW: 27e6,
          initialAgeYears: 12,
        },
        {
          assetId: "scenario-116-valley-biomass",
          fuel: "Biomass",
          peakW: 11e6,
          initialAgeYears: 10,
        },
      ],
      entitlements: [
        {
          id: "valley-nuclear",
          name: "Regional nuclear",
          nominalW: 160e6,
          deliverability: 0.95,
          pricePerMWh: 40,
          emissionsKgPerMWh: 0,
          reductionYear: 2017,
          reducedNominalW: 80e6,
        },
        {
          id: "valley-quebec",
          name: "Québec hydro",
          nominalW: 120e6,
          deliverability: 0.95,
          pricePerMWh: 60,
          marketId: "newengland-quebec-upgrade-market",
        },
        {
          id: "valley-balancing",
          name: "New England balancing",
          nominalW: 50e6,
          deliverability: 1,
          pricePerMWh: 75,
          marketId: VERMONT_REGIONAL_MARKET_ID,
          balancing: true,
        },
      ],
    },
    "ridge-electric": {
      id: "ridge-electric",
      name: "Ridge Electric",
      location: location(
        "WhiteRiverJunctionVT",
        "White River Junction",
        43.6489,
        -72.3193,
      ),
      customers: 50000,
      addressablePool: 100000,
      annualEnergyMWh: 1000000,
      peakDemandW: 160e6,
      energyShares: { Residential: 0.15, Commercial: 0.3, Industrial: 0.55 },
      annualNetworkOM: 15e6,
      demandScale: 5.877229717601884,
      demandShapeExponent: 0.9882172536490237,
      sourceInterfaceW: 60e6,
      facilities: [
        {
          assetId: "scenario-116-ridge-gas-cc",
          name: "Natural Gas CC",
          fuel: "Natural Gas",
          peakW: 100e6,
          initialAgeYears: 5,
        },
        {
          assetId: "scenario-116-ridge-wind",
          fuel: "Wind",
          peakW: 60e6,
          initialAgeYears: 3,
        },
        {
          assetId: "scenario-116-ridge-oil",
          fuel: "Oil",
          peakW: 20e6,
          initialAgeYears: 12,
        },
      ],
      entitlements: [
        {
          id: "ridge-firm",
          name: "Regional firm purchase",
          nominalW: 40e6,
          deliverability: 0.95,
          pricePerMWh: 55,
          marketId: VERMONT_REGIONAL_MARKET_ID,
        },
      ],
    },
  };
export const UTILITY_TARGETS: readonly UtilityTargetDefinition[] = [
  {
    id: "valley-electric",
    name: "Valley Electric",
    corridorId: "vt-champlain-valley",
    equityPrice: 410e6,
    assumedDebt: 200e6,
    fee: 5e6,
  },
  {
    id: "ridge-electric",
    name: "Ridge Electric",
    corridorId: "vt-champlain-ridge",
    equityPrice: 260e6,
    assumedDebt: 100e6,
    fee: 3e6,
  },
];
export function getUtilityArea(
  id: string | undefined,
): UtilityAreaDefinition | undefined {
  return id !== undefined &&
    Object.prototype.hasOwnProperty.call(UTILITY_AREAS, id)
    ? UTILITY_AREAS[id as UtilityId]
    : undefined;
}
/** Dates own caps, so a late acquisition cannot restart Valley's expired supply. */
export function utilityEntitlementsAt(
  areaId: UtilityId,
  year: number,
): UtilityEntitlementDefinition[] {
  if (year > 2024) return [];
  return UTILITY_AREAS[areaId].entitlements.map((source) => ({
    ...source,
    nominalW:
      source.reductionYear !== undefined && year >= source.reductionYear
        ? (source.reducedNominalW ?? source.nominalW)
        : source.nominalW,
  }));
}
