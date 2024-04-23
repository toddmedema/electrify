import { LCWH } from "../helpers/Financials";
import { DIFFICULTIES } from "../Constants";
import {
  FacilityOperatingType,
  GameType,
  GeneratorShoppingType,
  StorageShoppingType,
} from "../Types";
import {
  getWindCapacityFactor,
  getSolarCapacityFactor,
} from "../helpers/Energy";

// TODO additional sources of information
// BASE DATE: 2018
// Generator construction cost changes over time - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table2.xls
// LCOE across many fuel types - https://www.eia.gov/outlooks/aeo/pdf/electricity_generation.pdf
export function GENERATORS(
  state: GameType,
  peakW: number,
  windSpeedsKph: number[],
  irradiancesWM2: number[]
) {
  const magnitude = Math.log10(peakW) - 6; // 0 = 1MW, 4 = 10GW (+1 for each 10x)
  const year = state.date.year;

  // only needed as a temporary hack for geothermal until https://github.com/toddmedema/electrify/issues/86 done
  const countByFuel = state.facilities.reduce(
    (acc: { [index: string]: number }, f: FacilityOperatingType) => {
      if (f.fuel) {
        acc[f.fuel] = (acc[f.fuel] || 0) + 1;
      }
      return acc;
    },
    {} as { [index: string]: number }
  );

  // Calculate intermittent generator capacity factors (here instead of passed in, since may eventually have different capacity factors
  // for different generator techs for the same resource, e.g. onshore vs offshore wind or fixed vs tracking solar)
  const windCapacityFactor = getWindCapacityFactor(windSpeedsKph);
  const solarCapacityFactor = getSolarCapacityFactor(irradiancesWM2);

  let generators = [
    // FUELED
    {
      name: "Coal",
      fuel: "Coal",
      description: "On-demand but dirty and slow",
      available: true, // Coal was first type of electric plant
      buildCost: 376000000 + 2.6 * peakW, // TODO update to factor in cost growth over time (this is 2008 cost)
      // ~$3500/kw in 2008 - https://schlissel-technical.com/docs/reports_35.pdf
      // $3,500 to $5,000 in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      // 591 plants in the US in 2019 - https://docs.google.com/spreadsheets/d/1JKJJa-jwK6YpkEQKP2bcENHR2yoS40ur8baQnIXHtIU/edit#gid=0
      // With 254,332 MW capacity - https://docs.google.com/spreadsheets/d/1W-gobEQugqTR_PP0iczJCrdaR-vYkJ0DzztSsCJXuKw/edit#gid=0
      // Thus 2019 avg plant is 430 MW and cost $1.5b
      // 1/4 fixed = $376m, 3/4 variable = $2.6/w
      peakW,
      maxPeakW: 6000000000,
      // ~6GW, start in the late 90's - https://www.power-technology.com/features/feature-giga-projects-the-worlds-biggest-thermal-power-plants/
      btuPerWh: 10.5,
      // steady, increasing ~0.1%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
      // Can be 20% lower depending on tech https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      spinMinutes: 360,
      // 6 hours - https://spectrum.ieee.org/green-tech/wind/taming-wind-power-with-better-forecasts
      // 4-8 hours - https://www.reuters.com/article/coal-power-generation/column-to-...wer-plants-must-become-more-flexible-kemp-idUSL5N0J42YG20131119
      annualOperatingCost: 0.05 * peakW * Math.pow(1.04, year - 2018),
      // ~$0.007 -> 0.01/kwh 2008->18, +4%/yr - https://www.eia.gov/electricity/annual/html/epa_08_04.html
      // ~$0.05/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      yearsToBuild: 3 + magnitude / 3,
      // 4 years avg https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      capacityFactor: 0.68,
      // 66% = Max value from https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a
      // ~70% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 50,
      // https://www.fool.com/investing/2018/06/18/could-us-retire-most-coal-fired-power-plants-2040.aspx
    },
    {
      name: "Nuclear",
      fuel: "Uranium",
      description: "On-demand and clean, but very slow",
      available: year > 1956, // First full scale plant was Calder Hall in 1956
      buildCost: 1500000000 + 4.5 * peakW,
      // $6,000/kw in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      // 98 reactors with 100GW of capacity - https://en.wikipedia.org/wiki/Nuclear_power_in_the_United_States
      // Thus 2019 avg plant is ~1GW and cost $6b
      // 1/4 fixed = $1.5b, 3/4 variable = $4.5/w
      peakW,
      maxPeakW: 8000000000,
      // ~8GW, built in the 80's - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Nuclear
      btuPerWh: 10.5,
      // steady - https://www.eia.gov/electricity/annual/html/epa_08_01.html
      spinMinutes: 600,
      annualOperatingCost: 0.1 * peakW * Math.pow(1.005, year - 2018),
      // ~$0.016 -> 0168/kwh 2008->18, +0.5%/yr - https://www.eia.gov/electricity/annual/html/epa_08_04.html
      // ~$0.1/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      yearsToBuild: 5 + magnitude / 4,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      capacityFactor: 0.93,
      // 93% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~89% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 80,
      // https://www.scientificamerican.com/article/nuclear-power-plant-aging-reactor-replacement-/
    },
    {
      name: "Natural Gas",
      fuel: "Natural Gas",
      description: "On-demand, faster and cleaner than coal",
      available: year > 1940, // First full scale plant was 4MW in Switzerland in 1940
      buildCost: 71000000 + 0.75 * peakW,
      // ~$1,000/kw in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls and still in 2019 https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      // 1,854 plants in 2018 - https://www.eia.gov/electricity/annual/html/epa_04_01.html
      // 528GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
      // Thus 2018/9 avg plant is 284MW and cost $284M
      // 1/4 fixed = $71m, 3/4 variable = $0.75/w
      peakW,
      maxPeakW: 6000000000,
      // ~6GW, build in the late 80's - https://www.power-technology.com/features/feature-giga-projects-the-worlds-biggest-thermal-power-plants/
      btuPerWh: 7.8,
      // steadily declining ~0.5%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
      // varies by up to 40% based on tech - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      spinMinutes: 10,
      annualOperatingCost: 0.05 * peakW * Math.pow(1.02, year - 2018),
      // ~$0.006 -> .005/kwh 2008->18, -2%/yr - https://www.eia.gov/electricity/annual/html/epa_08_04.html
      // ~$0.01/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      // varies by up to 3x based on tech - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      yearsToBuild: 2 + magnitude / 3,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      capacityFactor: 0.45,
      // ~38% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      // 55% = max value from https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a
      lifespanYears: 30,
      // TODO
    },
    {
      name: "Oil",
      fuel: "Oil",
      description: "Fast but dirty",
      available: true,
      buildCost: 4500000 + 1.35 * peakW,
      // ~$1,800/kw in 2019 https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      // 3,647 plants in 2018, 37GW capacity - https://www.eia.gov/electricity/annual/html/epa_04_03.html
      // Thus 2018 avg plant is 10MW and cost $18M
      // 1/4 fixed = $4.5m, 3/4 variable = $1.35/w
      peakW,
      maxPeakW: 6000000000,
      // ~6GW, build in 2007 - https://www.power-technology.com/features/feature-giga-projects-the-worlds-biggest-thermal-power-plants/
      btuPerWh: 11,
      // https://www.eia.gov/electricity/annual/html/epa_08_01.html
      spinMinutes: 10,
      annualOperatingCost: 0.05 * peakW * Math.pow(1.02, year - 2018),
      // ~$0.006 -> .005/kwh 2008->18, -2%/yr - https://www.eia.gov/electricity/annual/html/epa_08_04.html
      // ~$0.01/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      yearsToBuild: 1 + magnitude / 3,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      capacityFactor: 0.2,
      // https://www.eia.gov/todayinenergy/detail.php?id=31232
      lifespanYears: 30,
      // TODO
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
      buildCost: 43000000 + 1.4 * peakW * Math.pow(3, (2020 - year) / 40),
      // ~$1,900/kw in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      // ~$1,600/kw in 2019 - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      // 95GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
      // Added in 2017: 64 generators, 5.8GW total - https://www.eia.gov/electricity/generatorcosts/
      // Thus 2017 new avg plant is 90MW and cost $172m
      // 1/4 fixed = $43m, 3/4 variable = $1.4/w
      // Went from ~$5/w in 1980 to ~$1.5/w in 2018, about 1/3 in 40 years - https://newscenter.lbl.gov/2019/08/26/report-confirms-wind-technology-advancements-continue-to-drive-down-the-cost-of-wind-energy/
      peakW,
      maxPeakW: 1500000000,
      // ~1.5GW, except one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: 0.04 * peakW * Math.pow(1.02, year - 2018),
      // TODO estimated 2% decline per year
      // ~$0.04/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      // TODO depends on location
      yearsToBuild: 1 + magnitude / 2,
      // 3 years - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      spinMinutes: 1,
      capacityFactor: windCapacityFactor,
      // 37% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~25% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 25,
      // http://insideenergy.org/2016/09/09/where-do-wind-turbines-go-to-die/
    },
    {
      name: "Solar",
      fuel: "Sun",
      description: "Sunniest at summer noon",
      available: year > 1982, // First megawatt-sized installations around 1982 https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
      buildCost: 3900000 + 1.275 * peakW * Math.pow(2, (2020 - year) / 8),
      // ~$1,700/kw in 2020 for fixed tilt - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      // 36GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
      // Added in 2017: 541 generators, 5GW total - https://www.eia.gov/electricity/generatorcosts/
      // Thus 2017 new avg plant is 9.2MW and cost $15.6m
      // 1/4 fixed = $3.9m, 3/4 variable = $1.275/w
      // Cost curve over time, went from ~8x ($13.6/w) to ~1x ($1.7/w) from 1995 to 2020, so halving ~8 years - https://sites.lafayette.edu/egrs352-sp14-pv/technology/history-of-pv-technology/
      peakW,
      maxPeakW: year < 2000 ? 100000000 : 2000000000,
      // 2000: 100MW - https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
      // 2019: ~2GW - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: 0.025 * peakW * Math.pow(1.02, year - 2018),
      // TODO estimated 2% decline per year
      // ~$0.023/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
      // ~$0.025/wy in 2018 - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      // ~$13/kW/yr in 2018 - https://www.nrel.gov/docs/fy19osti/72399.pdf
      // TODO depends on location
      yearsToBuild: 1 + magnitude / 3,
      // 2 years - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      spinMinutes: 1,
      capacityFactor: solarCapacityFactor,
      // 26% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
      // ~10-25% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 30,
      // https://energyinformative.org/lifespan-solar-panels/
    },
    // {
    //   // NOPE - very limited location options for these, and only two in the world are >20MW
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
      name: "Geothermal",
      fuel: "Geothermal",
      description: "Consistent, but few locations",
      available: true,
      buildCost:
        (10000000 + 4 * peakW) * (1 + (countByFuel.Geothermal || 0) / 4),
      // To compensate for limited locations, cost to build increases significantly with each construction
      // Future ideas: new tech in ~2000 opened up more locations at a slightly higher cost
      // Have multiplier be based on totalPeakWByFuel instead, so that you don't suffer as much from building many smaller plants
      // 2008: $10M fixed costs, $2-5/w total on 50MW project https://en.wikipedia.org/wiki/Geothermal_power#Economics
      // 2023: Total cost ~$2.7/w https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      peakW,
      maxPeakW: 800000000,
      // ~800MW, except for one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Geothermal
      btuPerWh: 0,
      annualOperatingCost: 0.11 * peakW,
      // ~$0.11/wy in 2023 - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      yearsToBuild: 4,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      spinMinutes: 1,
      capacityFactor: 0.9,
      // Only utilized about 70% of the time - https://en.wikipedia.org/wiki/Electricity_sector_of_the_United_States#Renewable_energy
      // But technically availabe up to 90% of the time - https://www.energy.gov/eere/geothermal/geothermal-faqs
      lifespanYears: 40,
      // TODO
    },
    // {
    //   name: 'Hydro',
    //   fuel: 'Rain',
    //   description: 'Clean, cheap and dispatchable - until there\'s a drought',
    // available: true,
    //   buildCost: 200000000,
    // 1,458 plants in 2018 - https://www.eia.gov/electricity/annual/html/epa_04_01.html
    // 100GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf

    // $1k-5k/kW - https://www.hydro.org/waterpower/why-hydro/affordable/
    //   peakW,
    // maxPeakW: 10000000000,
    // ~10GW - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Nuclear
    //   spinMinutes: 1,
    //   annualOperatingCost: 1000000 * 0.4,
    // about 0.0017/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    // ~40% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
    //   yearsToBuild: 4,
    // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
    // capacityFactor: 0.43,
    // https://en.wikipedia.org/wiki/Electricity_sector_of_the_United_States#Renewable_energy
    // },

    // TODO biomass
  ] as GeneratorShoppingType[];

  // update with calculations that occur across all entries, like difficulty multipliers
  const difficulty = DIFFICULTIES[state.difficulty];
  generators = generators.filter((g: GeneratorShoppingType) => {
    g.buildCost *= difficulty.buildCost;
    g.annualOperatingCost *= difficulty.expensesOM;
    g.yearsToBuild *= difficulty.buildTime;
    g.lcWh = LCWH(g, state.date, state.feePerKgCO2e);
    return g.available;
  });

  return generators;
}

export function STORAGE(state: GameType, peakWh: number) {
  // 0 = 1MW, 4 = 10GW (+1 for each 10x)
  const magnitude = Math.log10(peakWh) - 6;
  const year = state.date.year;

  let storage = [
    {
      name: "Battery",
      description: "Fast to build and charge / discharge",
      available: year > 2008, // Project Barbados, 2MW - https://en.wikipedia.org/wiki/List_of_energy_storage_projects
      buildCost: 10000 + 0.4 * peakWh,
      // ~$400/kWh in 2016, drops 60% by 2030 - https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2017/Oct/IRENA_Electricity_Storage_Costs_2017_Summary.pdf
      // Also, Tesla grid-scale batteries around $400/kWh in 2019 - https://cleantechnica.com/2019/11/24/what-a-108-26-per-kwh-battery-pack-would-mean-for-tesla/
      peakW: 0.8 * peakWh,
      // ~0.8x c rating - https://www.tesla.com/blog/tesla-powerpack-enable-large-scale-sustainable-energy-south-australia?redirect=no
      peakWh,
      maxPeakWh:
        (year < 2021 ? 200000000 : 600000000) * Math.pow(2, (year - 2018) / 4),
      // Tesla 129MWh is largest in world in 2018 - https://hornsdalepowerreserve.com.au/
      // ~2021 largest will be 1.2GWh - https://cleantechnica.com/2020/02/27/humongous-tesla-battery-plant-approved-in-california-is-10x-bigger-than-worlds-biggest-battery-plant/
      // Largest was 50MWh in 2016 - https://en.wikipedia.org/wiki/Battery_storage_power_station#Lithium-ion
      // ~2MWh in 2014, 1MWh before that
      // So roughly doubling in max capacity every 4 years after 2018, but a big step function in 2021
      lifespanYears: 15,
      // https://www.nrel.gov/docs/fy19osti/73222.pdf
      roundTripEfficiency: 0.85,
      // https://www.nrel.gov/docs/fy19osti/73222.pdf
      hourlyLoss: 0.0001,
      // TODO #'s
      // TODO implement mechanic
      annualOperatingCost: 0.002 * peakWh,
      // ~$3/kWh of capacity, assuming 100% load factor - https://www.nrel.gov/docs/fy19osti/73222.pdf
      // ~$2/kWh at a more realistic 50% load factor
      // LCOE ~$500/MWh served in 2016 - https://www.greentechmedia.com/articles/read/report-levelized-cost-of-energy-for-lithium-ion-batteries-bnef
      yearsToBuild: 0.2 + magnitude / 3,
      // Took Tesla ~6 months to build 120MWh of capacity - https://en.wikipedia.org/wiki/Hornsdale_Power_Reserve
      spinMinutes: 1,
    },
    {
      name: "Pumped Hydro",
      description: "Slow to build and charge / discharge",
      available: year > 1930, // New Milfrod plant, 33MW - https://blogs.scientificamerican.com/plugged-in/throwback-thursday-the-first-u-s-energy-storage-plant/
      buildCost: 2000000 + 0.15 * peakWh,
      // Large fixed costs, smallest plants are around 10MW - https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity#Economic_efficiency
      // Most seem to be around 100-1000MW - https://web.archive.org/web/20121007084413/http://www.renewableenergyworld.com/rea/news/article/2010/10/worldwide-pumped-storage-activity
      // ~$50/kWh in 2017 - https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2017/Oct/IRENA_Electricity_Storage_Costs_2017_Summary.pdf
      // ~$350-800/kW in 2000, thus about 1,600 in 2018 - http://large.stanford.edu/courses/2014/ph240/galvan-lopez2/
      // ~$1,700-2500/kW in 2018 - https://www.hydro.org/wp-content/uploads/2018/04/2018-NHA-Pumped-Storage-Report.pdf
      peakW: 0.1 * peakWh,
      // Around 1/5th to 1/20th for larger projects - https://en.wikipedia.org/wiki/List_of_pumped-storage_hydroelectric_power_stations
      peakWh,
      maxPeakWh: 20000000000,
      // 24GWh, build in 1970's - http://large.stanford.edu/courses/2014/ph240/galvan-lopez2/
      // BUT, very location dependent...
      lifespanYears: 75,
      // https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity#Economic_efficiency
      roundTripEfficiency: 0.8,
      // https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity#Economic_efficiency
      hourlyLoss: 0.001,
      // TODO #'s
      // TODO implement mechanic
      annualOperatingCost: 0.01 * 0.15 * peakWh,
      // ~$5/kw in 2000, so about $10 in 2018 - http://large.stanford.edu/courses/2014/ph240/galvan-lopez2/
      // (multiplied by the peakWh -> W rate)
      yearsToBuild: 6 + magnitude,
      // 6-10 years to build - https://cleantechnica.com/2020/01/03/120-gigawatts-of-energy-storage-by-2050-we-got-this/
      spinMinutes: 10,
    },
    // TODO thermal storage, hydrogen, ...
  ] as StorageShoppingType[];

  // update with calculations that occur across all entries, like difficulty multipliers
  const difficulty = DIFFICULTIES[state.difficulty];
  storage = storage.filter((g: StorageShoppingType) => {
    g.buildCost *= difficulty.buildCost;
    g.annualOperatingCost *= difficulty.expensesOM;
    g.yearsToBuild *= difficulty.buildTime;
    return g.available;
  });

  return storage;
}
