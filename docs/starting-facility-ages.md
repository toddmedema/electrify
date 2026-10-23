# Starting facility ages

Starting facilities in generated community scenarios represent an existing fleet.
Their ages are capacity-weighted estimates for the selected geography and fuel,
not claims about the selected utility's individual plants. Newly built facilities
and explicit ages in authored scenarios retain their own commissioning dates.

## Global source and reproducibility

The country, regional and global cohorts in
`src/data/StartingFacilityAgeCohorts.json` derive from the
[World Resources Institute Global Power Plant Database v1.3.0](https://github.com/wri/global-power-plant-database).
The database is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The 34,936-record input is pinned to
[commit 7a91cfbb2a4e272597acbc00506d61fc1ec73b3d](https://github.com/wri/global-power-plant-database/blob/7a91cfbb2a4e272597acbc00506d61fc1ec73b3d/output_database/global_power_plant_database.csv)
and SHA-256
`4b1f93e0fd93664f18684d9b05d0a52ed9658c6a8cf0d21ff2520791379ba7fc`.

Run `node scripts/research-starting-facility-ages.js` with Node 24 to regenerate
the snapshot. The script caches the download in the operating system's temporary
directory. Use `--input <csv-path>` for an existing download; both paths verify the
same checksum. Format the resulting JSON with Prettier.

For each country and fuel, the snapshot retains reported capacity, capacity with a
usable commissioning year, and an annual age profile for 2010–2020. Each profile
entry is the whole-year, capacity-weighted mean age of plants commissioned before
that January 1, or `null` when no eligible dated plants exist. Fractional source
commissioning years are rounded to the nearest year and MW totals to two decimals.
The reference year is 2020, the latest commissioning year in the source. Keeping
the annual means in the app avoids shipping thousands of source cohort pairs.
Countries use the weather catalogue's names, with explicit aliases for different
source spellings. Every supported country has a record, including an empty record
when the database has no matching plants.

Fuel mappings preserve Coal, Gas, Oil, Nuclear, Hydro, Solar, Wind, Biomass and
Geothermal, using the game's names. Petroleum coke joins Oil. Waste, cogeneration,
other fuels, wave/tidal and generic storage are excluded because those labels do
not identify a matching game technology unambiguously. In particular, the storage
label cannot establish battery ages or distinguish pumped hydro from other
storage. The age snapshot does not replace the separate installed-capacity mix.

## Coverage and estimation

A geography's commissioning history is used when at least 50% of its reported
capacity for that fuel has a usable commissioning year. Otherwise the lookup
tries its region, then the global fuel cohort. This majority-coverage threshold
is a modeling rule to avoid treating a few unusually well-documented plants as an
entire national fleet; it is not a statistical confidence interval. The chosen
cohorts are weighted by MW, so a small plant does not count as much as a large one.

Regions group the countries represented in the playable weather catalogue.
Transcontinental countries represented in multiple game regions contribute once
to each of those regions, and once to the world aggregate. The world aggregate
includes every country in the source, including countries outside the playable
catalogue.

WRI says the project has been unmaintained since early 2022. Its portal's newer
metadata dates do not establish a newer plant inventory. Commissioning coverage
varies sharply: the UK and Australia have no usable commissioning years in this
release, and many French and Canadian records also lack them. Bahamas, Barbados,
French Polynesia, Haiti, Maldives, New Caledonia, Puerto Rico and Solomon Islands
have no matching source inventory. Their fallback ages remain estimates and are
not asserted to be researched local commissioning dates.

The sample describes plants present in a historical source inventory. Filtering
out commissioning dates after a scenario's start avoids future plants, but does
not reconstruct plants that retired before the inventory was collected. It also
does not capture all subsequent additions, retirements or repowering. Global or
regional fallback estimates can obscure local differences, especially where a
large national fleet dominates the available sample. These are limitations of
representative fleet ages rather than evidence that all facilities were new.

## Authored scenarios

Authored scenarios already carry individual starting ages where those are part of
their researched setup or game design. The audit found the four Deep Freeze
portfolio entries and the default Custom Game peaker lacked explicit ages. An
explicit zero, such as the Manassas Data Center Boom peaker, represents authored
new equipment and must not be confused with an omitted generated age.

Deep Freeze opens in 2017 with aggregate resource rows. Its ages are rounded
capacity-weighted approximations of Austin Energy's assets and contracted supply:

- Gas, 30 years: Decker's steam units (315 MW in 1967 and 420 MW in 1978) and
  combustion turbines (about 200 MW in 1988), plus Sand Hill's turbines (180 MW in
  2001 and 90 MW in 2010) and combined cycle (300 MW in 2004).
- Coal, 33 years: the roughly 600 MW Fayette share (1979–1980), grouped with the
  100 MW biomass resource (2012), as the existing scenario already does.
- Nuclear, 29 years: South Texas Project units commissioned in 1988 and 1989.
- Wind, 4 years: the 1,219 MW of listed wind contracts with starts from 2007
  through 2016, rounded to the scenario's 1,200 MW portfolio row. Later contracts
  are excluded.

The primary sources are Austin Energy's [plant inventory](https://austinenergy.com/about/company-profile/electric-system/power-plants),
the City's [Electric Utility System Revenue Bonds official statement](https://services.austintexas.gov/edims/document.cfm?id=427822)
and the utility's [renewable resource contracts](https://austinenergy.com/about/company-profile/environment/renewable-power-generation).
These rows intentionally remain aggregate game assets; their ages do not turn
them into claims about one physical plant. The default Custom Game peaker now
starts at 17 years, the California peaker estimate for its default 2020 opening.
Players' supplied facility ages, including zero, are unchanged.

## US state observations

`src/data/StartingFacilityAgeStates.json` summarizes the [EIA-860 2024 generator
inventory](https://www.eia.gov/electricity/data/eia860/), covering all 28 supported
US states. The [archived source ZIP](https://www.eia.gov/electricity/data/eia860/archive/xls/eia8602024.zip)
is pinned to SHA-256
`0aaae04812cd4ab87a3e346bdf93848a3cc15053fd4dc2a4cf82d2aeac95f12b`.
Run `node scripts/research-us-starting-facility-ages.js` with Node 24, optionally
passing the path to that ZIP. Downloads stay under the ignored
`.tmp/starting-age-research/` directory. Format the resulting JSON with Prettier.

The generator reads the Operable worksheet and includes operating, standby and
out-of-service units (OP, SB, OS), weighted by nameplate MW. It uses the primary
energy source and operating year, excludes pumped hydro from conventional Hydro,
and maps only identifiable game fuels. Mixed waste, other gases and unspecified
fuels are excluded. Combined-cycle gas uses EIA prime movers CA, CC and CS;
peakers use GT and IC. A gas unit without the requested subtype uses the state's
general gas profile. The survey covers plants with at least 1 MW combined
nameplate capacity, so these commissioning observations exclude distributed
rooftop solar even though the separate capacity mix includes it.

Profiles contain whole-year means for each 2010–2024 opening, using only units
with operating years before that opening. They represent survivors in the 2024
inventory, rather than reconstructed complete historical inventories. A unit's
operating year need not be its latest refurbishment date. State observations
are preferred to national, regional and world estimates, with the same majority
coverage rule. Puerto Rico uses its own country label and the broader fallbacks
when a local dated inventory is unavailable.

## Simulation effects

The inherited age is resolved when the scenario is created and travels with its
saved facilities. It changes existing solar/wind degradation, thermal cycling
history and resale depreciation through the normal reducer; it does not add
historical expenses to the player's accounts. Starting-fleet calibration still
fits the actual aged fleet against ordinary demand before the new data centers
arrive. The model's explicit balancing reserve also receives an inherited gas
age. Purchases made during play retain their normal age-zero commissioning.

The catalogue's lifespan is a financial depreciation assumption rather than a
forced shutdown date. Hydro facilities can therefore have realistic ages above
50 years; capping their age at that finance life would erase actual operating
history. Future starts freeze the latest observed age profile, just as the
regional capacity mix freezes its latest source observation. This assumes fleet
renewal maintains a representative age distribution; it is not a forecast of
individual plants remaining in service through 2049.

## Solar and wind capacity histories

Outside the preferred US state observations, solar and wind use
`src/data/StartingRenewableAges.json`. It estimates vintages from
[Ember's Yearly Electricity Data](https://ember-energy.org/data/yearly-electricity-data/)
capacity histories for 2000–2024, avoiding the sparse commissioning coverage and
older solar-plant bias in the WRI sample. The source is licensed
[CC BY 4.0](https://ember-energy.org/data/electricity-data-explorer/), retrieved on
2026-10-20, and pinned to SHA-256
`259e1095ee8ffeaf0aff37ad557916ae1823a2da13312da50ba4cec6b4574c3b`.
The global profile uses Ember's World series. Regional profiles combine the
country vintage estimates using the same game-region grouping as the WRI data.

Each year's net increase in MW creates a commissioning cohort for that year.
When capacity falls, all existing cohorts shrink proportionally because the
series cannot establish which individual plants retired. The capacity already
present in 2000 inherits the local WRI pre-2000 mean vintage when the country has
majority commissioning coverage and eligible old plants; otherwise its assumed
age in 2000 is ten years. Where a series first appears after 2000, the first
reported capacity is assigned to that year. These are explicit modeling
assumptions, and net additions do not identify gross construction, retirement or
repowering activity.

For a January 1 opening, the mean includes only capacity observed through the
preceding calendar year. The snapshot provides annual profiles for 2010–2024;
later openings retain the 2024 age profile. The `knownCapacityMW` coverage value in
this snapshot means capacity covered by the observed time series, rather than
capacity with individually verified commissioning dates. The reported 2024 MW
totals establish source coverage; plants added during 2024 do not appear in its
January 2024 age profile.

The same Node research script regenerates both global snapshots. To use cached
sources, pass `--input <wri-csv-path> --ember-input <ember-csv-path>`. Both downloads
are checksum-verified before use. Ember's public URL can change with releases;
a changed checksum stops regeneration until the new source is reviewed.
