# Facility economics refresh

Last reviewed: 2026-09-28 (gas split into a simple-cycle peaker and a combined cycle). The
implemented latest observations are 2023 for EIA's engineering estimates and 2024 for IRENA's
global deployment data.

## Method

The previous model mixed figures from several dollar years. This refresh separates two effects:

1. Published observations are converted to one vintage, 2023 dollars, with annual-average U.S.
   CPI-U (2019: 255.657; 2020: 258.811; 2023: 304.702; 2024: 313.689; 2025: 321.943). The
   IRENA and NREL 2024-dollar curves (wind, solar, hydro, geothermal, battery) are multiplied by
   `304.702 / 313.689`, and EIA's 2025-dollar biomass plant by `304.702 / 321.943`. The table
   below quotes each source in its own dollars.
2. The remaining change is treated as a real technology-cost trend. The game's own inflation
   multiplier is still applied later, so inflation is not counted twice.

Capital costs use exponential interpolation between observations. Costs are held at the first
observation before the comparison window and at the latest observation afterward, except for wind
and solar: IRENA publishes five-year outlook values for those technologies, so they continue to
those values through 2029 and then stop. Pre-2020 wind and solar retain the game's historical
learning curves, re-anchored to the inflation-normalized 2020 observation. Pre-2020 batteries
double in cost every 4.5 years back from 2020 (about $2/Wh in 2010, consistent with BNEF pack prices
of $1,100-1,400/kWh then plus balance of system) instead of being held at the 2020 price.

Published costs are for reference projects, while the player can choose almost any plant size. The
model therefore treats a technology-specific share of the reference project as fixed and the rest
as capacity-proportional, so every reference-sized facility equals the cited total installed cost.
The shares follow how much scale actually matters: solar 1%, onshore wind 2%, offshore wind 3% and
airborne wind 5% (LBNL's utility-scale solar and land-based wind reports put 5-20 MW projects only
~10-40% above 100 MW-plus ones); coal, nuclear and gas 12%; hydro and geothermal 15%; biomass and
oil keep 25%. A flat 25% had made a 10 MW solar farm cost 4.5x its reference price per watt and an
early 5 MW offshore farm over $30/W.

## What changed in real terms

| Facility                  | Older observation in latest-year dollars | Latest observation |        Real change | Model source                                         |
| ------------------------- | ---------------------------------------: | -----------------: | -----------------: | ---------------------------------------------------- |
| Coal                      |                         $4,381/kW (2019) |   $4,103/kW (2023) |              -6.3% | EIA standardized reference plant                     |
| Nuclear                   |                         $7,200/kW (2019) |   $7,861/kW (2023) |              +9.2% | EIA standardized reference plant                     |
| Natural gas, simple cycle |                           $850/kW (2019) |     $836/kW (2023) |              -1.6% | EIA standardized reference plant                     |
| Natural gas, combined     |                         $1,142/kW (2019) |     $868/kW (2023) |             -24.0% | EIA standardized reference plant                     |
| Oil / internal combustion |              $2,145/kW (2019 assumption) |   $1,248/kW (2023) |             -41.8% | EIA-860 actual installed generators                  |
| Onshore wind              |                         $1,642/kW (2020) |   $1,041/kW (2024) |             -36.6% | IRENA global weighted average                        |
| Solar PV                  |                         $1,070/kW (2020) |     $691/kW (2024) |             -35.4% | IRENA global weighted average                        |
| Hydropower                |                         $2,267/kW (2020) |   $2,267/kW (2024) | approximately flat | IRENA global weighted average                        |
| Geothermal                |                         $5,415/kW (2020) |   $4,015/kW (2024) |             -25.9% | IRENA global weighted average; small sample          |
| Four-hour battery         |                          $418/kWh (2020) |    $192/kWh (2024) |             -54.1% | NREL 2020 baseline; IRENA 2024 global installed cost |

The EIA and IRENA battery values are not contradictory measures of exactly the same market. EIA's
2023 U.S. greenfield reference is $436/kWh and explicitly includes a substation, while IRENA reports
a $192/kWh global weighted average for fully installed projects in 2024 after a particularly sharp
year of price declines. Electrify has worldwide locations, so the capital curve uses IRENA; EIA's
detailed design is used for duration, life, construction time, and augmentation O&M.

## Operating and performance logic

Where a source separates fixed O&M in $/kW-year from variable O&M in $/MWh, the fixed part is
charged on standing capacity and the variable part on energy actually generated: coal $6.40, nuclear
$2.52, gas peaker $1.24, gas combined cycle $3.41 and biomass $5.61 per MWh (2023$), plus oil as
described below. An idle or
paused plant therefore pays no variable O&M, and the keep-online versus restart decision counts it.
Build quotes still annualize it at the modeled capacity factor. Actual fuel and carbon expenses
remain separate for every generator.

The EIA AEO2025 reference designs also update:

- Coal: 8,638 Btu/kWh, 60-month reference lead time, and 40-year operating life.
- Nuclear: 10,608 Btu/kWh, 84-month reference lead time, and 40-year economic life.
- Natural Gas Peaker (Case 4, a 419 MW H-class simple-cycle turbine): 9,142
  Btu/kWh, a 40-month lead time, and a 40-year life. Its $6.87/kW-year fixed O&M and $1.24/MWh
  consumables remain the base O&M; EIA reports start maintenance separately at $23,100 per
  equivalent start for the 419 MW reference plant, scaled linearly for the player's chosen size.
  The build quote adds one start per day ($8.432 million/year for the reference plant) to make the
  tradeoff legible, while live play charges only on actual off-to-on edges. Because one simulated
  day represents a month, each visible edge represents 365/12 equivalent starts. Coal's quote
  assumes 20 starts a year instead, within the 10-50 that NREL's cycling-cost and WWSIS Phase 2
  studies report for large coal units; a daily start had added ~$5/MWh to its quoted LCOE. The
  peaker's capacity factor is 12%, the 2016-2025 average of 9.6-14.1% for U.S. gas combustion
  turbines in EIA Electric Power Monthly Table 6.07.A. It had been 45%, a figure for all gas that
  made the peaker's quoted cost per MWh look like baseload. Its size cap is 2 GW (about five
  reference turbines); the 6 GW cap now belongs to the combined cycle.
- Natural Gas CC (Case 5, a 1,227 MW 2x2x1 H-class combined cycle): $868/kW, 6,266 Btu/kWh (31%
  less fuel per MWh than the peaker), $12.12/kW-year fixed and $3.41/MWh variable O&M, a
  42-month lead time (18 months development, 24 construction) and a 40-year life. AEO2020's
  1,083 MW 2x2x1 case was $958/kW in 2019$ (6,370 Btu/kWh, $12.20 and $1.90). EIA reports no
  separate per-start charge for this case because its turbine maintenance is hours-driven and
  sits in variable O&M, so the start charge is NREL's cycling damage instead (below). Capacity
  factor is 57%, the 2016-2025 average of 51.2-60.5% for U.S. combined cycles in Table 6.07.A.
  The quote assumes 100 starts a year, a gameplay assumption between coal's 20 and the peaker's
  daily start. Spin-up is 90 minutes, a blend of hot starts that reach full load in well under an
  hour and warm or cold starts that take hours while the steam side heats; minimum stable output
  is 45%. It is available from 1990, when the first F-class turbine entered combined-cycle
  service at Virginia Power's Chesterfield station. Per watt, EIA's reference combined cycle costs
  about as much as its reference peaker; the peaker's economic case is that it stays cheap when
  built small (a 100 MW peaker quotes about $1,150/kW, a 100 MW combined cycle about $2,040/kW,
  because 12% of each reference project is fixed) and that it costs little to keep in reserve.
  Heat rates are held at the reference plant for every year, as they are for the other thermal
  plants, so an early combined cycle is somewhat more efficient than its real contemporaries.
- Oil: the matched EIA commercial Oil reciprocating-engine case reports $24/kW-year fixed O&M and
  $20/MWh variable O&M in 2015 dollars. Annual-average CPI-U (`304.702 / 237.017`) converts these
  to $30.8536856/kW-year and $25.7114047/MWh in 2023 dollars. Fixed O&M scales with nameplate and
  variable O&M is charged against actual representative-month generation. A 100 MW build at the
  modeled 20% capacity factor therefore quotes $3.085 million/year fixed plus $4.505 million/year
  variable, or $7.590 million/year before difficulty and later game inflation. Difficulty is
  persisted at construction; the quote then escalates with game inflation from the purchase month.
- Onshore wind: $33.06/kW-year fixed O&M, 21-month reference lead time, and 25-year life.
- Offshore wind, added on `master` while this refresh was in progress, already uses the same EIA
  AEO2025 study: $3,689/kW and $154/kW-year for its 900 MW fixed-bottom reference plant.
- Solar: $20.23/kW-year fixed O&M, 36-month reference lead time, and 35-year life.
- Hydro: $33.54/kW-year fixed O&M, 72-month reference lead time, a 40% target capacity factor
  (`HYDRO_TARGET_CAPACITY_FACTOR`, used for sizing, the quote and LCOE; IRENA's global fleet
  average is nearer 48%, but individual sites are sized against their own river), and 50-year life.
- Conventional geothermal: $150.60/kW-year fixed O&M, 36-month lead time, 88% global capacity
  factor, and 40-year life.

Battery storage is now a four-hour device (`peakW = peakWh / 4`), the representative utility-scale
duration used by both NREL and EIA. It has a 20-year / 7,300-cycle life, an 18-month reference lead
time, and $10/kWh-year O&M including augmentation for degradation. Round-trip efficiency remains
85%.

Pumped hydro remains a ten-hour, 80%-efficient device. Its cost is updated to $3,319/kW (the
midpoint of NREL's $2,205-$4,434/kW closed-loop site range), equivalent to $332/kWh at ten hours.
Fixed O&M becomes $19/kW-year. NREL projects no cost or efficiency improvement for this mature
technology.

## Finite project locations

Conventional hydro, conventional geothermal, and pumped hydro now expose and enforce a count of
viable locations. A project claims its location as soon as construction begins; cancelling or
selling removes the project from the fleet and makes the location available again. Enhanced
geothermal is deliberately not limited because its purpose in the model is to open resources that
conventional hydrothermal geography cannot.

Pumped hydro has its own location inventory rather than inheriting conventional hydro's river
profile. The facility is modeled as closed-loop storage, so elevation separation and room for two
reservoirs matter more than river flow:

- For U.S. cities, counts are the optimized, non-overlapping 10-hour systems in NREL's 2022
  national closed-loop resource assessment whose reservoir-pair midpoint is within 250 km of the
  city. The assessment starts with 30-meter terrain data, removes protected land, critical habitat,
  urban areas, wetlands, existing waterways and water bodies, then pairs reservoirs and selects a
  least-cost non-overlapping set. It reports 14,846 technical-potential systems nationwide.
- For London, Paris, Berlin, and Reykjavik, counts are the site points in ANU's unprotected global
  greenfield 2 GWh / 6 hour layer within the same 250 km radius. That is the atlas class closest to
  the game's utility-scale project. ANU requires at least 100 m of head, a slope of at least 1:20,
  a reservoir volume of at least 1 GL, and a water-to-rock ratio of at least 3.
- The radius is a game boundary: each city represents a regional utility, not a municipal service
  polygon. The source studies describe technical potential, not construction-ready projects. Both
  explicitly warn that individual sites still need geological, environmental, ownership,
  transmission, and commercial review.

Conventional hydro and geothermal do not yet have equivalent site-by-site global data in the game.
Their former scarcity curves implied a three-site hydro and four-site geothermal scale; those are
now explicit gameplay caps. The old linear price increases have been removed. A hard count already
models scarcity, while a generic multiplier charged the same penalty regardless of plant size or
actual site quality. If site-quality decline is added later, it should use source cost ranks or a
regional supply curve—especially for pumped hydro, whose assessed site costs span widely—rather
than restore the artificial per-project multiplier.

## Lifetimes and depreciation

Facility resale value now follows straight-line physical depreciation from commercial operation:
`build cost × max(0, 1 - operating age / lifespan)`. Construction time is not asset age. Cancelling
construction returns the cash-funded portion of the purchase and closes any construction loan;
selling an operating facility returns its depreciated gross value after settling the remaining
loan. A fully depreciated asset may still operate, but has no resale value.

These are technology-specific operating lives, not tax schedules. Tax depreciation (for example,
five-year MACRS for several renewable technologies) is an accounting convention and would make a
poor proxy for the physical value the player can sell:

| Facility            |     Life | Basis                                                            |
| ------------------- | -------: | ---------------------------------------------------------------- |
| Coal                | 40 years | EIA AEO2025 standardized plant operating life                    |
| Nuclear             | 40 years | EIA AEO2025 new-build economic operating life                    |
| Natural gas peaker  | 40 years | EIA AEO2025 H-class simple-cycle operating life                  |
| Natural gas CC      | 40 years | EIA AEO2025 H-class 2x2x1 combined-cycle operating life          |
| Oil                 | 30 years | NREL technology-comparison economic life for combustion turbines |
| Onshore wind        | 25 years | EIA AEO2025 large-plant operating life                           |
| Offshore wind       | 25 years | EIA AEO2025 fixed-bottom operating life                          |
| Solar PV            | 35 years | EIA AEO2025 single-axis PV operating life                        |
| Hydropower          | 50 years | EIA AEO2025 reference operating life                             |
| Geothermal          | 40 years | EIA AEO2025 dual-flash operating life                            |
| Enhanced geothermal | 30 years | NREL EGS resource and plant-life assumption                      |
| Lithium-ion battery | 20 years | EIA AEO2025 7,300-cycle service life                             |
| Pumped hydro        | 75 years | Midpoint of DOE's typical 65-85 year hydropower range            |

The EIA study is the most internally consistent current primary source because it specifies life,
lead time, plant configuration, and cost together. DOE/NREL sources fill the technologies it does
not distinguish. Actual plants can outlive these economic lives after refurbishment—DOE notes
65-85 years as typical for hydropower, and the NRC can license nuclear units out to 80 years—but
the game needs one reference life for predictable resale rather than trying to price future major
overhauls.

## Operating age and performance degradation

The simulation now distinguishes three aging effects that were previously easy to conflate:

1. **Asset age and value.** Every operating facility has a commissioning minute and an economic
   design life. Age already reduced resale value linearly; scenario authors can now set
   `initialAgeYears` for inherited fleets, and the facility detail panel shows age against design
   life. Reaching design life does not automatically close a plant.
2. **Renewable output.** Solar output compounds down by 0.5% per operating year. Onshore wind uses
   0.5% for pre-2008 vintages and 0.2% for newer vintages, rounded from the 0.53% and 0.17% annual
   performance declines measured across 917 U.S. plants. Offshore wind remains unchanged because
   the evidence is less settled and its model already applies an explicit availability/loss factor.
3. **Battery use.** Battery capacity remains constant. Its existing $10/kWh-year O&M assumption
   includes augmentation for roughly 1.5% annual capacity loss, so reducing usable capacity as well
   would charge for degradation twice. The facility panel instead reports equivalent full cycles
   as cumulative discharged energy divided by original energy capacity, against the existing
   7,300-cycle design-life assumption.

At 0.5% annual degradation, solar retains `0.995^20 = 90.5%` of its original output after 20
years—about a 9.5% loss, not 20%. Weather and curtailment still vary actual production around that
aged maximum. The build screen's lifetime cost integrates the same compounding output curve. Fixed
annual O&M does not fall with output but escalates with inflation from purchase; Oil variable O&M, fuel, and carbon costs scale only with energy actually
produced.

Scenario starting ages are deliberately authored rather than inferred from technology or scenario
year. The narrative scenarios now begin with mixed-age inherited fleets; tutorials keep new assets
so their introductory economics and controls remain predictable.

The facility panel now reports equivalent operating hours for generators. It also reports
equivalent starts for both gas plants, Coal, Nuclear, Biomass, Geothermal, and Enhanced Geothermal.
A real zero-to-generating edge represents `365 / 12` starts because the visible day stands for the
average day in its month; ramping while already above zero does not add another start. Oil remains
an internal-combustion-generator benchmark whose use-driven maintenance follows generated MWh, and
Hydro is not thermal, so neither is included.

Start tracking and start charges are deliberately separate capabilities:

| Facility            | Tracks starts | Non-fuel start charge                              | Basis                                                                                   |
| ------------------- | ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Natural Gas Peaker  | Yes           | EIA's $23,100 per start at 419 MW, size-normalized | H-class simple-cycle reference                                                          |
| Natural Gas CC      | Yes           | $47.41/MW-start in 2023$, size-normalized          | NREL combined-cycle hot-start cycling cost; EIA's maintenance is in variable O&M        |
| Coal                | Yes           | $81.0185278/MW-start in 2023$, size-normalized     | NREL supercritical hot-start cycling plus startup operations                            |
| Nuclear             | Yes           | None                                               | IAEA finds shutdown/startup cycling consequential but unit-specific                     |
| Biomass             | Yes           | None                                               | EIA documents diesel startup burners but no transferable quantity or wear cost          |
| Geothermal          | Yes           | None                                               | Published lifetime FOM already annualizes overhaul and maintenance                      |
| Enhanced Geothermal | Yes           | None                                               | Same FOM treatment, without commercial start-cost observations                          |
| Oil                 | No            | None                                               | Reciprocating-engine service follows use; starts do not change its maintenance schedule |

Thermal generators also carry a minimum stable output. These technology-level values are
representative production-cost inputs rather than limits for every individual unit:

| Facility            | Minimum stable output | Basis                                                                                   |
| ------------------- | --------------------: | --------------------------------------------------------------------------------------- |
| Coal                |                   40% | GE Energy/HNEI ancillary-services study: 35-40% typical turndown level                  |
| Nuclear             |                   50% | NREL production-cost modeling; individual IAEA load-following examples can reach 20-30% |
| Natural Gas Peaker  |                   50% | Representative heavy-duty simple-cycle value within the published 15-70% range          |
| Natural Gas CC      |                   45% | NREL: emissions limits often keep combined cycles from following load below 50%         |
| Oil                 |                   50% | GE Energy/HNEI reciprocating-engine value                                               |
| Biomass             |                   40% | GE Energy/HNEI ancillary-services study: 35-40%                                         |
| Geothermal          |                   15% | GE Energy/HNEI ancillary-services study: 12-15%                                         |
| Enhanced Geothermal |                   15% | Same thermally stable turndown assumption pending commercial fleet data                 |

The dispatcher first forecasts the unconstrained merit-order request for each facility. When an
online plant is no longer requested, it scans that facility's upcoming requests and accumulates
the fuel, carbon, and variable O&M cost of remaining at minimum output. It stays online only when
it is needed again before those costs reach the next-start charge. The scan aborts immediately
once shutdown is cheaper; if the plant is not needed again inside the forecast, it shuts down.
Fixed O&M is omitted because the company pays it in either state. Startup fuel, hot/warm/cold
state, minimum up/down times, and part-load heat-rate penalties remain outside this model.

Coal uses NREL's conservative hot-start values for 500-1,300 MW supercritical units: $54/MW-start
of capitalized cycling and maintenance plus $5.81/MW-start of auxiliary operations, chemicals,
water, and additives. Converting 2011 dollars with CPI-U (`304.702 / 224.939`) gives
$81.0185278/MW-start in 2023 dollars, or $52,662.04 for the game's 650 MW reference plant before
difficulty and game inflation. The resulting cost is quoted when the facility is created and then escalates with game
inflation, like every other non-fuel operating cost. Startup fuel, emissions, EFOR effects, and hot/warm/cold state are not modeled.

The combined cycle uses the same study's lower-bound median hot start for a gas combined cycle
(gas turbine, heat-recovery steam generator and steam turbine): $35/MW-start of capital and
maintenance cost in 2011 dollars, or $47.41/MW-start in 2023 dollars ($58,173 for the 1,227 MW
reference plant). The study reports no other-start cost for combined cycles, and EIA already
counts the plant's routine turbine maintenance in variable O&M, so nothing else is added.
[NREL/SR-5500-55433, Table 1-1](https://www.osti.gov/servlets/purl/1046269).

## Default dispatch order

Every scenario starts with solar and wind (including offshore and airborne wind) ahead of
dispatchable generators, so their output reduces the demand those generators must cover. This
also applies to tutorials and custom games. Other starting generators retain their relative
order, including reservoir hydro, whose water can be conserved by dispatching it later.

The facility list is the dispatch order. A newly bought generator used to go to the top, so an
expensive peaker ran as baseload until the player moved it. Now a new Natural Gas Peaker joins
just above the existing peakers and storage, below every other generator; every other new
generator still goes to the top, and storage to the bottom. The rule reads the plant's
`gasCycle`, not its display name, and never reorders what the player has arranged. Oil is not
treated as a peaker because the game's oil plant also stands in for island oil-fired baseload.

Natural Gas Peaker alone shows the 900-start hot-gas-path and 1,800-start major-inspection context. Those
intervals do not trigger a second refurbishment bill: EIA's per-start value is already the
levelized major-maintenance cost. Maintenance decisions and wear-driven outage risk remain separate
future work.

## Commercial technology review

Natural gas is now two facilities, Natural Gas Peaker and Natural Gas CC, because the one gas
plant mixed a simple-cycle turbine's cost, heat rate and start time with an all-gas capacity
factor and a combined cycle's 6 GW size. Both keep the "Natural Gas" fuel, so fuel prices, cold
snaps and their cold-weather package, story effects and the supply charts treat them alike; their
`gasCycle` field names the technology. A simple-to-combined conversion (adding a heat-recovery
steam generator to an existing peaker) is left for later, as an upgrade that changes
`gasCycle` in place. No other facility type is added in this pass:

- Solar-plus-storage is commercially routine, but players can already construct the two facilities
  independently; a combined entry would duplicate their capabilities.
- DOE still describes non-lithium long-duration storage programs as pilots and demonstrations
  intended to establish commercial viability. Adding flow, thermal, compressed-air, or hydrogen
  storage as a generic mature option would overstate the present market.
- Small modular reactors do not yet have the broad commercial deployment needed for a distinct
  generic facility, and the existing Nuclear facility already covers firm fission generation.
- Enhanced geothermal already has a separate forward-looking facility and cost curve.
- Fixed-bottom offshore wind is already represented by the separately researched Offshore Wind
  facility, so it is retained rather than duplicated here.

## Money vintages, fuel prices and retail rates

Everything a run pays or earns is in the same nominal dollars:

- **Capital and O&M tables** are 2023 dollars. A run starting before 2023 deflates them into its
  starting year's dollars with recorded annual CPI-U (`getCostTableDeflator`), then the game's
  inflation index carries them forward. A 1980 start pays 27% of the table value, a 2006 start
  66%; 2023 and later starts pay the table.
- **Fuel** is the monthly U.S. cost delivered to electric generating plants (EIA Monthly Energy
  Review Table 9.9) for coal, natural gas and, from 2001, distillate oil. Pre-2001 oil is the
  earlier imported-crude record times the measured 1.415 distillate/crude ratio. Uranium is
  reactor fuel (ore at ~177 MMBtu per lb U3O8 plus $0.40/MMBtu of conversion, enrichment and
  fabrication), about $6.6/MWh in 2019. Regional multipliers in `LocationProfiles.tsx` are
  ratios to this U.S. delivered series.
- **Opening retail rates** for U.S. scenarios are 60% of the EIA average retail price for that
  state and year (all sectors, `avgprice_annual.xlsx`), falling back to the national MER Table 9.8
  value scaled by the state's 1990 ratio. The game carries no distribution network costs, so the
  rate is the generation-plus-transmission share: EIA's energy-only providers charged 59% of full
  retail nationally in 2020. Tutorials keep their authored teaching rates, and non-U.S. scenarios
  keep their researched local rates. The two researched U.S. public utilities (Data Center Boom,
  Deep Freeze) also keep their utilities' own average tariffs for now, because their demand,
  fleets and choice balance are calibrated to them; moving them to the generation share needs its
  own rebalance of those calibrations.

## Simulation and teaching boundaries

Purchase reviews lead with down payment, monthly payment and estimated upkeep; detailed plant
operation and loan terms are optional. Starts, ramps, water releases and underwriting remain
automatic. Loan payments begin during construction, and a build loan runs 30 years or 80% of the asset's life, whichever is shorter (16 years for a battery, 20 for wind). LCOE annualizes capital with a capital recovery factor at the company's borrowing rate (7% before a rate exists) and holds quoted
fuel-price assumptions; neither it nor the five-year fixed-use economic comparison guarantees
future costs. Site counts are projects available in this game, not a site survey. Displayed
accounting life controls depreciation and estimates, not automatic retirement.

The local emissions boundary is operating combustion CO2: bituminous coal 93.24, natural gas 52.91,
and distillate oil 74.14 kg/MMBtu; biomass uses 195 lb/MMBtu including biogenic combustion without
regrowth credit. Geothermal assumes binary generation with no venting for emissions even though
some cost/lifetime references describe dual-flash technology. This is a coarse technology model,
not a harmonized plant engineering specification. Imported electricity uses separately sourced
fixed generation proxies in `ImportEmissions.ts` (mostly CO2; Québec reports GHG CO2e). Both local
and imported amounts affect score, while carbon fees charge only local fossil generation: biogenic biomass CO2 counts towards the score but, as under EU ETS, RGGI, UK ETS and Canada's carbon pricing, pays no fee. Construction,
upstream supply chains and land-use emissions are omitted; zero operating emissions is not zero
lifecycle impact.

## Weather hazards

Hail can break solar modules and extreme cold can take gas plants offline (issue #73). Profiles
and balance constants live in `src/data/Hazards.tsx`; the pure model is `src/helpers/Hazards.tsx`.
All values are rounded game balance, not a site-specific risk assessment.

- **Hail exposure.** Each location carries an expected number of damaging hailstorms per year at a
  utility PV site, ranked from NOAA SPC's 1986-2015 severe-hail report climatology in North
  America, the ESSL European Severe Weather Database in Europe, and NASA passive-microwave hail
  climatologies (Cecil & Blankenship 2012; Bang & Cecil 2019) elsewhere. Unprofiled locations fall
  back by latitude band. The busiest hail regions are capped at 0.06 storms per year, so about
  nine 20-year runs in ten see at most two damaging storms even there, and most low-risk places
  see none. A storm hits each array with 70% probability and breaks at most 60% of it;
  hail-resistant designs break 30% as much.
- **Repairs.** The company pays the full repair cost once: the damaged share of the array's
  replacement value (its build cost carried forward by inflation).
- **Extreme cold.** Each month's representative-day minimum is compared with each gas plant's
  design minimum (-8 °C standard) and with the region's gas-supply threshold, following the
  FERC-NERC report on the February 2021 cold-weather outages. Cold is judged against each city's
  own weather record (`src/data/ColdClimate.tsx`, derived from 1980-2024 representative days): a
  place is a cold climate when the standard rating is breached in about one winter in four, and
  its gas quotes include a cold-weather package by default. Regional supply strains below the
  colder of -15 °C (mild climates) or -25 °C (cold climates) and the place's one-winter-in-twelve
  low, so a regional gas shock stays rare everywhere. A package rates a plant 5 °C below the
  regional threshold, and at least to -25 °C. It is only offered, at build or as a retrofit,
  where the one-winter-in-twelve low reaches the standard -8 °C rating (or, without a weather
  record, outside the lowland tropics and subtropics); elsewhere it could never help. A cold snap's gas-price multiple is capped so that,
  combined with any authored gas shock that month, prices reach at most 3× normal.
- **Hardening prices.** Hail-resistant panels add 3% to a solar build, after DOE FEMP's solar
  hail-resilience guidance; a cold-weather package adds 2% to a gas build.
- **Retrofits.** Either can be added to a standing plant for 1.5× its build share, charged on the
  plant's replacement value (4.5% and 3%). The plant is offline for one game month while the work
  is done, and the player can cancel before then for a full refund and immediate return to service.
- **Solar trackers.** A build-only option for solar, modelled on Nextpower (formerly Nextracker),
  the largest single-axis tracker supplier. It is available from 2014, when the self-powered NX
  Horizon tracker began shipping, and priced at 7% of the build: Nextpower's FY2025 revenue was
  about $0.09 per watt delivered ($2.96B for 34 GW, Form 10-K), against roughly $1.25/W for
  utility PV (LBNL Utility-Scale Solar). Tracking adds about 20% of annual energy over fixed tilt
  (LBNL, NREL PVWatts), almost all of it in the morning and evening. The game scales output by
  `1 + 0.6 sin²(hour angle)`, which is unchanged at noon and averages +20% over a clear day, still
  clipped at nameplate. Trackers stow steeply ahead of hail: arrays bought before 2024 take half
  the damage, and those bought from 2024 take a quarter, after NX Horizon Hail Pro-75's 75° stow
  and VDE Americas' stow-angle findings. The share multiplies with hail-resistant panels.

## Primary references

- [EIA, Capital Cost and Performance Characteristics for Utility-Scale Electric Power Generating Technologies, AEO2025](https://www.eia.gov/analysis/studies/powerplants/capitalcost/pdf/capital_cost_AEO2025.pdf)
- [EIA, 2020 edition of the same standardized study](https://www.eia.gov/analysis/studies/powerplants/capitalcost/archive/2020/pdf/capital_cost_AEO2020.pdf)
- [EIA, construction costs for generators installed in 2023](https://www.eia.gov/electricity/generatorcosts/)
- [EIA, Distributed Generation and Combined Heat & Power System Characteristics and Costs in the Buildings Sector](https://www.eia.gov/analysis/studies/buildings/distrigen/pdf/dg_chp.pdf)
- [Wärtsilä, Combustion Engine Power Plants](https://www.wartsila.com/docs/default-source/power-plants-documents/downloads/white-papers/general/wartsila-bwp-combustion-engine-power-plants.pdf)
- [IRENA, Renewable Power Generation Costs in 2024](https://www.irena.org/Publications/2025/Jun/Renewable-Power-Generation-Costs-in-2024)
- [IRENA, Renewable Power Generation Costs in 2020](https://www.irena.org/Publications/2021/Jun/Renewable-Power-Costs-in-2020)
- [NREL, Cost Projections for Utility-Scale Battery Storage: 2021 Update](https://docs.nrel.gov/docs/fy21osti/79236.pdf)
- [NREL, 2024 Annual Technology Baseline: Pumped Storage Hydropower](https://atb.nrel.gov/electricity/2024b/pumped_storage_hydropower)
- [NREL, Closed-Loop Pumped Storage Hydropower Resource Assessment for the United States](https://www.nrel.gov/docs/fy22osti/81277.pdf)
- [NREL/OEDI, U.S. closed-loop pumped-storage site dataset](https://data.openei.org/submissions/5711)
- [ANU, Global Greenfield Pumped Hydro Energy Storage Atlas](https://re100.eng.anu.edu.au/global/)
- [NREL, Cost and Performance Data for Power Generation Technologies](https://docs.nrel.gov/docs/fy11osti/48595.pdf)
- [NREL, Update to Enhanced Geothermal System Resource Potential Estimate](https://docs.nrel.gov/docs/fy17osti/66428.pdf)
- [DOE, Hydropower Basics](https://www.energy.gov/cmei/water/hydropower-basics)
- [EIA, age and license extensions of U.S. nuclear plants](https://www.eia.gov/tools/faqs/faq.php?id=228&t=1)
- [NREL 2024 ATB, utility-scale PV degradation assumptions](https://atb.nrel.gov/electricity/2024/utility-scale_pv)
- [Lawrence Berkeley National Laboratory, U.S. wind-plant performance with age](https://emp.lbl.gov/publications/how-does-wind-project-performance)
- [BLS, annual CPI-U indexes](https://www.bls.gov/regions/mid-atlantic/data/ConsumerPriceIndexAnnualandSemiAnnual_Table.htm)
- [NREL, Power Plant Cycling Costs](https://docs.nrel.gov/docs/fy12osti/55433.pdf)
- [GE Energy/HNEI, Ancillary Services Definitions and Capability Study](https://www.hnei.hawaii.edu/wp-content/uploads/Ancillary-Services-Definitions-and-Capability-Study.pdf)
- [NREL, Operational Analysis of the Eastern Interconnection at Very High Renewable Penetrations](https://docs.nrel.gov/docs/fy18osti/71465.pdf)
- [IAEA, Non-baseload Operation in Nuclear Power Plants](https://www-pub.iaea.org/MTCD/Publications/PDF/P1756_web.pdf)
- [NREL 2024 ATB, Geothermal](https://atb.nrel.gov/electricity/2024/geothermal)
- [DOE, Geothermal Basics](https://www.energy.gov/hgeo/geothermal/geothermal-basics)
- [DOE, Long-Duration Energy Storage portfolio](https://www.energy.gov/cmei/oced/long-duration-energy-storage)
- [EIA, Electric Power Monthly Table 6.07.A, capacity factors for utility-scale generators primarily using fossil fuels](https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_6_07_a)

## Conventional Hydro site inventories

Capacity ceilings, provenance, coverage gaps, deterministic allocation and scenario exceptions are documented in [Hydro sites](hydro-sites.md).

## Peaker conversion gameplay assumptions

Existing simple-cycle gas plants can convert from 1990 onward. The conversion
retains nameplate capacity, remaining life, debt, weather hardening, dispatch
position and lifetime accounting. It costs half the current same-capacity CC
build quote, including difficulty, historical dollars, inflation and story
cost modifiers, paid in cash. Six months offline and the 50% cost share are
explicit game-design assumptions, not sourced engineering estimates. Plants
with six months or less of remaining design life are ineligible.

Completion applies the existing EIA-based CC heat rate, ramp/start time,
minimum output, fixed and variable O&M, start cost and capacity factor. Costs
are translated back to the asset's original cost-index basis so subsequent
inflation is applied exactly once. Cancellation before completion refunds
payment and removes the investment decision. The shared retrofit replay and
save paths preserve both the outage and completion.
