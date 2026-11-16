# Across the Valley territories

Scenario 116 and mods based on it share one company power pool. Facilities and
storage serve every owned customer's demand automatically. Territory location
controls suitable finite sites and inherited customer sectors. It never limits
power transfers, requires a connection purchase, or adds a parallel connection fee.
The 22 territories and 37 map hexes are schematic. Each territory owns its site
budget; individual hexes do not add build slots. Weather remains the existing
shared regional model.

The map labels the player's utility “You” and names neighboring utilities directly,
with distinct ownership borders. Acquired utility land joins the player's border.
Unowned parcels have resource symbols rather than proper names. Compass directions
in inspection and build controls distinguish parcels with the same benefit.

Valley Electric and Ridge Electric can each be inspected and acquired directly.
Their plants, customers, sites, corporate debt and dated third-party obligations
transfer together. A purchase agreement with the acquired seller ends as an
external supply/charge; its owned fleet replaces that promise. Buying an inefficient
fleet can increase operating costs. Acquiring it does not improve its plants.

Neighbor agreements use the existing supplier availability, market pricing and
monthly minimum accounting. Each has a finite quantity and duration. Neighbor
blocks cannot overlap or queue before the active term expires. Supplier limits,
weather, expiry and minimum bills remain; no line is built or upgraded to sign.
Inherited third-party contracts retain their own dates and replacement windows.

Every unowned parcel is an immediate cash purchase, without adjacency gating.
Prices use 2005 dollars, indexed by the existing seeded CPI:

- General building land costs $6 million for two shared sites. The original larger
  parcel costs $18 million for seven shared sites, retaining its historical price
  and internal `green-uplands` identifier. Any ordinary onshore generator or storage
  technology can use these sites, subject to normal technology and quote limits.
- Residential parcels cost $32 million and add 16,000 customer accounts at the
  scenario's opening date. Industrial parcels cost $12 million and add 400 accounts,
  each with demand equivalent to 20 ordinary accounts. Account transfers scale with
  the existing dated market growth and update the company's demand sector mix.
  These parcels have no building sites or inherited plants.
- Hydro parcels cost $16 million and provide one fictional 20 MW hydro site.
  Geothermal parcels cost $14 million and provide one fictional 25 MW site.
  Facility construction is a separate purchase using the existing technologies,
  construction schedules and operating models. A commissioned hydro site remains
  consumed after the plant is retired.

Land has no construction clock or recurring upkeep. Its dated receipt records the
price, and land remains a non-depreciating capital asset. Exchanging cash for land
preserves net worth while reducing cash available for facilities. Customer
transfers are counted once and join the retention objective's baseline before
its deadline; buying land does not replace a required utility acquisition.

Home and utility territories retain their industrial, wind and solar/storage
budgets: thermal projects use industrial sites, wind uses wind sites, and solar
and storage use open-land sites. Industrial and general projects are capped at
300 MW per site; wind/open-land projects at 150 MW. Storage uses its power rating
for the site limit and the existing technology quote for energy duration. Paused
and unfinished projects reserve sites; selling an ordinary project frees one.
Inherited hydro retains its named provenance.

Schema 14 converts schema 13 physical projects into frozen legacy capital records.
Every paid legacy uplands project grants immediate land rights, including paused,
unfinished or upgraded projects. Original investment, construction progress,
financing schedules and debt remain recorded. Cash, acquired assets, locations,
agreements and history are retained. No refund or extra fee is booked; no future
wire construction, upkeep or congestion runs. Land is counted once rather than in
both its receipt and legacy project. Original loan payments continue to move cash
into equity. Schema 15 generalizes receipts and site budgets for all parcels while
preserving this progress. Existing oversized projects remain; new purchases use
the current site limits.

In co-op, the host serializes purchases independently for each parcel. The first
valid accepted claim owns that parcel; another company keeps its cash and cannot
build there. Companies can claim different parcels. Room views and restored worlds
derive ownership from receipts. Recognized published schema 13 and 14 rules
identities have ordered migrations; existing duplicate uplands rights are
preserved because those maps were company-local. New land claims are exclusive.
Utility acquisitions remain separate company choices. Automatic peer market
quantities remain bounded, without player wire controls or new wire fees. Buying
and selling choices remain available under Agreements → Co-op power sharing,
including when a restored company previously disabled either direction.
