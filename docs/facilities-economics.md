# Facility economics refresh

Last reviewed: 2026-08-28. The implemented latest observations are 2023 for EIA's engineering
estimates and 2024 for IRENA's global deployment data.

## Method

The previous model mixed figures from several dollar years. This refresh separates two effects:

1. Published observations are converted to the newer report's dollars with annual-average U.S.
   CPI-U (2019: 255.657; 2020: 258.811; 2023: 304.702; 2024: 313.689).
2. The remaining change is treated as a real technology-cost trend. The game's own inflation
   multiplier is still applied later, so inflation is not counted twice.

Capital costs use exponential interpolation between observations. Costs are held at the first
observation before the comparison window and at the latest observation afterward, except for wind
and solar: IRENA publishes five-year outlook values for those technologies, so they continue to
those values through 2029 and then stop. Pre-2020 wind and solar retain the game's historical
learning curves, re-anchored to the inflation-normalized 2020 observation.

Published costs are for reference projects, while the player can choose almost any plant size. The
model therefore treats 25% of the reference project as fixed and 75% as capacity-proportional. This
preserves the existing economies-of-scale mechanic and makes every reference-sized facility equal
the cited total installed cost.

## What changed in real terms

| Facility                  | Older observation in latest-year dollars | Latest observation |        Real change | Model source                                         |
| ------------------------- | ---------------------------------------: | -----------------: | -----------------: | ---------------------------------------------------- |
| Coal                      |                         $4,381/kW (2019) |   $4,103/kW (2023) |              -6.3% | EIA standardized reference plant                     |
| Nuclear                   |                         $7,200/kW (2019) |   $7,861/kW (2023) |              +9.2% | EIA standardized reference plant                     |
| Natural gas, simple cycle |                           $850/kW (2019) |     $836/kW (2023) |              -1.6% | EIA standardized reference plant                     |
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

The simulation has one annual non-fuel O&M field, while EIA reports fixed O&M in $/kW-year and
variable O&M in $/MWh. For generators, variable O&M is converted to an annual amount at the
facility's modeled capacity factor and added to fixed O&M. Actual fuel and carbon expenses remain
separate.

The EIA AEO2025 reference designs also update:

- Coal: 8,638 Btu/kWh, 60-month reference lead time, and 40-year operating life.
- Nuclear: 10,608 Btu/kWh, 84-month reference lead time, and 40-year economic life.
- Natural gas: the H-class simple-cycle design matches the facility's fast-start role: 9,142
  Btu/kWh, a 40-month lead time, and a 40-year life.
- Onshore wind: $33.06/kW-year fixed O&M, 21-month reference lead time, and 25-year life.
- Offshore wind, added on `master` while this refresh was in progress, already uses the same EIA
  AEO2025 study: $3,689/kW and $154/kW-year for its 900 MW fixed-bottom reference plant.
- Solar: $20.23/kW-year fixed O&M, 36-month reference lead time, and 35-year life.
- Hydro: $33.54/kW-year fixed O&M, 72-month reference lead time, 48% global capacity factor, and
  50-year life.
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
| Natural gas         | 40 years | EIA AEO2025 H-class simple-cycle operating life                  |
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

## Commercial technology review

No additional facility type is added in this pass:

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

## Primary references

- [EIA, Capital Cost and Performance Characteristics for Utility-Scale Electric Power Generating Technologies, AEO2025](https://www.eia.gov/analysis/studies/powerplants/capitalcost/pdf/capital_cost_AEO2025.pdf)
- [EIA, 2020 edition of the same standardized study](https://www.eia.gov/analysis/studies/powerplants/capitalcost/archive/2020/pdf/capital_cost_AEO2020.pdf)
- [EIA, construction costs for generators installed in 2023](https://www.eia.gov/electricity/generatorcosts/)
- [IRENA, Renewable Power Generation Costs in 2024](https://www.irena.org/Publications/2025/Jun/Renewable-Power-Generation-Costs-in-2024)
- [IRENA, Renewable Power Generation Costs in 2020](https://www.irena.org/Publications/2021/Jun/Renewable-Power-Costs-in-2020)
- [NREL, Cost Projections for Utility-Scale Battery Storage: 2021 Update](https://docs.nrel.gov/docs/fy21osti/79236.pdf)
- [NREL, 2024 Annual Technology Baseline: Pumped Storage Hydropower](https://atb.nrel.gov/electricity/2024b/pumped_storage_hydropower)
- [NREL, Cost and Performance Data for Power Generation Technologies](https://docs.nrel.gov/docs/fy11osti/48595.pdf)
- [NREL, Update to Enhanced Geothermal System Resource Potential Estimate](https://docs.nrel.gov/docs/fy17osti/66428.pdf)
- [DOE, Hydropower Basics](https://www.energy.gov/cmei/water/hydropower-basics)
- [EIA, age and license extensions of U.S. nuclear plants](https://www.eia.gov/tools/faqs/faq.php?id=228&t=1)
- [BLS, annual CPI-U indexes](https://www.bls.gov/regions/mid-atlantic/data/ConsumerPriceIndexAnnualandSemiAnnual_Table.htm)
- [DOE, Long-Duration Energy Storage portfolio](https://www.energy.gov/cmei/oced/long-duration-energy-storage)
