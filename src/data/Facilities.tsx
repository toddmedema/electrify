import { LCWH } from "../helpers/Financials";
import { hasFuelPrices } from "./FuelPrices";
import { getInflationIndex, hasEconomy } from "./Economy";
import { DIFFICULTIES } from "../Constants";
import { GameType, GeneratorShoppingType, StorageShoppingType } from "../Types";
import {
  getAirborneWindCapacityFactor,
  getOffshoreWindCapacityFactor,
  getWindCapacityFactor,
  getSolarCapacityFactor,
} from "../helpers/Energy";
import { hasOffshoreWind } from "./Weather";
import { HYDRO_TARGET_CAPACITY_FACTOR, hydroSizing } from "../helpers/Hydro";
import {
  getViableLocationCount,
  getViableLocationsRemaining,
} from "./FacilitySites";

/**
 * What a dollar in the tables below is worth by the time the game reaches this month. Every cost
 * here is quoted in real terms - the exponents that remain are technology trends, not price
 * levels - so inflation is what carries them forward from the day the run opens.
 *
 * The index is anchored on the game's own starting year, so the opening month always costs
 * exactly what the table says whether the scenario begins in 1980 or 2020. Anchoring it on a
 * fixed year instead would hand a 1980 run 1980 dollar costs against a nominal retail rate and
 * make it trivially profitable.
 *
 * The custom game screen asks what can be built before any game has loaded the economic data,
 * so an unloaded index is 1 rather than a thrown error - the same reason hasFuelPrices exists.
 */
function getCostInflation(state: GameType): number {
  return hasEconomy()
    ? getInflationIndex(state.date, state.startingYear, state.seed)
    : 1;
}

// Offshore wind is the only technology here whose real costs rose before learning won: projects
// moved into deeper water and farther from shore, taking European capex from about EUR1.5m/MW in
// 2000 to EUR4m/MW in 2010. IRENA's global average then fell from $5,409/kW in 2010 to $2,800/kW
// in 2023. Peak the curve in 2010 and floor its early side so tiny first-generation farms do not
// become a historical bargain.
function offshoreEraMultiple(year: number): number {
  return year <= 2010
    ? Math.max(1.64, 1.82 * Math.pow(2, (year - 2010) / 9))
    : 1.82 * Math.pow(2, (2010 - year) / 15);
}

// EIA's 2020 capital-cost study is in 2019 dollars and its AEO 2025 study is in 2023
// dollars. IRENA's renewable-cost snapshots are in 2020 and 2024 dollars. Normalize the
// older observations before treating what remains as a technology trend. The ratios are
// annual-average CPI-U from BLS, not the game's inflation: that is applied separately below.
const CPI_2019_TO_2023 = 304.702 / 255.657;
const CPI_2020_TO_2024 = 313.689 / 258.811;
const CPI_2015_TO_2023 = 304.702 / 237.017;
// NREL's 500-1,300 MW supercritical-coal class reports $54/MW-start of capitalized
// cycling/maintenance plus $5.81/MW-start of other startup operations, in 2011 dollars.
const COAL_START_COST_PER_MW_2023 = (54 + 5.81) * (304.702 / 224.939);

// EIA's directly matched 340 kW commercial Oil reciprocating-engine case, normalized from
// 2015$ to 2023$ with annual-average CPI-U. These stay separate because fixed service is paid for
// standing capacity while use-driven service and consumables follow the MWh actually generated.
export const OIL_FIXED_OPERATING_COST_PER_KW_YEAR = 24 * CPI_2015_TO_2023;
export const OIL_VARIABLE_OPERATING_COST_PER_MWH = 20 * CPI_2015_TO_2023;

// Used only to upgrade current-version saves written before start tracking was added to these
// technologies. New shopping and operating records carry the explicit tracksStarts field below.
export const START_TRACKING_FACILITY_NAMES = new Set([
  "Natural Gas",
  "Coal",
  "Nuclear",
  "Biomass",
  "Geothermal",
  "Enhanced Geothermal",
]);

/** Exponential interpolation between two real-cost observations, held flat outside them. */
function costBetween(
  year: number,
  fromYear: number,
  fromCost: number,
  toYear: number,
  toCost: number,
): number {
  const boundedYear = Math.max(fromYear, Math.min(toYear, year));
  return (
    fromCost *
    Math.pow(toCost / fromCost, (boundedYear - fromYear) / (toYear - fromYear))
  );
}

/**
 * Preserve the game's useful economies of scale while making the cited reference plant land on
 * its published overnight cost. A quarter fixed / three-quarters variable is also how the old
 * facility estimates were decomposed, but this makes that assumption explicit and consistent.
 */
function scaledBuildCost(
  costPerW: number,
  referencePeakW: number,
  peakW: number,
): number {
  return costPerW * (0.25 * referencePeakW + 0.75 * peakW);
}

/** Fold variable non-fuel O&M into the annual expense the simulation knows how to charge. */
function annualOperatingCost(
  peakW: number,
  capacityFactor: number,
  fixedDollarsPerKWYear: number,
  variableDollarsPerMWh: number,
): number {
  const dollarsPerKWYear =
    fixedDollarsPerKWYear + variableDollarsPerMWh * 8.76 * capacityFactor;
  return (dollarsPerKWYear / 1000) * peakW;
}

function windCostPerW(year: number): number {
  const cost2020 = 1.355 * CPI_2020_TO_2024;
  if (year < 2020) {
    // Preserve the established long-run historical learning curve, but anchor it to IRENA's
    // inflation-normalized 2020 observation.
    return cost2020 * Math.pow(3, (2020 - year) / 40);
  }
  if (year <= 2024) {
    return costBetween(year, 2020, cost2020, 2024, 1.041);
  }
  // IRENA's five-year outlook reaches $861/kW; stop there instead of allowing an exponential
  // learning curve to make mature wind farms approach zero cost in long games.
  return costBetween(year, 2024, 1.041, 2029, 0.861);
}

function solarCostPerW(year: number): number {
  const cost2020 = 0.883 * CPI_2020_TO_2024;
  if (year < 2020) {
    return cost2020 * Math.pow(2, (2020 - year) / 8);
  }
  if (year <= 2024) {
    return costBetween(year, 2020, cost2020, 2024, 0.691);
  }
  // IRENA's five-year outlook reaches $388/kW.
  return costBetween(year, 2024, 0.691, 2029, 0.388);
}

function hydroCostPerW(year: number): number {
  return costBetween(year, 2020, 1.87 * CPI_2020_TO_2024, 2024, 2.267);
}

function geothermalCostPerW(year: number): number {
  return costBetween(year, 2020, 4.468 * CPI_2020_TO_2024, 2024, 4.015);
}

function batteryCostPerWh(year: number): number {
  return costBetween(year, 2020, 0.345 * CPI_2020_TO_2024, 2024, 0.192);
}

/**
 * Early-commercial Airborne Wind estimate, held flat outside the evidence window.
 * The $7/W pilot anchor and inferred $4.1/W early-series floor are documented in issue #124.
 */
export function airborneWindCostPerW(year: number): number {
  return costBetween(year, 2028, 7, 2035, 4.1);
}

export function airborneWindMaxPeakW(year: number): number {
  return Math.min(500000000, 1200000 * Math.pow(2, (year - 2028) / 2));
}

export function GENERATORS(
  state: GameType,
  peakW: number,
  windSpeedsKph: number[],
  irradiancesWM2: number[],
  offshoreWindSpeedsKph: number[] = [],
  airborneWindSpeedsKph: number[] = [],
) {
  const magnitude = Math.log10(peakW) - 6; // 0 = 1MW, 4 = 10GW (+1 for each 10x)
  const year = state.date.year;

  const hydroLocations = getViableLocationCount(state.location, "Hydro");
  const hydroLocationsRemaining = getViableLocationsRemaining(
    state.location,
    state.facilities,
    "Hydro",
  );
  const geothermalLocations = getViableLocationCount(
    state.location,
    "Geothermal",
  );
  const geothermalLocationsRemaining = getViableLocationsRemaining(
    state.location,
    state.facilities,
    "Geothermal",
  );
  const enhancedGeothermalCostPerW = Math.max(
    3,
    5.5 * Math.pow(3 / 5.5, (year - 2028) / 7),
  );

  // Calculate intermittent generator capacity factors (here instead of passed in, since may eventually have different capacity factors
  // for different generator techs for the same resource, e.g. onshore vs offshore wind or fixed vs tracking solar)
  const windCapacityFactor = getWindCapacityFactor(windSpeedsKph);
  const offshoreWindCapacityFactor = getOffshoreWindCapacityFactor(
    offshoreWindSpeedsKph,
  );
  const airborneWindCapacityFactor = getAirborneWindCapacityFactor(
    airborneWindSpeedsKph,
  );
  const solarCapacityFactor = getSolarCapacityFactor(irradiancesWM2);

  let generators = [
    // FUELED
    {
      name: "Coal",
      fuel: "Coal",
      description: "On-demand but dirty and slow",
      available: true, // Coal was first type of electric plant
      buildCost: scaledBuildCost(
        costBetween(year, 2019, 3.676 * CPI_2019_TO_2023, 2023, 4.103),
        650000000,
        peakW,
      ),
      // EIA AEO2025 reference: 650MW ultra-supercritical coal, $4,103/kW in 2023$.
      // The inflation-normalized AEO2020 equivalent was $4,381/kW, a 6% real decline.
      // https://www.eia.gov/analysis/studies/powerplants/capitalcost/
      peakW,
      maxPeakW: 6000000000,
      // ~6GW, start in the late 90's - https://www.power-technology.com/features/feature-giga-projects-the-worlds-biggest-thermal-power-plants/
      btuPerWh: 8.638,
      // AEO2025 net nominal heat rate, Btu/kWh expressed as Btu/Wh.
      spinMinutes: 360,
      // 6 hours - https://spectrum.ieee.org/green-tech/wind/taming-wind-power-with-better-forecasts
      // 4-8 hours - https://www.reuters.com/article/coal-power-generation/column-to-...wer-plants-must-become-more-flexible-kemp-idUSL5N0J42YG20131119
      annualOperatingCost: annualOperatingCost(peakW, 0.68, 61.6, 6.4),
      tracksStarts: true,
      // NREL's conservative hot-start case, normalized from 2011$ to 2023$ with annual-average
      // CPI-U and scaled by nameplate MW. Fuel input and EFOR effects are deliberately excluded.
      costPerStart: COAL_START_COST_PER_MW_2023 * (peakW / 1000000),
      yearsToBuild: 4 + magnitude / 3,
      // AEO2025 reference lead time is 60 months and operating life is 40 years.
      capacityFactor: 0.68,
      // 66% = Max value from https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a
      // ~70% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 40,
    },
    {
      name: "Nuclear",
      fuel: "Uranium",
      description: "On-demand and clean, but very slow",
      available: year > 1956, // First full scale plant was Calder Hall in 1956
      buildCost: scaledBuildCost(
        costBetween(year, 2019, 6.041 * CPI_2019_TO_2023, 2023, 7.861),
        2156000000,
        peakW,
      ),
      // EIA AEO2025 reference: two brownfield AP1000s, $7,861/kW in 2023$,
      // 9% above the inflation-normalized AEO2020 estimate.
      peakW,
      maxPeakW: 8000000000,
      // ~8GW, built in the 80's - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Nuclear
      btuPerWh: 10.608,
      spinMinutes: 600,
      annualOperatingCost: annualOperatingCost(peakW, 0.93, 156.2, 2.52),
      tracksStarts: true,
      yearsToBuild: 6 + magnitude / 3,
      // AEO2025 reference lead time is 84 months and operating life is 40 years.
      capacityFactor: 0.93,
      // 93% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~89% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 40,
    },
    {
      name: "Natural Gas",
      fuel: "Natural Gas",
      description: "On-demand, faster and cleaner than coal",
      available: year > 1940, // First full scale plant was 4MW in Switzerland in 1940
      buildCost: scaledBuildCost(
        costBetween(year, 2019, 0.713 * CPI_2019_TO_2023, 2023, 0.836),
        419000000,
        peakW,
      ),
      // H-class simple-cycle gas best matches this facility's fast-start gameplay role. EIA's
      // AEO2025 reference is $836/kW, nearly flat in real terms from AEO2020.
      peakW,
      maxPeakW: 6000000000,
      // ~6GW, build in the late 80's - https://www.power-technology.com/features/feature-giga-projects-the-worlds-biggest-thermal-power-plants/
      btuPerWh: 9.142,
      spinMinutes: 10,
      annualOperatingCost: annualOperatingCost(peakW, 0.45, 6.87, 1.24),
      tracksStarts: true,
      // EIA AEO2025 Case 4 reports this separately from both fixed and variable O&M:
      // $23,100 per equivalent start for its 419 MW H-class simple-cycle reference plant.
      costPerStart: 23100 * (peakW / 419000000),
      yearsToBuild: 2.46 + magnitude / 3,
      capacityFactor: 0.45,
      // ~38% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      // 55% = max value from https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a
      lifespanYears: 40,
    },
    {
      name: "Oil",
      fuel: "Oil",
      description: "Fast but dirty",
      available: true,
      buildCost: scaledBuildCost(
        costBetween(year, 2019, 1.8 * CPI_2019_TO_2023, 2023, 1.248),
        3000000,
        peakW,
      ),
      // EIA-860's capacity-weighted 2023 cost for newly installed internal-combustion generators
      // was $1,248/kW. The prime-mover benchmark is used because EIA no longer defines a new
      // utility-scale petroleum reference plant.
      // https://www.eia.gov/electricity/generatorcosts/
      peakW,
      maxPeakW: 6000000000,
      // ~6GW, build in 2007 - https://www.power-technology.com/features/feature-giga-projects-the-worlds-biggest-thermal-power-plants/
      btuPerWh: 11,
      // https://www.eia.gov/electricity/annual/html/epa_08_01.html
      spinMinutes: 10,
      // EIA, Distributed Generation and Combined Heat & Power System Characteristics and Costs
      // in the Buildings Sector, Tables 4-38 through 4-41. The 2015-dollar source values are
      // $24/kW-year fixed and $20/MWh variable before the CPI normalization above.
      // https://www.eia.gov/analysis/studies/buildings/distrigen/pdf/dg_chp.pdf
      annualOperatingCost:
        (peakW / 1000) * OIL_FIXED_OPERATING_COST_PER_KW_YEAR,
      variableOperatingCostPerMWh: OIL_VARIABLE_OPERATING_COST_PER_MWH,
      yearsToBuild: 1 + magnitude / 3,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      capacityFactor: 0.2,
      // https://www.eia.gov/todayinenergy/detail.php?id=31232
      lifespanYears: 30,
      // TODO
    },
    {
      name: "Biomass",
      fuel: "Biomass",
      description: "Renewable and dispatchable, but fuel-hungry",
      available: true,
      // EIA's 50 MW fluidized-bed reference plant costs $4,843/kW in 2025 dollars. Converted
      // to the table's 2018 base with CPI-U (251.107 / 321.943), then split into the same
      // one-quarter fixed / three-quarter variable shape used by the other thermal plants, so
      // small biomass plants retain the real technology's poor economies of scale.
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/EMM_Assumptions.pdf
      // https://www.bls.gov/regions/mid-atlantic/data/ConsumerPriceIndexAnnualandSemiAnnual_Table.htm
      buildCost: 47217644 + 2.833059 * peakW,
      peakW,
      // DOE's project-screening guidance describes 10-50 MW as the economic range; larger
      // fleets can still be assembled as several plants with separate feedstock logistics.
      // https://www.energy.gov/indianenergy/transcript-may-2019-tribal-energy-webinar-series-initial-scoping-energy-projects-back
      maxPeakW: 50000000,
      btuPerWh: 13.3,
      spinMinutes: 240,
      // EIA gives $154.26/kW-year fixed plus $5.93/MWh variable O&M in 2025 dollars. The engine
      // has one annual O&M field, so both are converted to 2018 dollars and variable O&M is
      // annualized at the observed 60.2% capacity factor.
      annualOperatingCost: 0.14471 * peakW,
      tracksStarts: true,
      yearsToBuild: 5,
      // 2022 U.S. "other biomass" fleet average; wood was 57.9% in the same table.
      // https://www.eia.gov/electricity/annual/table.php?t=epa_04_08_b.html
      capacityFactor: 0.602,
      lifespanYears: 30,
    },
    // {
    //   name: 'Trash Incinerator',
    //   fuel: 'Trash',
    //   description: 'Good substitute for coal when there\'s trash nearby',
    //   buildCost: 200000000,
    //   peakW,
    //   btuPerW: 14, // ~20-25% efficiency https://www.planete-energies.com/en/medias/close/incineration-heating-power-refuse
    //   spinMinutes: 60,
    //   annualOperatingCost: 1000000, // about 0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    //   yearsToBuild: 1,
    // },

    // RENEWABLE
    {
      name: "Wind",
      fuel: "Wind",
      description: "Windiest at spring and fall evenings",
      available: year > 1941, // First megawatt-size turbine was in Vermont in 1941
      buildCost: scaledBuildCost(windCostPerW(year), 200000000, peakW),
      // IRENA global installed cost fell from inflation-normalized $1,642/kW in 2020 to
      // $1,041/kW in 2024. Its outlook reaches $861/kW in 2029.
      // https://www.irena.org/Publications/2025/Jun/Renewable-Power-Generation-Costs-in-2024
      peakW,
      maxPeakW: 1500000000,
      // ~1.5GW, except one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: annualOperatingCost(
        peakW,
        windCapacityFactor,
        33.06,
        0,
      ),
      // The location's weather record determines the capacity factor below.
      yearsToBuild: 1 + magnitude / 3,
      // EIA AEO2025 reference lead time is 21 months for a 200MW plant.
      spinMinutes: 1,
      capacityFactor: windCapacityFactor,
      // Older fleets lose output faster than modern projects. Rounded from the 0.53% and 0.17%
      // annual declines measured across 917 U.S. wind plants.
      annualOutputDegradation: windAnnualOutputDegradation(year),
      // 37% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~25% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 25,
      // http://insideenergy.org/2016/09/09/where-do-wind-turbines-go-to-die/
    },
    {
      name: "Offshore Wind",
      fuel: "Offshore Wind",
      description: "Steadier and stronger than onshore, at a price",
      available: year > 1991 && hasOffshoreWind(state.location),
      // Vindeby, Denmark, was the first offshore wind farm, at 4.95MW in 1991:
      // https://en.wikipedia.org/wiki/Vindeby_Offshore_Wind_Farm
      buildCost: 830000000 + 2.77 * peakW * offshoreEraMultiple(year),
      // EIA/Sargent & Lundy's 2023 fixed-bottom reference is $3,689/kW for 900MW. One
      // quarter fixed and three quarters variable makes small farms appropriately expensive.
      // https://www.eia.gov/analysis/studies/powerplants/capitalcost/pdf/capital_cost_AEO2025.pdf
      peakW,
      maxPeakW: Math.min(
        1500000000,
        5000000 * Math.pow(2, (year - 1991) / 3.5),
      ),
      // Largest projects roughly doubled every 3.5 years from Vindeby through Hornsea, then
      // levelled near 1.5GW; Dogger Bank's 3.6GW is three separately phased farms.
      // https://en.wikipedia.org/wiki/List_of_offshore_wind_farms
      btuPerWh: 0,
      annualOperatingCost: 0.154 * peakW,
      yearsToBuild: 3 + magnitude / 3,
      spinMinutes: 1,
      capacityFactor: offshoreWindCapacityFactor,
      lifespanYears: 25,
    },
    {
      name: "Airborne Wind",
      fuel: "Airborne Wind",
      description:
        "Higher, steadier winds with light infrastructure, but immature and maintenance-heavy",
      // NAWEP's current schedule reaches commissioning in 2028 and mature operation in 2030.
      available: year >= 2030,
      buildCost: scaledBuildCost(airborneWindCostPerW(year), 1200000, peakW),
      // The 1.2MW NAWEP array is the source anchor. Doubling every two years and the 500MW
      // ceiling are deliberately conservative gameplay assumptions until fleet data exists.
      peakW,
      maxPeakW: airborneWindMaxPeakW(year),
      btuPerWh: 0,
      // NAWEP's series-production model uses EUR45.5/kW-year, converted at $1.13/EUR.
      annualOperatingCost: 0.0514 * peakW,
      yearsToBuild: 2 + magnitude / 3,
      spinMinutes: 1,
      capacityFactor: airborneWindCapacityFactor,
      lifespanYears: 25,
    },
    {
      name: "Solar",
      fuel: "Sun",
      description: "Sunniest at summer noon",
      available: year > 1982, // First megawatt-sized installations around 1982 https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
      buildCost: scaledBuildCost(solarCostPerW(year), 150000000, peakW),
      // IRENA global installed cost fell from inflation-normalized $1,070/kW in 2020 to
      // $691/kW in 2024. Its outlook reaches $388/kW in 2029.
      peakW,
      maxPeakW: year < 2000 ? 100000000 : 2000000000,
      // 2000: 100MW - https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
      // 2019: ~2GW - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: annualOperatingCost(
        peakW,
        solarCapacityFactor,
        20.23,
        0,
      ),
      // Latitude, daylight and the location's cloud record determine the capacity factor below.
      yearsToBuild: 2.27 + magnitude / 3,
      // EIA AEO2025 reference lead time is 36 months for a 150MW plant.
      spinMinutes: 1,
      capacityFactor: solarCapacityFactor,
      // A rounded central case: NREL's 2024 ATB spans 0.7%/yr baseline to 0.5%/yr moderate
      // improvement (and 0.2%/yr advanced).
      annualOutputDegradation: 0.005,
      // 26% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~10-25% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 35,
    },
    // {
    //   // as of 2018 very limited location options for these, and only two in the world are >20MW
    //   // TODO revisit, a lot's changed
    //   name: 'Tidal',
    //   fuel: 'Tides',
    //   description: 'Stable output except 4 times per day',
    // available: true,
    //   buildCost: 200000000,
    //     // TODO
    //   peakW,
    //   maxPeakW: 250000000,
    //     // ~250MW - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Tide
    //   btuPerWh: 0,
    //   annualOperatingCost: 1000000,
    //     // TODO
    //   yearsToBuild: 1,
    //     // TODO
    //   spinMinutes: 1,
    //   capacityFactor: 0.26,
    //     // 24% - https://en.wikipedia.org/wiki/Sihwa_Lake_Tidal_Power_Station
    //     // 28% - https://en.wikipedia.org/wiki/Rance_Tidal_Power_Station
    //   lifespanYears: 30,
    //     // TODO
    // },
    {
      name: "Hydro",
      fuel: "Hydro",
      description: "Clean and dispatchable, where rivers allow",
      available: year > 1882 && (hydroLocations || 0) > 0,
      buildCost: scaledBuildCost(hydroCostPerW(year), 100000000, peakW),
      // IRENA's inflation-normalized global installed cost was effectively flat from 2020 to
      // 2024 at $2,267/kW. Site scarcity is now an explicit cap rather than a second price.
      peakW,
      viableLocationsRemaining: hydroLocationsRemaining,
      maxPeakW: 10000000000,
      btuPerWh: 0,
      spinMinutes: 1,
      annualOperatingCost: annualOperatingCost(
        peakW,
        HYDRO_TARGET_CAPACITY_FACTOR,
        33.54,
        0,
      ),
      yearsToBuild: 5 + magnitude / 2,
      capacityFactor: HYDRO_TARGET_CAPACITY_FACTOR,
      lifespanYears: 50,
      ...hydroSizing(peakW, state.location.watershedId || state.location.id),
    },
    {
      name: "Geothermal",
      fuel: "Geothermal",
      description: "Consistent, but few locations",
      available: (geothermalLocations || 0) > 0,
      buildCost: scaledBuildCost(geothermalCostPerW(year), 50000000, peakW),
      // IRENA global installed cost fell from inflation-normalized $5,415/kW in 2020 to
      // $4,015/kW in 2024, although its small project sample makes this series volatile.
      peakW,
      viableLocationsRemaining: geothermalLocationsRemaining,
      maxPeakW: 800000000,
      // ~800MW, except for one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Geothermal
      btuPerWh: 0,
      annualOperatingCost: annualOperatingCost(peakW, 0.88, 150.6, 0),
      tracksStarts: true,
      yearsToBuild: 3,
      // EIA AEO2025 reference lead time is 36 months and operating life is 40 years.
      spinMinutes: 1,
      capacityFactor: 0.88,
      lifespanYears: 40,
      // TODO
    },
    {
      name: "Enhanced Geothermal",
      fuel: "Geothermal",
      description: "Clean, firm power nearly anywhere",
      available: year >= 2030,
      buildCost: enhancedGeothermalCostPerW * peakW,
      // Fervo's $5.5/W Phase II estimate in 2028 declines to its $3/W long-term target
      // in 2035, then stays at that floor.
      peakW,
      maxPeakW: 500000000,
      btuPerWh: 0,
      annualOperatingCost: 0.16 * peakW,
      tracksStarts: true,
      yearsToBuild: 3 + magnitude / 4,
      spinMinutes: 1,
      capacityFactor: 0.83,
      lifespanYears: 30,
    },
  ] as GeneratorShoppingType[];

  // update with calculations that occur across all entries, like difficulty multipliers
  const difficulty = DIFFICULTIES[state.difficulty];
  const inflation = getCostInflation(state);
  generators = generators.filter((g: GeneratorShoppingType) => {
    g.buildCost *= difficulty.buildCost * inflation;
    g.annualOperatingCost *= difficulty.expensesOM * inflation;
    if (g.variableOperatingCostPerMWh !== undefined) {
      g.variableOperatingCostPerMWh *= difficulty.expensesOM * inflation;
    }
    if (g.costPerStart !== undefined) {
      g.costPerStart *= difficulty.expensesOM * inflation;
    }
    g.yearsToBuild *= difficulty.buildTime;
    // The custom game screen asks what can be built in a year before any game has loaded the
    // price data a levelized cost needs. Nothing there reads lcWh, and a cost per Wh with no
    // fuel prices behind it is genuinely unknown rather than zero
    g.lcWh = hasFuelPrices()
      ? LCWH(g, state.date, state.feePerKgCO2e, state.seed, state.location)
      : Infinity;
    return g.available;
  });

  return generators;
}

/** Rounded vintage cohorts from LBNL's U.S. wind-plant performance study. */
export function windAnnualOutputDegradation(commissioningYear: number): number {
  return commissioningYear < 2008 ? 0.005 : 0.002;
}

export function STORAGE(state: GameType, peakWh: number) {
  // 0 = 1MW, 4 = 10GW (+1 for each 10x)
  const magnitude = Math.log10(peakWh) - 6;
  const year = state.date.year;
  const pumpedHydroLocations = getViableLocationCount(
    state.location,
    "Pumped Hydro",
  );
  const pumpedHydroLocationsRemaining = getViableLocationsRemaining(
    state.location,
    state.facilities,
    "Pumped Hydro",
  );

  let storage = [
    {
      name: "Battery",
      description: "Fast to build and charge / discharge",
      available: year > 2008, // Project Barbados, 2MW - https://en.wikipedia.org/wiki/List_of_energy_storage_projects
      buildCost: 10000 + batteryCostPerWh(year) * peakWh,
      // NREL's 2020 four-hour benchmark was $345/kWh (2020$); IRENA's global fully installed
      // cost reached $192/kWh in 2024, a 54% real decline after CPI normalization.
      peakW: 0.25 * peakWh,
      // Four-hour duration is now the representative utility-scale configuration in both NREL
      // ATB and EIA AEO2025, replacing the old Powerpack-derived 1.25-hour assumption.
      peakWh,
      maxPeakWh:
        (year < 2021 ? 200000000 : 600000000) * Math.pow(2, (year - 2018) / 4),
      // Tesla 129MWh is largest in world in 2018 - https://hornsdalepowerreserve.com.au/
      // ~2021 largest will be 1.2GWh - https://cleantechnica.com/2020/02/27/humongous-tesla-battery-plant-approved-in-california-is-10x-bigger-than-worlds-biggest-battery-plant/
      // Largest was 50MWh in 2016 - https://en.wikipedia.org/wiki/Battery_storage_power_station#Lithium-ion
      // ~2MWh in 2014, 1MWh before that
      // So roughly doubling in max capacity every 4 years after 2018, but a big step function in 2021
      lifespanYears: 20,
      // EIA AEO2025 assumes 7,300 equivalent cycles over 20 years.
      roundTripEfficiency: 0.85,
      // https://www.nrel.gov/docs/fy19osti/73222.pdf
      hourlyLoss: 0.0001,
      // TODO #'s
      // TODO implement mechanic
      annualOperatingCost: 0.01 * peakWh,
      // EIA's $10/kWh-year includes augmentation for about 1.5% annual degradation.
      yearsToBuild: 0.57 + magnitude / 3,
      // EIA reference total lead time is 18 months for 600MWh.
      spinMinutes: 1,
    },
    {
      name: "Pumped Hydro",
      description: "Slow to build and charge / discharge",
      available: year > 1930 && (pumpedHydroLocations || 0) > 0, // New Milford plant, 33MW - https://blogs.scientificamerican.com/plugged-in/throwback-thursday-the-first-u-s-energy-storage-plant/
      buildCost: 2000000 + 0.3319 * peakWh,
      // NREL's 2024 ATB closed-loop sites span $2,205-$4,434/kW. At this facility's ten-hour
      // duration, the midpoint is $332/kWh; costs are held flat because the technology is mature.
      peakW: 0.1 * peakWh,
      viableLocationsRemaining: pumpedHydroLocationsRemaining,
      // Around 1/5th to 1/20th for larger projects - https://en.wikipedia.org/wiki/List_of_pumped-storage_hydroelectric_power_stations
      peakWh,
      maxPeakWh: 20000000000,
      // 24GWh, build in 1970's - http://large.stanford.edu/courses/2014/ph240/galvan-lopez2/
      // Resource availability above keeps this out of regions without suitable hydro potential.
      lifespanYears: 75,
      // https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity#Economic_efficiency
      roundTripEfficiency: 0.8,
      // https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity#Economic_efficiency
      hourlyLoss: 0.001,
      // TODO #'s
      // TODO implement mechanic
      annualOperatingCost: 0.0019 * peakWh,
      // NREL 2024 ATB fixed O&M is $19/kW-year, or $1.90/kWh-year at ten hours.
      yearsToBuild: 6 + magnitude,
      // 6-10 years to build - https://cleantechnica.com/2020/01/03/120-gigawatts-of-energy-storage-by-2050-we-got-this/
      spinMinutes: 10,
    },
    // TODO thermal storage, hydrogen, ...
  ] as StorageShoppingType[];

  // update with calculations that occur across all entries, like difficulty multipliers
  const difficulty = DIFFICULTIES[state.difficulty];
  const inflation = getCostInflation(state);
  storage = storage.filter((g: StorageShoppingType) => {
    g.buildCost *= difficulty.buildCost * inflation;
    g.annualOperatingCost *= difficulty.expensesOM * inflation;
    g.yearsToBuild *= difficulty.buildTime;
    return g.available;
  });

  return storage;
}
