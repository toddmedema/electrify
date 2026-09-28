import { getHydroAvailability } from "./HydroSites";
import {
  batteryYearsToBuild,
  naturalGasYearsToBuild,
} from "../helpers/BuildLeadTime";
import { LCWH } from "../helpers/Financials";
import { buildStorySnapshot } from "../helpers/Story";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { hasFuelPrices } from "./FuelPrices";
import { getCostTableDeflator, getInflationIndex, hasEconomy } from "./Economy";
import { DIFFICULTIES } from "../Constants";
import { costBetween } from "../helpers/Math";
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
import { resolveStoryAtDate } from "./WorldEvents";
import { applyDefaultResilience } from "../helpers/Hazards";
import { pow } from "../helpers/Pow";

/**
 * What a dollar in the tables below is worth by the time the game reaches this month. The tables
 * are in 2023 dollars (COST_TABLE_DOLLAR_YEAR); the exponents that remain are technology trends,
 * not price levels. A run that opens before 2023 has them deflated into its starting year's own
 * dollars with recorded CPI-U, because its fuel prices and retail rates are that year's nominal
 * values too. From there the game's own inflation index carries them forward.
 *
 * The custom game screen asks what can be built before any game has loaded the economic data,
 * so an unloaded index is 1 rather than a thrown error - the same reason hasFuelPrices exists.
 */
function getCostInflation(state: GameType): number {
  return (
    getCostTableDeflator(state.startingYear) *
    (hasEconomy()
      ? getInflationIndex(state.date, state.startingYear, state.seed)
      : 1)
  );
}

// Offshore wind is the only technology here whose real costs rose before learning won: projects
// moved into deeper water and farther from shore, taking European capex from about EUR1.5m/MW in
// 2000 to EUR4m/MW in 2010. IRENA's global average then fell from $5,409/kW in 2010 to $2,800/kW
// in 2023. Peak the curve in 2010 and floor its early side so tiny first-generation farms do not
// become a historical bargain. Like onshore wind and solar, learning stops at the edge of the
// outlook rather than halving forever: 2030 lands ~28% below 2023, in line with IRENA and NREL ATB
// moderate fixed-bottom projections of a 25-30% decline by 2030-2035.
const OFFSHORE_LEARNING_END_YEAR = 2030;
function offshoreEraMultiple(year: number): number {
  return year <= 2010
    ? Math.max(1.64, 1.82 * pow(2, (year - 2010) / 9))
    : 1.82 * pow(2, (2010 - Math.min(year, OFFSHORE_LEARNING_END_YEAR)) / 15);
}

// EIA's 2020 capital-cost study is in 2019 dollars and its AEO 2025 study is in 2023
// dollars. IRENA's renewable-cost snapshots are in 2020 and 2024 dollars. Normalize the
// older observations before treating what remains as a technology trend. The ratios are
// annual-average CPI-U from BLS, not the game's inflation: that is applied separately below.
const CPI_2019_TO_2023 = 304.702 / 255.657;
const CPI_2020_TO_2024 = 313.689 / 258.811;
const CPI_2015_TO_2023 = 304.702 / 237.017;
const CPI_2025_TO_2023 = 304.702 / 321.943;
// NREL's 500-1,300 MW supercritical-coal class reports $54/MW-start of capitalized
// cycling/maintenance plus $5.81/MW-start of other startup operations, in 2011 dollars.
const COAL_START_COST_PER_MW_2023 = (54 + 5.81) * (304.702 / 224.939);

// EIA's directly matched 340 kW commercial Oil reciprocating-engine case, normalized from
// 2015$ to 2023$ with annual-average CPI-U. These stay separate because fixed service is paid for
// standing capacity while use-driven service and consumables follow the MWh actually generated.
export const OIL_FIXED_OPERATING_COST_PER_KW_YEAR = 24 * CPI_2015_TO_2023;
export const OIL_VARIABLE_OPERATING_COST_PER_MWH = 20 * CPI_2015_TO_2023;

// Representative steady-state turndown limits. These are deliberately technology-level inputs,
// not claims that every individual unit has the same operating envelope. The GE Energy/HNEI
// ancillary-services study reports 35-40% for coal and biomass, 12-15% for geothermal, 15-70%
// for heavy-duty simple-cycle gas turbines and 50% for reciprocating engines. NREL production-
// cost studies commonly model coal/nuclear and gas units in the 30-60% range. Midpoints keep the
// gameplay legible while preventing a nominally online thermal plant from idling at trace output.
export const MINIMUM_STABLE_OUTPUT_BY_FACILITY: Readonly<
  Record<string, number>
> = {
  Coal: 0.4,
  Nuclear: 0.5,
  "Natural Gas": 0.5,
  Oil: 0.5,
  Biomass: 0.4,
  Geothermal: 0.15,
  "Enhanced Geothermal": 0.15,
};

/**
 * Preserve economies of scale while making the cited reference plant land on its published
 * overnight cost. The fixed share of the reference project is per technology, because scale
 * economies are: modular solar and wind barely have any (LBNL's utility-scale solar and land-
 * based wind reports put 5-20 MW projects only ~10-40% above 100+ MW ones), large thermal and
 * hydro sites far more. The old flat 25% made a 10 MW solar farm cost 4.5x its reference per W.
 */
// Levelized costs discount capital at the company's own borrowing rate; this stands in only
// where no rate is known yet (a quote made before the game has one).
const DEFAULT_LCOE_DISCOUNT_RATE = 0.07;

export const BUILD_COST_FIXED_SHARE = {
  solar: 0.01,
  wind: 0.02,
  offshoreWind: 0.03,
  airborneWind: 0.05,
  thermal: 0.12, // Coal, nuclear and gas
  hydroGeothermal: 0.15,
  // Biomass and oil keep the older quarter: small biomass plants have notoriously poor scale
  // economies, and the oil reference is already a 3 MW engine plant.
  default: 0.25,
};

function scaledBuildCost(
  costPerW: number,
  referencePeakW: number,
  peakW: number,
  fixedShare = BUILD_COST_FIXED_SHARE.default,
): number {
  return costPerW * (fixedShare * referencePeakW + (1 - fixedShare) * peakW);
}

/**
 * Embodied emissions from building one watt of a technology, in the year it is bought. See
 * docs/construction-emissions.md for the sources behind every figure and for why the exclusions
 * are drawn where they are.
 *
 * Mature technologies hold flat. The three that do not -- solar, batteries and enhanced
 * geothermal -- decay toward a floor rather than by a flat annual percentage, because a constant
 * rate compounds a 50 year run down past what the required mass of steel, concrete and silicon
 * can physically emit. The floor is the part no amount of clean electricity removes: clinker
 * calcination is a chemical reaction, primary aluminium consumes its carbon anode, silicon is
 * won by carbothermic reduction, and a drilling rig burns diesel.
 */
export function constructionKgco2eCurve(
  year: number,
  base: number,
  referenceYear: number,
  declineK: number,
  floor: number,
): number {
  if (declineK <= 0 || year <= referenceYear) return base;
  return floor + (base - floor) * Math.exp(-declineK * (year - referenceYear));
}

/** 2023 reference, re-based to 2025 so the whole dataset shares one vintage. */
function solarConstructionKgco2ePerW(year: number): number {
  return constructionKgco2eCurve(year, 0.6, 2025, 0.055, 0.12);
}

/**
 * Published battery figures fell about 12%/yr from 2017, but only around 60% of that is real
 * manufacturing improvement -- the rest corrected over-conservative early estimates and banked
 * the one-time shift from nickel-cobalt chemistries to LFP. Neither of those repeats, so the
 * forward rate is the 3-4%/yr this curve starts at, not the headline.
 */
function batteryConstructionKgco2ePerWh(year: number): number {
  return constructionKgco2eCurve(year, 0.08, 2025, 0.045, 0.025);
}

/**
 * Metres drilled per megawatt, not metres per well, governs this. Published EGS assessments
 * describe 5 MW plants on 5-6 km wells; a modern horizontal field reaches the same capacity with
 * roughly a quarter of the drilling, and that gap is still closing.
 */
function enhancedGeothermalConstructionKgco2ePerW(year: number): number {
  return constructionKgco2eCurve(year, 1.0, 2025, 0.12, 0.38);
}

/**
 * Fixed non-fuel O&M for standing capacity. Variable O&M is a separate per-MWh field charged on
 * actual output, so an idle or paused plant does not pay it and the keep-online versus restart
 * decision sees it.
 */
function fixedOperatingCost(
  peakW: number,
  fixedDollarsPerKWYear: number,
): number {
  return (fixedDollarsPerKWYear / 1000) * peakW;
}

function windCostPerW2024(year: number): number {
  const cost2020 = 1.355 * CPI_2020_TO_2024;
  if (year < 2020) {
    // Preserve the established long-run historical learning curve, but anchor it to IRENA's
    // inflation-normalized 2020 observation.
    return cost2020 * pow(3, (2020 - year) / 40);
  }
  if (year <= 2024) {
    return costBetween(year, 2020, cost2020, 2024, 1.041);
  }
  // IRENA's five-year outlook reaches $861/kW; stop there instead of allowing an exponential
  // learning curve to make mature wind farms approach zero cost in long games.
  return costBetween(year, 2024, 1.041, 2029, 0.861);
}

function solarCostPerW2024(year: number): number {
  const cost2020 = 0.883 * CPI_2020_TO_2024;
  if (year < 2020) {
    return cost2020 * pow(2, (2020 - year) / 8);
  }
  if (year <= 2024) {
    return costBetween(year, 2020, cost2020, 2024, 0.691);
  }
  // IRENA's five-year outlook reaches $388/kW.
  return costBetween(year, 2024, 0.691, 2029, 0.388);
}

function hydroCostPerW2024(year: number): number {
  return costBetween(year, 2020, 1.87 * CPI_2020_TO_2024, 2024, 2.267);
}

function geothermalCostPerW2024(year: number): number {
  return costBetween(year, 2020, 4.468 * CPI_2020_TO_2024, 2024, 4.015);
}

// Before 2020, installed cost doubles every 4.5 years back in time: about $2/Wh in 2010, in line
// with BNEF's ~$1,100-1,400/kWh pack prices then (real) plus balance of system. Clamping to the
// 2020 cost handed the 2000s scenarios modern storage at a quarter of its price.
const BATTERY_PRE_2020_DOUBLING_YEARS = 4.5;

function batteryCostPerWh2024(year: number): number {
  const cost2020 = 0.345 * CPI_2020_TO_2024;
  if (year < 2020) {
    // exp rather than a power: V8's exp is platform-independent (fdlibm)
    return (
      cost2020 *
      Math.exp(((2020 - year) / BATTERY_PRE_2020_DOUBLING_YEARS) * Math.LN2)
    );
  }
  return costBetween(year, 2020, cost2020, 2024, 0.192);
}

// The curves above are anchored on IRENA's (and NREL's) 2024-dollar observations. Every table
// here is priced in 2023 dollars, the EIA AEO2025 vintage the thermal plants use, so they are
// brought back one year with CPI-U before getCostInflation re-dates the whole table.
const CPI_2024_TO_2023 = 304.702 / 313.689;
const windCostPerW = (year: number) =>
  windCostPerW2024(year) * CPI_2024_TO_2023;
const solarCostPerW = (year: number) =>
  solarCostPerW2024(year) * CPI_2024_TO_2023;
const hydroCostPerW = (year: number) =>
  hydroCostPerW2024(year) * CPI_2024_TO_2023;
const geothermalCostPerW = (year: number) =>
  geothermalCostPerW2024(year) * CPI_2024_TO_2023;
const batteryCostPerWh = (year: number) =>
  batteryCostPerWh2024(year) * CPI_2024_TO_2023;

/**
 * Early-commercial Airborne Wind estimate, held flat outside the evidence window.
 * The $7/W pilot anchor and inferred $4.1/W early-series floor are documented in issue #124.
 */
export function airborneWindCostPerW(year: number): number {
  return costBetween(year, 2028, 7, 2035, 4.1);
}

export function airborneWindMaxPeakW(year: number): number {
  return Math.min(500000000, 1200000 * pow(2, (year - 2028) / 2));
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
  const storySnapshot = buildStorySnapshot(
    state.monthlyHistory || [],
    state.facilities || [],
    state.date.minute,
  );
  const storyContext = {
    seed: state.seed,
    scenarioId: state.scenarioId,
    difficulty: state.difficulty,
    location: state.location,
    snapshot: storySnapshot,
    occurrences: state.worldEvents?.occurrences || [],
  };
  const currentStoryEffects = state.storyEffectsDisabled
    ? {}
    : resolveStoryAtDate({ ...storyContext, date: state.date }).effects;
  const carbonFeeCache = new Map<number, number>();
  const carbonFeeAtYear = (yearsFromQuote: number) => {
    const monthOffset = Math.round(yearsFromQuote * 12);
    const cached = carbonFeeCache.get(monthOffset);
    if (cached !== undefined) {
      return cached;
    }
    const date = getDateFromMinute(
      state.date.minute + monthOffset * MINUTES_PER_MONTH,
      state.startingYear,
    );
    const fee = state.storyEffectsDisabled
      ? state.feePerKgCO2e
      : (resolveStoryAtDate({ ...storyContext, date }).effects
          .carbonFeePerKgCO2e ?? state.feePerKgCO2e);
    carbonFeeCache.set(monthOffset, fee);
    return fee;
  };

  const hydroAvailability = getHydroAvailability(state, peakW);
  const hydroLocationsRemaining = hydroAvailability.remaining.length;
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
    5.5 * pow(3 / 5.5, (year - 2028) / 7),
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
      description:
        "Runs on demand, with slow ramping and high direct emissions",
      available: true, // Coal was first type of electric plant
      buildCost: scaledBuildCost(
        costBetween(year, 2019, 3.676 * CPI_2019_TO_2023, 2023, 4.103),
        650000000,
        peakW,
        BUILD_COST_FIXED_SHARE.thermal,
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
      annualOperatingCost: fixedOperatingCost(peakW, 61.6),
      variableOperatingCostPerMWh: 6.4,
      minimumStableOutput: MINIMUM_STABLE_OUTPUT_BY_FACILITY.Coal,
      tracksStarts: true,
      // NREL's conservative hot-start case, normalized from 2011$ to 2023$ with annual-average
      // CPI-U and scaled by nameplate MW. Fuel input and EFOR effects are deliberately excluded.
      costPerStart: COAL_START_COST_PER_MW_2023 * (peakW / 1000000),
      // Large coal units start about 10-50 times a year (NREL Power Plant Cycling Costs; Western
      // Wind and Solar Integration Study Phase 2), not daily like a peaker.
      assumedStartsPerYear: 20,
      yearsToBuild: 4 + magnitude / 3,
      // AEO2025 reference lead time is 60 months and operating life is 40 years.
      constructionKgco2ePerW: 0.32,
      capacityFactor: 0.68,
      // 66% = Max value from https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a
      // ~70% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 40,
    },
    {
      name: "Nuclear",
      fuel: "Uranium",
      description:
        "Low direct emissions and steady output, but very slow to change",
      available: year > 1956, // First full scale plant was Calder Hall in 1956
      buildCost: scaledBuildCost(
        costBetween(year, 2019, 6.041 * CPI_2019_TO_2023, 2023, 7.861),
        2156000000,
        peakW,
        BUILD_COST_FIXED_SHARE.thermal,
      ),
      // EIA AEO2025 reference: two brownfield AP1000s, $7,861/kW in 2023$,
      // 9% above the inflation-normalized AEO2020 estimate.
      peakW,
      maxPeakW: 8000000000,
      // ~8GW, built in the 80's - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Nuclear
      btuPerWh: 10.608,
      spinMinutes: 600,
      annualOperatingCost: fixedOperatingCost(peakW, 156.2),
      variableOperatingCostPerMWh: 2.52,
      minimumStableOutput: MINIMUM_STABLE_OUTPUT_BY_FACILITY.Nuclear,
      tracksStarts: true,
      yearsToBuild: 6 + magnitude / 3,
      // AEO2025 reference lead time is 84 months and operating life is 40 years.
      constructionKgco2ePerW: 0.3,
      capacityFactor: 0.93,
      // 93% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~89% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 40,
    },
    {
      name: "Natural Gas",
      fuel: "Natural Gas",
      description:
        "Runs on demand; ramps faster than coal with lower, still significant direct emissions",
      available: year > 1940, // First full scale plant was 4MW in Switzerland in 1940
      buildCost: scaledBuildCost(
        costBetween(year, 2019, 0.713 * CPI_2019_TO_2023, 2023, 0.836),
        419000000,
        peakW,
        BUILD_COST_FIXED_SHARE.thermal,
      ),
      // H-class simple-cycle gas best matches this facility's fast-start gameplay role. EIA's
      // AEO2025 reference is $836/kW, nearly flat in real terms from AEO2020.
      peakW,
      maxPeakW: 6000000000,
      // ~6GW, build in the late 80's - https://www.power-technology.com/features/feature-giga-projects-the-worlds-biggest-thermal-power-plants/
      btuPerWh: 9.142,
      spinMinutes: 10,
      annualOperatingCost: fixedOperatingCost(peakW, 6.87),
      variableOperatingCostPerMWh: 1.24,
      minimumStableOutput: MINIMUM_STABLE_OUTPUT_BY_FACILITY["Natural Gas"],
      tracksStarts: true,
      // EIA AEO2025 Case 4 reports this separately from both fixed and variable O&M:
      // $23,100 per equivalent start for its 419 MW H-class simple-cycle reference plant.
      costPerStart: 23100 * (peakW / 419000000),
      yearsToBuild: naturalGasYearsToBuild(peakW),
      constructionKgco2ePerW: 0.06,
      capacityFactor: 0.45,
      // ~38% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      // 55% = max value from https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a
      lifespanYears: 40,
    },
    {
      name: "Oil",
      fuel: "Oil",
      description:
        "Starts quickly, but fuel is costly and produces direct emissions",
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
      minimumStableOutput: MINIMUM_STABLE_OUTPUT_BY_FACILITY.Oil,
      variableOperatingCostPerMWh: OIL_VARIABLE_OPERATING_COST_PER_MWH,
      yearsToBuild: 1 + magnitude / 3,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      constructionKgco2ePerW: 0.15,
      capacityFactor: 0.2,
      // https://www.eia.gov/todayinenergy/detail.php?id=31232
      lifespanYears: 30,
    },
    {
      name: "Biomass",
      fuel: "Biomass",
      description:
        "Runs on demand using renewable fuel, with large fuel volumes and direct CO2 emissions",
      available: true,
      // EIA's 50 MW fluidized-bed reference plant costs $4,843/kW in 2025 dollars. Converted
      // to the table's 2023 base with CPI-U (304.702 / 321.943 = 0.94645), then split into the
      // same one-quarter fixed / three-quarter variable shape used by the other thermal plants,
      // so small biomass plants retain the real technology's poor economies of scale.
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/EMM_Assumptions.pdf
      // https://www.bls.gov/regions/mid-atlantic/data/ConsumerPriceIndexAnnualandSemiAnnual_Table.htm
      buildCost: scaledBuildCost(4.843 * CPI_2025_TO_2023, 50000000, peakW),
      peakW,
      // DOE's project-screening guidance describes 10-50 MW as the economic range; larger
      // fleets can still be assembled as several plants with separate feedstock logistics.
      // https://www.energy.gov/indianenergy/transcript-may-2019-tribal-energy-webinar-series-initial-scoping-energy-projects-back
      maxPeakW: 50000000,
      btuPerWh: 13.3,
      spinMinutes: 240,
      // EIA gives $154.26/kW-year fixed plus $5.93/MWh variable O&M in 2025 dollars, which are
      // $146.0 and $5.61 in 2023 dollars. Variable O&M is annualized at the observed 60.2%
      // capacity factor.
      annualOperatingCost: fixedOperatingCost(peakW, 154.26 * CPI_2025_TO_2023),
      variableOperatingCostPerMWh: 5.93 * CPI_2025_TO_2023,
      minimumStableOutput: MINIMUM_STABLE_OUTPUT_BY_FACILITY.Biomass,
      tracksStarts: true,
      yearsToBuild: 5,
      // 2022 U.S. "other biomass" fleet average; wood was 57.9% in the same table.
      // https://www.eia.gov/electricity/annual/table.php?t=epa_04_08_b.html
      constructionKgco2ePerW: 0.45,
      capacityFactor: 0.602,
      lifespanYears: 30,
    },
    // RENEWABLE
    {
      name: "Wind",
      fuel: "Wind",
      description:
        "Output changes with local wind and is often strongest in spring and fall",
      available: year > 1941, // First megawatt-size turbine was in Vermont in 1941
      buildCost: scaledBuildCost(
        windCostPerW(year),
        200000000,
        peakW,
        BUILD_COST_FIXED_SHARE.wind,
      ),
      // IRENA global installed cost fell from inflation-normalized $1,642/kW in 2020 to
      // $1,041/kW in 2024. Its outlook reaches $861/kW in 2029.
      // https://www.irena.org/Publications/2025/Jun/Renewable-Power-Generation-Costs-in-2024
      peakW,
      maxPeakW: 1500000000,
      // ~1.5GW, except one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: fixedOperatingCost(peakW, 33.06),
      // The location's weather record determines the capacity factor below.
      yearsToBuild: 1 + magnitude / 3,
      // EIA AEO2025 reference lead time is 21 months for a 200MW plant.
      spinMinutes: 1,
      constructionKgco2ePerW: 0.42,
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
      buildCost:
        BUILD_COST_FIXED_SHARE.offshoreWind * 3.689 * 900000000 +
        (1 - BUILD_COST_FIXED_SHARE.offshoreWind) *
          3.689 *
          peakW *
          offshoreEraMultiple(year),
      // EIA/Sargent & Lundy's 2023 fixed-bottom reference is $3,689/kW for 900MW. A 3% fixed
      // share keeps the early 5-30 MW farms (Vindeby, Middelgrunden: about $1.2-2.5k/kW) near
      // their real per-watt cost; the era multiple carries the variable part.
      // https://www.eia.gov/analysis/studies/powerplants/capitalcost/pdf/capital_cost_AEO2025.pdf
      peakW,
      maxPeakW: Math.min(1500000000, 5000000 * pow(2, (year - 1991) / 3.5)),
      // Largest projects roughly doubled every 3.5 years from Vindeby through Hornsea, then
      // levelled near 1.5GW; Dogger Bank's 3.6GW is three separately phased farms.
      // https://en.wikipedia.org/wiki/List_of_offshore_wind_farms
      btuPerWh: 0,
      annualOperatingCost: 0.154 * peakW,
      yearsToBuild: 3 + magnitude / 3,
      spinMinutes: 1,
      constructionKgco2ePerW: 0.65,
      capacityFactor: offshoreWindCapacityFactor,
      lifespanYears: 25,
    },
    {
      name: "Airborne Wind",
      fuel: "Airborne Wind",
      description:
        "Uses steadier high-altitude wind; new technology with frequent maintenance",
      // NAWEP's current schedule reaches commissioning in 2028 and mature operation in 2030.
      available: year >= 2030,
      buildCost: scaledBuildCost(
        airborneWindCostPerW(year),
        1200000,
        peakW,
        BUILD_COST_FIXED_SHARE.airborneWind,
      ),
      // The 1.2MW NAWEP array is the source anchor. Doubling every two years and the 500MW
      // ceiling are deliberately conservative gameplay assumptions until fleet data exists.
      peakW,
      maxPeakW: airborneWindMaxPeakW(year),
      btuPerWh: 0,
      // NAWEP's series-production model uses EUR45.5/kW-year, converted at $1.13/EUR.
      annualOperatingCost: 0.0514 * peakW,
      yearsToBuild: 2 + magnitude / 3,
      spinMinutes: 1,
      constructionKgco2ePerW: 0.2,
      capacityFactor: airborneWindCapacityFactor,
      lifespanYears: 25,
    },
    {
      name: "Solar",
      fuel: "Sun",
      description:
        "Produces only in daylight and usually peaks near sunny midday",
      available: year > 1982, // First megawatt-sized installations around 1982 https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
      buildCost: scaledBuildCost(
        solarCostPerW(year),
        150000000,
        peakW,
        BUILD_COST_FIXED_SHARE.solar,
      ),
      // IRENA global installed cost fell from inflation-normalized $1,070/kW in 2020 to
      // $691/kW in 2024. Its outlook reaches $388/kW in 2029.
      peakW,
      maxPeakW: year < 2000 ? 100000000 : 2000000000,
      // 2000: 100MW - https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
      // 2019: ~2GW - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: fixedOperatingCost(peakW, 20.23),
      // Latitude, daylight and the location's cloud record determine the capacity factor below.
      yearsToBuild: 2.27 + magnitude / 3,
      // EIA AEO2025 reference lead time is 36 months for a 150MW plant.
      spinMinutes: 1,
      constructionKgco2ePerW: solarConstructionKgco2ePerW(year),
      capacityFactor: solarCapacityFactor,
      // A rounded central case: NREL's 2024 ATB spans 0.7%/yr baseline to 0.5%/yr moderate
      // improvement (and 0.2%/yr advanced).
      annualOutputDegradation: 0.005,
      // 26% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~10-25% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 35,
    },
    {
      name: "Hydro",
      fuel: "Hydro",
      description:
        "Low direct emissions and controllable output, but limited by water and suitable sites",
      available: year > 1882 && hydroAvailability.status === "available",
      buildCost: scaledBuildCost(
        hydroCostPerW(year),
        100000000,
        peakW,
        BUILD_COST_FIXED_SHARE.hydroGeothermal,
      ),
      // IRENA's inflation-normalized global installed cost was effectively flat from 2020 to
      // 2024 at $2,267/kW. Site scarcity is now an explicit cap rather than a second price.
      peakW,
      viableLocationsRemaining: hydroLocationsRemaining,
      maxPeakW: hydroAvailability.largest?.maxPeakW || 0,
      btuPerWh: 0,
      spinMinutes: 1,
      annualOperatingCost: fixedOperatingCost(peakW, 33.54),
      yearsToBuild: 5 + magnitude / 2,
      constructionKgco2ePerW: 2,
      capacityFactor: HYDRO_TARGET_CAPACITY_FACTOR,
      lifespanYears: 50,
      ...hydroSizing(peakW, state.location.watershedId || state.location.id),
    },
    {
      name: "Geothermal",
      fuel: "Geothermal",
      description:
        "Steady low-carbon output, but only at suitable underground heat sources",
      available: (geothermalLocations || 0) > 0,
      buildCost: scaledBuildCost(
        geothermalCostPerW(year),
        50000000,
        peakW,
        BUILD_COST_FIXED_SHARE.hydroGeothermal,
      ),
      // IRENA global installed cost fell from inflation-normalized $5,415/kW in 2020 to
      // $4,015/kW in 2024, although its small project sample makes this series volatile.
      peakW,
      viableLocationsRemaining: geothermalLocationsRemaining,
      maxPeakW: 800000000,
      // ~800MW, except for one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Geothermal
      btuPerWh: 0,
      annualOperatingCost: fixedOperatingCost(peakW, 150.6),
      minimumStableOutput: MINIMUM_STABLE_OUTPUT_BY_FACILITY.Geothermal,
      tracksStarts: true,
      yearsToBuild: 3,
      // EIA AEO2025 reference lead time is 36 months and operating life is 40 years.
      spinMinutes: 1,
      constructionKgco2ePerW: 0.95,
      capacityFactor: 0.88,
      lifespanYears: 40,
    },
    {
      name: "Enhanced Geothermal",
      fuel: "Geothermal",
      description:
        "Steady low-carbon output in more locations than conventional geothermal",
      available: year >= 2030,
      buildCost: scaledBuildCost(
        Math.max(enhancedGeothermalCostPerW, 1.15 * geothermalCostPerW(year)),
        50000000,
        peakW,
        BUILD_COST_FIXED_SHARE.hydroGeothermal,
      ),
      // Fervo's $5.5/W Phase II estimate in 2028 declines toward its $3/W long-term target,
      // but never below 115% of conventional hydrothermal: NREL ATB 2024 keeps EGS above flash
      // and binary plants in every scenario, because stimulation and deeper wells add cost. The
      // $3/W figure is an aspiration, and EGS has no site limit to ration it.
      peakW,
      maxPeakW: 500000000,
      btuPerWh: 0,
      annualOperatingCost: 0.16 * peakW,
      minimumStableOutput:
        MINIMUM_STABLE_OUTPUT_BY_FACILITY["Enhanced Geothermal"],
      tracksStarts: true,
      yearsToBuild: 3 + magnitude / 4,
      spinMinutes: 1,
      constructionKgco2ePerW: enhancedGeothermalConstructionKgco2ePerW(year),
      capacityFactor: 0.83,
      lifespanYears: 30,
    },
    // lcWh is priced below, once difficulty and inflation have scaled the costs
  ] as GeneratorShoppingType[];

  // update with calculations that occur across all entries, like difficulty multipliers
  const difficulty = DIFFICULTIES[state.difficulty];
  const inflation = getCostInflation(state);
  generators = generators.filter((g: GeneratorShoppingType) => {
    g.buildCost *= difficulty.buildCost * inflation;
    g.buildCost *=
      currentStoryEffects.buildCostMultipliersByFuel?.[g.fuel] || 1;
    g.annualOperatingCost *= difficulty.expensesOM * inflation;
    if (g.variableOperatingCostPerMWh !== undefined) {
      g.variableOperatingCostPerMWh *= difficulty.expensesOM * inflation;
    }
    if (g.costPerStart !== undefined) {
      g.costPerStart *= difficulty.expensesOM * inflation;
    }
    g.yearsToBuild *= difficulty.buildTime;
    // Priced on the scaled cost so the option's share is exact; cold-climate gas is winterized by
    // default. The build dialog can then toggle it with withResilienceOption.
    Object.assign(g, applyDefaultResilience(g, state));
    // The custom game screen asks what can be built in a year before any game has loaded the
    // price data a levelized cost needs. Nothing there reads lcWh, and a cost per Wh with no
    // fuel prices behind it is genuinely unknown rather than zero
    g.lcWh = hasFuelPrices()
      ? LCWH(
          g,
          state.date,
          currentStoryEffects.carbonFeePerKgCO2e ?? state.feePerKgCO2e,
          state.seed,
          state.location,
          carbonFeeAtYear,
          Number.isFinite(state.interestRate)
            ? state.interestRate
            : DEFAULT_LCOE_DISCOUNT_RATE,
        )
      : Infinity;
    return g.available || (g.name === "Hydro" && year > 1882);
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

  let storage: StorageShoppingType[] = [
    {
      name: "Battery",
      description:
        "Quick to build and nearly instant to respond, with limited stored energy",
      available: year > 2008, // Project Barbados, 2MW - https://en.wikipedia.org/wiki/List_of_energy_storage_projects
      buildCost: 10000 + batteryCostPerWh(year) * peakWh,
      // NREL's 2020 four-hour benchmark was $345/kWh (2020$); IRENA's global fully installed
      // cost reached $192/kWh in 2024, a 54% real decline after CPI normalization.
      peakW: 0.25 * peakWh,
      // Four-hour duration is now the representative utility-scale configuration in both NREL
      // ATB and EIA AEO2025, replacing the old Powerpack-derived 1.25-hour assumption.
      peakWh,
      maxPeakWh:
        (year < 2021 ? 200000000 : 600000000) * pow(2, (year - 2018) / 4),
      // Tesla 129MWh is largest in world in 2018 - https://hornsdalepowerreserve.com.au/
      // ~2021 largest will be 1.2GWh - https://cleantechnica.com/2020/02/27/humongous-tesla-battery-plant-approved-in-california-is-10x-bigger-than-worlds-biggest-battery-plant/
      // Largest was 50MWh in 2016 - https://en.wikipedia.org/wiki/Battery_storage_power_station#Lithium-ion
      // ~2MWh in 2014, 1MWh before that
      // So roughly doubling in max capacity every 4 years after 2018, but a big step function in 2021
      constructionKgco2ePerWh: batteryConstructionKgco2ePerWh(year),
      lifespanYears: 20,
      // EIA AEO2025 assumes 7,300 equivalent cycles over 20 years.
      roundTripEfficiency: 0.85,
      // https://www.nrel.gov/docs/fy19osti/73222.pdf
      hourlyLoss: 0.0001,
      annualOperatingCost: 0.01 * peakWh,
      // EIA's $10/kWh-year includes augmentation for about 1.5% annual degradation.
      yearsToBuild: batteryYearsToBuild(peakWh),
      // EIA reference total lead time is 18 months for 600MWh.
      spinMinutes: 1,
    },
    {
      name: "Pumped Hydro",
      description:
        "Stores large amounts of energy by pumping water between two reservoirs. Needs a suitable site and years to build, but no river inflow",
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
      constructionKgco2ePerWh: 0.06,
      lifespanYears: 75,
      // https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity#Economic_efficiency
      roundTripEfficiency: 0.8,
      // https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity#Economic_efficiency
      // Evaporation and seepage only: about 0.012%/day, within the 0-0.02%/day that published
      // storage comparisons give (Luo et al. 2015, Applied Energy 137:511, Table 5). The former
      // 0.1%/h lost half an upper reservoir in a month, penalizing the multi-day holding pumped
      // hydro exists for.
      hourlyLoss: 0.000005,
      annualOperatingCost: 0.0019 * peakWh,
      // NREL 2024 ATB fixed O&M is $19/kW-year, or $1.90/kWh-year at ten hours.
      yearsToBuild: 6 + magnitude,
      // 6-10 years to build - https://cleantechnica.com/2020/01/03/120-gigawatts-of-energy-storage-by-2050-we-got-this/
      spinMinutes: 10,
    },
  ];

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
