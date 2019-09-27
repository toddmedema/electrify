import {GeneratorDefinition, ResearchDefinition} from './reducers/StateTypes'

export const NODE_ENV = (process && process.env && process.env.NODE_ENV) || 'dev';

export const VIBRATION_SHORT_MS = 30; // for navigation
export const VIBRATION_LONG_MS = 400; // for unique events
export const NAVIGATION_DEBOUNCE_MS = 600;

export const YEAR_HOURS = 24 * 365;
/*
Sources:
- 2010 detailed costs, including fixed vs variable + subsidies: https://www.lazard.com/media/438038/levelized-cost-of-energy-v100.pdf
  (2005 version: http://energyinnovation.org/2015/02/07/levelized-cost-of-energy/)
  Total, unsubsidized costs /MWh per fuel:
  - Coal: $60-143
  - Natural Gas: $68-101
  - Natural Gas Peaking:
  - Diesel: $212-281
  - Nuclear: $97-136
  - Solar PV: $46-56
  - Solar Thermal (with storage): $119-182
  - Geothermal: $79-117
  - Wind: $32-62
  - Hydro: ?

- TO PARSE: construction costs: https://www.eia.gov/analysis/studies/powerplants/capitalcost/pdf/capcost_assumption.pdf

- Analysis of long term coal plant construction and capacity trends: https://www.sourcewatch.org/index.php/Existing_U.S._Coal_Plants#U.S._coal-fired_power_production_in_the_global_context

Observations:
- Anything over $100/MWh($0.10/kWh) doesn't make normal sense - but is critical for peaking
- Remember that the AVERAGE price paid will be $100/MWh, but the whole name of this game
  is being fleixble and capturing market demand

Questions / figure out:
- How should the market react to demand spikes and troughs? 100x difference?
  - The real question is: what incentives should there be to get players to act in a desired behavior?
- How to handle financing? Obviously can't have players deal with raw purchasing
  since the raw purchase price is 2 orders of magnitude greater than operational....
  THOUGHT: like all of the sources I've checked, list a construction cost per (MWh?)
  - That then gets treated as a loan that you pay off for the lifetime of the generator (even if paused or demolished)


Cashflow report:
- current money
- (construction loans)
- (powerplant fixed / operational costs)
- (powerplant variable costs to meet estimated demand)
- revenue from supplying estimated demand
- estimated money at end of quarter


v2:
- select geography / location? Which might limit power plant options and change fuel prices
  - for example, you might only have one (or zero!) hydro sites, and then you'd have to choose
    between hydro plant vs PSH storage
- small variations in renewables throughout the day, plus "generators" that are energy storage,
  which soak up surplus and automatically insert back into the grid when demand > supply
  (and their UI shows how much energy they have stored / remaining / are currently outputting or gaining)
  - Specific technologies have different capacity, response / ramp times, construction + operation costs, round-trip power efficiency
    Observation: PSH should actually be more economical at a large scale than peaking power plants
    Observation: response / ramp times would only matter if I got down to sub-minute levels of billing & goal precision,
                 otherwise, can skip that factor for simplicity
    Engine note: in the same way generators remember their previous output level, batteries would want to remember their current charge
    - Flywheels: ultrafast response; small capacity and cheap per unit (but high enough operational costs that not sensible for large scale)
    - Lead Acid: ultrafast response; medium capacity and price
    - Li-Ion: ultrafast response; larger capacity, but more expensive
    - Pumped-Storage Hydroelectricity; gigantic capacity, but slow ramp time and expensive to install (but not expensive on a per-capacity operational basis); 70-86% round trip efficient
      Another option: Could also use seawater + (tall, 2,000ft+) seaside cliffs
      Another option: Undersea spheres: https://en.wikipedia.org/wiki/Pumped-storage_hydroelectricity
*/

// TODO move this into a CSV format... will be way easier to work with, and to sort, validate, etc
export const GENERATORS = [
  { // Use this as a template for all new generators
    id: 0, // index in list
    name: 'Small Baseline Coal',
    description: 'Small and cheap with a steady output, the workhorse of a young utility company.',
    size: 'small', // small, medium, large, super
    type: 'baseline', // baseline, load-following, peaking
    costBuild: 244000000, // Can look at amortized construction costs vs lifespan * output
    costOperate: 438000, // Operational cost for a ~90 day period (1/4 year)
    costMWh: 30, // Variable O&M + Fuel
    lifespanYears: 30,
    costAmortizedMWh: 115, // At 100% capacity; helpful for comparison and validating rest of #'s
    costPercentBuild: 0.77, // Percent of total amortized costs that building represents
    costPercentFixed: 0.07, // Percent of total amortized costs that operation represents
    costPercentVariable: 0.16, // Percent of total amortized costs that variable / per MWh represents
    fuel: 'coal',
    whMin: 100000000, // min != max for controllable and variable generators
    whMax: 100000000,
    rampMWh: 0, // 0 = uncontrolled (ie solar, wind, baseline generators)
  },
  {
    id: 1,
    name: 'Small Peaking Coal',
    description: 'Not the most efficient generator, but it can spin up and down quickly for spikes in demand.',
    size: 'small',
    type: 'peaking',
    costBuild: 620000000,
    costOperate: 580000,
    costMWh: 29.4,
    lifespanYears: 20,
    costAmortizedMWh: 143,
    costPercentBuild: 0.74,
    costPercentFixed: 0.06,
    costPercentVariable: 0.20,
    fuel: 'coal',
    whMin: 0,
    whMax: 50000000,
    rampMWh: 50,
  },
] as GeneratorDefinition[];

// TODO
export const RESEARCH = {
  // 'Pulvarized coal-fired generator; burns powderized coal at 1,300°C to create steam, turning a turbine.'
  // id: {cost, duration, [requiredIds], [rewardGeneratorIds]}
} as {[key: number]: ResearchDefinition};
