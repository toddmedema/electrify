import {LCWH} from 'shared/helpers/Financials';
import {CardNameType, DifficultyMultipliersType, FuelType, GameStateType, GeneratorShoppingType, MonthType, StorageShoppingType} from './Types';

export const DIFFICULTIES = {
  Intern: {
    buildCost: 0.6,
    expensesOM: 0.6,
    buildTime: 0.2,
    blackoutPenalty: 2,
  },
  Employee: {
    buildCost: 0.7,
    expensesOM: 0.7,
    buildTime: 0.3,
    blackoutPenalty: 4,
  },
  Manager: {
    buildCost: 0.8,
    expensesOM: 0.8,
    buildTime: 0.5,
    blackoutPenalty: 6,
  },
  VP: {
    buildCost: 0.9,
    expensesOM: 0.9,
    buildTime: 0.75,
    blackoutPenalty: 8,
  },
  CEO: {
    buildCost: 1,
    expensesOM: 1,
    buildTime: 1,
    blackoutPenalty: 10,
  },
  Guru: {
    buildCost: 1.2,
    expensesOM: 1.1,
    buildTime: 1,
    blackoutPenalty: 12,
  },
} as {[index: string]: DifficultyMultipliersType};

export const TICK_MS = {
  PAUSED: 150,
  SLOW: 80,
  NORMAL: 40,
  FAST: 1,
  LIGHTNING: 0,
};

export const INFLATION = 0.03;
export const REGIONAL_GROWTH_MAX_ANNUAL = 0.05;
export const RESERVE_MARGIN = 0.05;
export const GENERATOR_SELL_MULTIPLIER = 0.5;
export const DOWNPAYMENT_PERCENT = 0.2;
export const INTEREST_RATE_YEARLY = 0.04;
export const LOAN_MONTHS = 30 * 12;

export const TICK_MINUTES = 15;
export const TICKS_PER_HOUR = 60 / TICK_MINUTES;
export const TICKS_PER_DAY = Math.ceil(1440 / TICK_MINUTES);
export const DAYS_PER_MONTH = 1;
export const TICKS_PER_MONTH = TICKS_PER_DAY / DAYS_PER_MONTH;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * 12;
export const HOURS_PER_YEAR_REAL = 24 * 365;
export const GAME_TO_REAL_YEARS = 365 / DAYS_PER_YEAR;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as MonthType[];
export const YEARS_PER_TICK = TICK_MINUTES / (DAYS_PER_YEAR * 1440);

export const UNSUPPORTED_BROWSERS = /^(.*amazon silk.*)|(.*(iphone|ipad|ipod|ios) os 9_.*)$/i;

export const URLS = {
  // lowercase to match lowercase platform names
  android: 'TODO',
  ios: 'TODO',
  web: 'http://electrifygame.com',
};

export const INIT_DELAY = {
  LOAD_AUDIO_MILLIS: 2000,
};

// TODO additional sources of information
// Lifetime GHG for all fuels: https://en.wikipedia.org/wiki/Life-cycle_greenhouse-gas_emissions_of_energy_sources

export const FUELS = {
  // ~31kJ/g - https://hypertextbook.com/facts/2006/LunChen.shtml
  // Thus 1GJ = 32kg
  // Historic price per short ton (907kg): https://www.eia.gov/energyexplained/coal/prices-and-outlook.php
  // Just CO2 emission per MBTu (215lb/1.05GJ): https://www.eia.gov/tools/faqs/faq.php?id=73&t=11
  // TODO I arrived at this number by tweaking it in the simulation vs EIA numbers
    // Need to figure out where my calculations went wrong
  'Coal': {
    // costPerBtu: 0.000002, // pretty even 2000-2018
    kgCO2ePerBtu: 0.000112, // https://www.epa.gov/sites/production/files/2015-08/documents/aberdeen-merged-deter-ltr.pdf
  },

  // ~1030Btu/cf https://www.eia.gov/todayinenergy/detail.php?id=18371
  // Thus 1GJ = .92cf
  // Historic price per thousand cf: https://www.eia.gov/dnav/ng/hist/n3035us3m.htm
    // California about national average, but does vary by location: http://www.ppinys.org/reports/jtf2004/naturalgas.htm
  // Natural gas has a large methane component, not just CO2 https://www.epa.gov/sites/production/files/2018-01/documents/2018_executive_summary.pdf
  // 15lbs CO2e per 100cf http://www.co2list.org/files/carbon.htm
  // TODO I arrived at this number by tweaking it in the simulation vs EIA numbers
    // Need to figure out where my calculations went wrong
  'Natural Gas': {
    // costPerBtu: 0.000003, // Between 2000 and 2018, sometimes spiked to 3x price - using $5/1k cf avg here, ranges $4-12
    kgCO2ePerBtu: 0.000068, // https://www.epa.gov/sites/production/files/2015-08/documents/aberdeen-merged-deter-ltr.pdf
  },

  // $0.71 per million BTU https://www.eia.gov/opendata/qb.php?category=40290&sdid=SEDS.NUETD.WI.A
  'Uranium': {
    // costPerBtu: 0.00000071,
    kgCO2ePerBtu: 0,
  },

  // TODO
  // 'Oil': {
  //   costPerBtu: 999,
  //   kgCO2ePerBtu: 999,
  // },

  // TODO https://www.planete-energies.com/en/medias/close/incineration-heating-power-refuse
  // 'Trash': {
  //   costPerBtu: 999,
  //   kgCO2ePerBtu: 999,
  // },
} as { [fuel: string]: FuelType };

// TODO additional sources of inforomation
// Generator construction cost changes over time - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table2.xls
// LCOE across many fuel types - https://www.eia.gov/outlooks/aeo/pdf/electricity_generation.pdf
export function GENERATORS(state: GameStateType, peakW: number) {
  // 0 = 1MW, 4 = 10GW (+1 for each 10x)
  const magnitude = Math.log10(peakW) - 6;

  let generators = [
    // FUELED
    {
      name: 'Coal',
      fuel: 'Coal',
      description: 'On-demand but dirty and slow',
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
      annualOperatingCost: 0.09 * peakW,
        // ~$0.01/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
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
      name: 'Nuclear',
      fuel: 'Uranium',
      description: 'On-demand and clean, but very slow',
      available: (state.date.year > 1956), // First full scale plant was Calder Hall in 1956
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
      annualOperatingCost: 0.12 * peakW,
        // ~$0.0168/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
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
      name: 'Natural Gas',
      fuel: 'Natural Gas',
      description: 'On-demand, faster and cleaner than coal',
      available: (state.date.year > 1940), // First full scale plant was 4MW in Switzerland in 1940
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
      annualOperatingCost: 0.05 * peakW,
        // ~$0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
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
    // {
    //   name: 'Oil', // Aka petroleum
    //   fuel: 'Oil',
    //   description: 'Dispatchable, but fuel prices swing',
    //   buildCost: 200000000,
      // 1,087 plants in 2018 - https://www.eia.gov/electricity/annual/html/epa_04_01.html
      // 40 GW in 2019 ("fuel oil") - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
    //   peakW,
    //   btuPerW: 11,
    //     // varies by ~1%/yr - https://www.eia.gov/electricity/annual/html/epa_08_01.html
    //   spinMinutes: 10,
    //   annualOperatingCost: 1000000, // TODO make variable
    //     // about 0.005/kwh in 2018 - https://www.eia.gov/electricity/annual/html/epa_08_04.html
    //   yearsToBuild: 2,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      // capacityFactor: 0.66,
        // Max value from https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a
    // },

    // RENEWABLE
    {
      name: 'Wind',
      fuel: 'Wind',
      description: 'Windiest at spring and fall evenings',
      available: (state.date.year > 1941), // First megawatt-size turbine was in Vermont in 1941
      buildCost: 43000000 + 1.4 * peakW,
        // ~$1,900/kw in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // ~$1,600/kw in 2019 - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
        // 95GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
        // Added in 2017: 64 generators, 5.8GW total - https://www.eia.gov/electricity/generatorcosts/
        // Thus 2017 new avg plant is 90MW and cost $172m
        // 1/4 fixed = $43m, 3/4 variable = $1.4/w
      peakW,
      maxPeakW: 1500000000,
        // ~1.5GW, except one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: 0.012 * peakW,
        // ~$0.04/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // TODO depends on location
      yearsToBuild: 1 + magnitude / 2,
        // 3 years - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      spinMinutes: 1,
      capacityFactor: 0.31,
        // 37% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
        // ~25% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 25,
        // http://insideenergy.org/2016/09/09/where-do-wind-turbines-go-to-die/
    },
    {
      name: 'Solar',
      fuel: 'Sun',
      description: 'Sunniest at summer noon',
      available: (state.date.year > 1982), // First megawatt-sized installations around 1982 https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
      buildCost: 3900000 + 1.275 * peakW,
        // ~$1,700/kw in 2020 for fixed tilt - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
        // 36GW capacity in 2019 - https://www.publicpower.org/system/files/documents/67-America%27s%20Electricity%20Generation%20Capacity%202019_final2.pdf
        // Added in 2017: 541 generators, 5GW total - https://www.eia.gov/electricity/generatorcosts/
        // Thus 2017 new avg plant is 9.2MW and cost $15.6m
        // 1/4 fixed = $3.9m, 3/4 variable = $1.275/w
      peakW,
      maxPeakW: (state.date.year < 2000) ? 100000000 : 2000000000,
        // 2000: 100MW - https://www1.eere.energy.gov/solar/pdfs/solar_timeline.pdf
        // 2019: ~2GW - https://en.wikipedia.org/wiki/List_of_largest_power_stations
      btuPerWh: 0,
      annualOperatingCost: 0.008 * peakW,
        // ~$0.023/wy in 2016 - https://www.eia.gov/analysis/studies/powerplants/capitalcost/xls/table1.xls
        // ~$0.025/wy in 2018 - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
        // TODO depends on location
      yearsToBuild: 1 + magnitude / 3,
        // 2 years - https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      spinMinutes: 1,
      capacityFactor: 0.22,
        // 26% = Max value from https://en.wikipedia.org/wiki/Capacity_factor#United_States
        // ~10-25% duty cycle - https://sunmetrix.com/what-is-capacity-factor-and-how-does-solar-energy-compare/
      lifespanYears: 30,
        // https://energyinformative.org/lifespan-solar-panels/
    },
    // {
    //   name: 'Tidal',
    //   fuel: 'Tides',
    //   description: 'Stable output except 4 times per day',
    //   buildCost: 200000000,
    //   peakW,
    // maxPeakW: 250000000,
    // ~250MW - https://en.wikipedia.org/wiki/List_of_largest_power_stations
    //   annualOperatingCost: 1000000,
    //   yearsToBuild: 1,
      // spinMinutes: 1,
    // },
    // {
        // Still only has a capacity factor of .733, why? https://en.wikipedia.org/wiki/Electricity_sector_of_the_United_States#Renewable_energy
    //   name: 'Geothermal',
    //   fuel: 'Ground Heat',
    //   description: 'Cheap and always on, but limited locations',
    //   buildCost: 200000000,
    //   peakW,
    // maxPeakW: 800000000,
    // ~800MW, except for one outlier - https://en.wikipedia.org/wiki/List_of_largest_power_stations#Nuclear
    //   annualOperatingCost: 1000000,
    //   yearsToBuild: 4,
      // https://www.eia.gov/outlooks/aeo/assumptions/pdf/table_8.2.pdf
      // spinMinutes: 1,
    // },
    // {
    //   name: 'Hydro',
    //   fuel: 'Rain',
    //   description: 'Clean, cheap and dispatchable - until there\'s a drought',
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
    // },
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

export function STORAGE(state: GameStateType, peakWh: number) {
  // 0 = 1MW, 4 = 10GW (+1 for each 10x)
  const magnitude = Math.log10(peakWh) - 6;

  let storage = [
    {
      name: 'Lithium-Ion Battery',
      description: 'Fast to build and charge / discharge',
      available: (state.date.year > 2008), // Project Barbados, 2MW - https://en.wikipedia.org/wiki/List_of_energy_storage_projects
      buildCost: 10000 + 0.4 * peakWh,
        // ~$400/kWh in 2016, drops 60% by 2030 - https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2017/Oct/IRENA_Electricity_Storage_Costs_2017_Summary.pdf
          // Also, Tesla grid-scale batteries around $400/kWh in 2019 - https://cleantechnica.com/2019/11/24/what-a-108-26-per-kwh-battery-pack-would-mean-for-tesla/
      peakW: 0.8 * peakWh,
        // ~0.8x c rating - https://www.tesla.com/blog/tesla-powerpack-enable-large-scale-sustainable-energy-south-australia?redirect=no
      peakWh,
      maxPeakWh: 200000000,
        // Tesla 129MWh is largest in world in 2018 - https://hornsdalepowerreserve.com.au/
        // Largest was 50MWh in 2016 - https://en.wikipedia.org/wiki/Battery_storage_power_station#Lithium-ion
        // ~2MWh in 2014, 1MWh before that
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
      name: 'Pumped Hydro',
      description: 'Slow to build and charge / discharge',
      available: (state.date.year > 1930), // New Milfrod plant, 33MW - https://blogs.scientificamerican.com/plugged-in/throwback-thursday-the-first-u-s-energy-storage-plant/
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

export const NAV_CARDS = ['GENERATORS', 'STORAGE', 'FINANCES'] as CardNameType[];
export const CARD_TRANSITION_ANIMATION_MS = 300;
export const VIBRATION_SHORT_MS = 30; // for navigation / card changes
export const VIBRATION_LONG_MS = 400; // for unique events, like start of the timer
export const NAVIGATION_DEBOUNCE_MS = 600;
export const DOUBLE_TAP_MS = 500; // Maximum ms between tap / clicks to count as a double click
export const AUDIO_COMMAND_DEBOUNCE_MS = 300;
export const MUSIC_INTENSITY_MAX = 36;

export interface MusicDefinition {
  baselineInstruments: string[];
  bpm: number;
  directory: string;
  instruments: string[];
  loopMs: number;
  maxIntensity: number;
  minIntensity: number;
  peakingInstrument: string;
  variants: number;
}

export const MUSIC_DEFINITIONS: {[key: string]: {[key: string]: MusicDefinition}} = {
  combat: {
    heavy: {
      baselineInstruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings'],
      bpm: 140,
      directory: 'combat/heavy/',
      instruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings', 'HighBrass'],
      loopMs: 13712,
      maxIntensity: MUSIC_INTENSITY_MAX,
      minIntensity: 12,
      peakingInstrument: 'HighBrass',
      variants: 6,
    },
    light: {
      // peakingInstrument always at the end
      baselineInstruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings'],
      bpm: 120,
      directory: 'combat/light/',
      instruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings', 'HighBrass'],
      loopMs: 8000,
      maxIntensity: 24,
      minIntensity: 0,
      peakingInstrument: 'HighBrass',
      variants: 12,
    },
  },
};

export const MUSIC_FADE_SECONDS = 1.5;
