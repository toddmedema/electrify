# Data-center starting power sources

The dedicated data-center setup uses measured **generating capacity shares**, not
the old latitude/region coefficients. `src/data/DataCenterPowerCapacity.json` is
a bounded extract of public source data, downloaded September 30, 2026. Its
numbers are MW. `getDataCenterPowerMix` normalizes each geography/year's values
into fractions for the scenario builder.

## Sources and coverage

- **US states:** [EIA State Electricity Profiles, 2024](https://www.eia.gov/electricity/state/),
  Table 4A (net summer capacity by primary energy source, Form EIA-860). All 28
  states in the current weather catalogue are covered. Table 19 adds small-scale
  solar capacity from 2014 onward; it is unavailable in this source for earlier
  years. For example, [California's original workbook](https://www.eia.gov/electricity/state/xls/SEP%20Tables%20for%20CA.xlsx)
  reports 2024 gas capacity of 36,329.1 MW; utility-scale plus small-scale solar is
  40,492.2 MW.
- **Other countries and Puerto Rico:** [Ember Yearly Electricity Data](https://ember-energy.org/data/yearly-electricity-data/),
  `Capacity / Fuel / GW` rows from the [public CSV](https://files.ember-energy.org/public-downloads/yearly_full_release_long_format.csv).
  Ember combines IRENA and Global Energy Monitor capacity data, with details and
  country-specific limitations in its [methodology](https://files.ember-energy.org/public-downloads/ember_electricity_data_methodology.pdf).
  Attribution: Ember, Yearly Electricity Data, CC BY 4.0. Values are converted from
  GW to MW. All current catalogue countries are covered; the snapshot includes
  108 country/territory/aggregate records, including World.
- **Geothermal supplement:** The retrieved Ember capacity release reports zero
  Other Renewables in Iceland and Kenya despite their geothermal capacity. We use the
  independently reported geothermal column from IRENA's
  [2025 capacity statistics, printed page 45](https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2025/Mar/IRENA_DAT_RE_Capacity_Statistics_2025.pdf)
  for 2015–2024 and [2020 statistics, printed page 42](https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2020/Mar/IRENA_RE_Capacity_Statistics_2020.pdf)
  for 2010–2014. This applies to all listed countries present in our catalogue,
  plus World; state EIA records already contain geothermal and are unchanged.
  Examples: Iceland 788 MW and Kenya 940 MW in 2024. These are IRENA's rounded
  observations/estimates. Ember's methodology does not establish that its capacity
  Other Renewables universally excludes geothermal. To avoid possible double-counting,
  the helper retains IRENA geothermal and sets unclassified capacity to
  `max(0, Ember Other Renewables - IRENA geothermal)`. This conservative reconciliation
  is an explicit modeling assumption, not a measured residual technology breakdown.
  The JSON preserves both original source values; `reconciledGeothermal` identifies
  locations where both categories were positive. Iceland and Kenya have no overlap.

Annual observations span 2010–2024. A starting year uses the most recent
available observation at or before that year. Future starts retain the latest
observation, **not a forecast**. Ukraine's latest capacity record in this extract
is 2022. Unknown countries use the measured World mix and are labeled World,
rather than receiving an invented local portfolio.

## What this does and does not represent

These are state/national fleets, not a utility's contracted energy supply,
imports, or an inventory of plants inside municipal borders. Accounts may refer
to a particular utility service territory while this fleet represents its wider
region. Capacity shares are not annual generation shares: wind, solar and
thermal plants produce different amounts of electricity per MW.

The scenario starts with these shares and sizes facilities both down and up to
serve background demand with a 5% opening-year model allowance. The selected new
campus is excluded from calibration. See [demand calibration](data-center-calibration.md).
Hydro is restricted to researched playable
sites and their physical capacity limits; geothermal remains subject to the
game's resource restrictions; Honolulu excludes Hawaii Island geothermal capacity.
These restrictions can omit part of a region's
real supply and change the mix. After four failed proportional fleet doublings, a
still-undersupplied model receives explicitly labeled modeled gas backup. The
setup calls out that backup; it is not a claim about existing local gas plants.
The absolute simulated plant sizes and reserve are model assumptions rather than
reported local capacities. The game rounds non-hydro starting plants to two
significant digits, so their exact proportions can change. A regional hydro share
never implies that a new dam can be built at the selected city's coordinates.

The demand slider defaults to a hypothetical 100 MW project.
It is not a researched forecast of proposed data centers. Editing accounts
changes the ordinary grid's size without changing that preset or a player's
chosen project size. The dedicated setup treats the selected MW as a constant total
electricity draw, including cooling; no arbitrary winter seasonality is imposed.
Existing regional data-center demand and growth remain in both comparison runs.
The selected arrival year and MW replace the fixed story's
schedule; zero MW keeps an explicit zero-load schedule for a matched baseline.
The run lasts at least ten years beyond arrival, with a minimum of sixteen years.

Fuel mappings: coal → Coal, gas → Natural Gas, nuclear → Uranium, solar → Sun,
wind → Wind, hydroelectric → Hydro, bioenergy/wood → Biomass. EIA geothermal has
its own game fuel. Ember's aggregated **Other Fossil uses Oil as a simulation
proxy**; this category is not exclusively oil. EIA Other/Other Gas and Ember
Other Renewables are retained as an explicit `unsupportedShare`, not silently
reassigned to a specific technology. EIA battery and pumped storage are excluded
from generation shares: their MW alone do not establish usable stored energy or
duration. Gas turbine/combined-cycle subrows are not double-counted. Source
missing values are omitted; this is not proof that no such plant exists.

## Reproduction

Run `python scripts/research-data-center-power.py` with Python 3, `openpyxl` and `pdfplumber`,
then `npx prettier --write src/data/DataCenterPowerCapacity.json`. The script
caches source downloads in the system temporary directory under
`electrify-power-research`; remove that specific cache to fetch updated releases.
It fails if a current catalogue country has no corresponding source record.
Review source changes and data years before updating the snapshot. No network
request is made by the browser or tests.

`DataCenterPowerMix.test.ts` checks historical selection, California's measured
fuel ordering, Puerto Rico's separate record, explicit World fallback, and
nonempty normalized observations for every current catalogue location.
