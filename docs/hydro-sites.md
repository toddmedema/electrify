# Conventional Hydro: physical sites and research coverage

Last reviewed: 2026-09-22. Generated simulation input: `src/data/HydroSiteCatalogue.json`.

## Gameplay convention

Each conventional Hydro project claims one physical site. The gameplay ceiling is a cited nameplate or assessed potential rounded to one significant digit, not a proven engineering maximum. Sites below 10 MW in the source are excluded before rounding; original source values remain in the catalogue for provenance. The smallest remaining ceiling **greater than or equal to** the exact integer-watt request wins; ties use the stable site ID. A smaller plant consumes the entire site. Sites cannot be pooled, and unused capacity cannot be reclaimed. Construction reserves a site, cancellation releases an unfinished reservation, and commissioning makes its claim permanent through sale or retirement.

Geography and ceilings do not vary by scenario year. No real-world commissioning date, development category, or availability window is imported. Real-world plants are evidence of geography and capacity, not reservations: only the authored starting fleet and player actions occupy sites. The existing Hydro technology unlock still applies. `resources.hydro: false` prevents new construction without invalidating existing assets. A custom coordinate cannot borrow a named city's inventory.

The default inventory radius is 250 km great-circle distance (haversine, Earth radius 6371.0088 km) from the canonical city coordinates, matching the regional-grid interpretation used for pumped hydro. A site may belong to several independent games. Projects below 1 MW are omitted, matching the main build minimum. Source MW is explicitly converted with `Math.round(originalValue * 1_000_000)` and checked against the integer source ceiling.

## Sources and audit

The starting research is the [issue 417 catalogue](https://gist.github.com/toddmedema/2a475e6f7f130a4dd4e0bd30f9594a0f), revision `d102fef109030842710643c979f171ef67d014e1`, reviewed on 2026-09-22. It supplies EIA-860M July 2026 US plant-level HY nameplate and coordinates, and WRI Global Power Plant Database 1.3.0 records elsewhere. Original per-plant source references, values, units and notes remain on accepted sites. GPPD's version is 1.3.0; the issue labels it “2024”, which is not treated as every record's observation year.

The supplied research is **not copied wholesale into gameplay**. Despite its exclusion notes, its actual records include pumped storage (Révin, Villarino, Lamtakong) and thermal Karlshamn. Other records aggregate several projects or have conflicting coordinates. These examples were checked against [EDF](https://www.edf.fr/hydraulique-revin), [Iberdrola](https://www.iberdrolaespana.com/about-us/business-lines/hydroelectric-power/tormes-basin), [EGAT](https://www.egat.co.th/home/en/lamtakong-pp/), and [Uniper](https://www.uniper.energy/sweden/power-plants-sweden/karlshamn/laboratory). They demonstrate a source classification gap, not zero hydro potential in the affected cities.

Production accepts:

- **United States:** the research's [EIA-860M](https://www.eia.gov/electricity/data/eia860m/) rows explicitly identified as prime mover HY. PS units are excluded upstream. Mixed plants contribute only their conventional share (for example Seneca's 26.1 MW). Coverage is US nameplate plants, not all possible dams or cross-border resources.
- **Europe:** GPPD candidates corroborated by the [JRC Hydro-power plants database](https://github.com/energy-modelling-toolkit/hydro-power-database), exact revision `3e8a8378289679073208b39825a99de5ab8b05f5`. Require one unambiguous name match within 2 km, capacity agreement within 5%, HDAM or HROR technology and no positive pumping capacity. Retain the original GPPD capacity and document the JRC record and capacity on each accepted site. Missing or ambiguous matches are omitted, not guessed. This corroboration dataset is an open CC BY 4.0 research project originating at JRC, not an official European Commission product. Attribution: Matteo De Felice and the contributors listed in that repository.
- **Individually reviewed sites:** Azután is conventional according to [Iberdrola's Tagus basin description](https://www.iberdrolaespana.com/conocenos/lineas-negocios/energia-hidroelectrica/cuenca-tajo); the original REE/GPPD 198.01 MW is retained over JRC's older 180 MW figure. Kariba, Kafue Gorge and Victoria Falls are corroborated by [ZESCO's generation catalogue](https://www.zesco.co.zm/generation). Retain source-vintage ceilings of 1,680 MW (the two national powerhouses at the same Kariba dam), 990 MW and 108 MW respectively, rather than inventing a year-dependent engineering maximum.

Known conflicting aggregate records (including Laufenburg, Fionnay and Aurland), and mixed/reversible records without a separately corroborated conventional share, are excluded. Two candidate records within 150 m are both withheld pending physical-site resolution; they are never summed into a hypothetical site. This deliberately excludes some legitimate neighbors. The generated metadata lists those IDs. There are no alternative designs or turbine records promoted into independent sites by this rule.

Every one of the 285 records in `scripts/cities.json`, including all shipped and scenario locations, has an explicit attempted-review disposition in [the coverage table](hydro-site-coverage.md) and the generated inventory. `researched` means a documented partial inventory under this method, not an exhaustive resource assessment. `unresearched` means the reviewed source could not support a qualifying conventional physical-site inventory; the UI must say “Hydro site data unavailable”. Empty researched US inventories mean no qualifying site was found in this source/radius, not that hydro is physically impossible.

Outside US coverage, corroborated European records and the individually checked sites, GPPD's missing pumped-storage classification, uncertain physical-site grouping and sparse coverage remain unresolved. Cities may include verified cross-border sites but still have incomplete domestic coverage. Particularly sparse GPPD coverage includes Venezuela, Mongolia, Israel and small islands. The coverage table exposes these gaps rather than converting them to false zero-potential claims.

This catalogue does not claim completeness for assessed potential. [ORNL's non-powered-dam assessment](https://hydrosource.ornl.gov/data/datasets/us-hydropower-potential-existing-non-powered-dams-greater-1mw/) and the [FERC Montgomery assessment](https://www.ferc.gov/sites/default/files/2020-06/P-13757-002-EA.pdf) were reviewed as additional sources. They describe physical opportunities, but a reconciled site-level layer is not incorporated here. In particular, Emsworth's proposed 24 MW is not a Pittsburgh-wide limit. Pittsburgh has 13 accepted sites of at least 10 MW; Lake Lynn's cited 51.2 MW becomes a 50 MW gameplay ceiling.

## Authored starting fleets and exception

- **Madrid heatwave:** the authored 171.57 MW plant occupies Azután's 198.01 MW site. Its starting capacity and age are unchanged. This is a gameplay-scaled starting asset, not a claim that Azután represents all of Spain's hydro.
- **Scenario 114, Zambia:** retain the authored 435 MW, 38-year-old, full-reservoir starting plant and explicitly assign Kariba. The original scenario is a scaled proxy for Kariba, Kafue Gorge and Victoria Falls; 435 MW fits one researched physical site, so no capacity-driven split is necessary. A trial split across the three constituent sites caused a substantial dispatch/depletion regression (the keepUp simulation was fired at month 22 instead of completing), because multiple separately dispatched reservoirs behave differently. That split is not shipped. This issue does not change hydrology or inflate the original 435 MW to its previously rounded 440 MW runtime value.
- The immutable `scenario:114` inventory adds Victoria Falls to Lusaka's two ordinary sites. Victoria Falls is outside 250 km, but this authored scenario explicitly represents the Zambian national grid and already named that plant as a constituent. Only the validated authored scenario may select the exception. Ordinary/custom Lusaka retains its 250 km inventory. Source membership and construction permission remain separate.

## Reproducing the generated files

Download the pinned research gist JSON and the pinned JRC CSV to a temporary directory. The raw source URLs are:

- `https://gist.githubusercontent.com/toddmedema/2a475e6f7f130a4dd4e0bd30f9594a0f/raw/d102fef109030842710643c979f171ef67d014e1/hydro_site_catalogue.json`
- `https://raw.githubusercontent.com/energy-modelling-toolkit/hydro-power-database/3e8a8378289679073208b39825a99de5ab8b05f5/data/jrc-hydro-power-plant-database.csv`

Run `node scripts/import-hydro-sites.js <research.json> <jrc.csv>`, then `npm run format`. The script validates source watts, applies the documented corroboration and collision filters, computes city membership from coordinates, and writes the simulation catalogue and coverage document. Normalized input SHA-256 hashes are included in the output. Bulk data and source dispositions stay separate from runtime allocation logic. After any change, run the catalogue tests, regenerate compatibility, and run `npm run check`.

### Scenario validation

With exact authored 435 MW at Kariba, `npm run sim -- --scenario 114 --strategy keepUp` (Employee, seed 12345) completes all 48 months with all invariants passing. The former rounded 440 MW runtime completed with 0.2% unserved versus 0.7% for exact 435 MW; the strategy builds 60 MW Oil instead of 50 MW. This is the expected capacity-rounding correction, with no authored-capacity or hydrology adjustment.
