# Local terrain modifiers

Scenario 116 and custom packages based on scenario 116 share regional weather, with
seven non-neutral local settings. These are **rounded gameplay assumptions for
suitable developed parcels**, not measured universal terrain averages. The primary
sources support the mechanisms and plausible scale, but do not establish the
chosen whole-project percentages.

- Plains: ordinary regional wind and construction cost.
- Forest: fixed onshore Wind uses **0.95 × regional wind speed**; new projects use **1.05 × construction cost**.
- Hills: fixed onshore Wind uses **1.10 × wind speed**; new projects use **1.10 × construction cost**.
- Mountain: fixed onshore Wind uses **1.15 × wind speed**; new projects use **1.20 × construction cost** and take **1.50 × as long to build**.
- River and lake: ordinary resource and cost inputs, with existing named hydro
  sites, head/flow, capacity and resource restrictions.
- Offshore Wind requires an actual ocean site. The authored inland water is a
  lake, and the current generated frontier has no ocean cells. Pre-schema-18
  offshore installations retain their existing turbine curve and weather inputs:
  offshore wind where available, otherwise shared regional wind. A measured zero
  remains zero. Their installation exception ends when the plant is sold.

The hill/mountain cells represent selected exposed, accessible ridges, passes or
benches. Sheltered slopes and inaccessible cliffs are not implied viable sites.
Forest solar construction includes clearing and access; a completed utility array
has no permanent artificial irradiance penalty.

## Evidence and calibration

[EIA's wind siting explanation](https://www.eia.gov/energyexplained/wind/where-wind-power-is-harnessed.php)
identifies exposed rounded hills, plains, water and mountain gaps as promising
locations. The [Hawaii DBEDT / AWS Truewind mapping report (2004), pp. 11–12](https://files.hawaii.gov/dbedt/op/gis/data/hawaii_wind_mapping_report.pdf)
describes residual terrain and surface-roughness corrections. Its approximate
0.5 m/s per 100 m correction applies only to small isolated hills/ridges in flatter
surroundings, while its illustrative roughness/displacement change yields a
0.90 speed ratio at 50 m. The game's +10%/+15% exposed-site assumptions and smaller
−5% forest residual are deliberately restrained abstractions over an existing
height-and-siting reference; they are not survey means for these terrain labels.

[EPA's site feasibility guidance](https://www.epa.gov/re-powering/site-conditions-and-feasibility)
connects terrain, grading, leveling and shading mitigation with project cost and
timing. [DOE/BLM's 2024 draft solar EIS, Chapter 3](https://www.energy.gov/sites/default/files/2024-03/blm-draft-eis-0557-eval-utility-scale-solar-energy-planning-vol-1-01-2024.pdf)
describes access, clearing and sometimes grading for utility solar development.
[NREL's 2019 tower-height study](https://docs.nrel.gov/docs/fy19osti/73629.pdf)
notes additional complex-terrain crane work excluded from its flat-terrain cost
model. These justify the direction of incremental clearing, access, grading and
foundation costs; **5%, 10% and 20% are authored game defaults**, not NREL or EPA
whole-project cost estimates.

[NREL's offshore ATB](https://atb.nrel.gov/electricity/2024b/offshore_wind) already
accounts for marine siting and technology differences. Applying another ocean
wind-speed or build-cost bonus would duplicate the existing offshore model.
[EIA's hydropower explanation](https://www.eia.gov/energyexplained/hydropower/)
relates output to head and flow: a river/lake picture cannot invent another named
hydro site or a pumped-storage reservoir pair.

## Owning APIs and scope

`getTerrainModifiers` in `src/helpers/TerrainModifiers.ts` owns the wind speed, construction cost and construction time
multipliers. `getTerrainWindOutputFactor` applies local wind speed **before** the
existing curve and its 1.75 city-to-farm reference. It never scales generated watts
or mutates weather shared by other parcels. Speed changes therefore affect cut-in,
rated clipping and storm cut-out; a 10% speed increase is not a fixed 10% energy
increase. Live dispatch, reducer forecasts and expected-output charts share this
owner. Authored technology capacity-factor overrides retain precedence in charts.

`GENERATORS` accepts an optional eighth `tileId`, resolves the selected or first
compatible free tile, and applies the construction multipliers once before build
options and LCOE. `STORAGE` applies the same multipliers to a selected tile. `getBuildFacilityQuote` regenerates catalog economics from
technology, size, current game state and options. Local purchases and multiplayer
hosts use that canonical quote, so stale or edited client prices cannot alter the
cash debit or loan. Build-impact previews reprice the same way while retaining
explicit preview-only duration overrides. Selected hydro cells also scope the
existing named-site availability API.

Cost multipliers apply to new generator and storage projects on buildable land.
Existing facilities retain their purchase costs and financing. Land prices, city
demand, fuel, and operating costs use their own inputs. Terrain does not change pooled
company dispatch or introduce transmission tariffs or upkeep. Separate
[terrain siting allowances](territories.md) bound new facility and expansion
capacity; these construction-cost multipliers do not change those allowances.
Missing placement and other scenarios remain neutral. No new weather files or
random streams are introduced.

## Verification contract

Focused suites cover the seven-terrain matrix, pre-curve cut-in/rated/cut-out
boundaries, quote capacity factors and LCOE, exact once-only cash/debt charges,
solar tracker add-ons, compatibility fallback, insufficient-cash atomic rejection,
live/simulated/estimated-weather wind, demand preservation, retained inland
offshore output and rejection of new lake builds, hydro/geothermal eligibility, inherited pricing, legacy neutrality and
custom base-116 packages. Multiplayer tests submit edited costs/timings and check
the canonical purchased asset. Expected-output tests retain authored override
precedence. The integrating task owns the full simulation and CI gates.
Temporary mutations confirmed that applying speed after the curve fails the
cut-in assertion and trusting a client-supplied price fails both cash and financed
purchase assertions; both mutations were removed before verification.
