# Across the Valley map

Scenario 116 and mods based on it share one company power pool. Facilities and
storage serve every owned customer's demand automatically. Territory location
controls suitable finite sites and inherited customer sectors. It never limits
power transfers, requires a connection purchase, or adds a parallel connection fee.
The authored starting area extends into deterministic terrain as players acquire
individual tiles. Each hex contains a city with no construction slot, or exactly
one facility site. Regional weather remains shared, with the small local
[terrain modifiers](terrain-modifiers.md) applied to wind speed and construction.

The map labels the player's utility “You” and names neighboring utilities directly,
with distinct ownership borders. Acquired utility land joins the player's border.
Unowned tiles have no proper names. Terrain is a separate illustrated surface
beneath cities, generators, storage or transmission towers. Empty developed sites
show towers, with automatic wires joining adjacent developed cells of the same
company. Wires are visual: they add no transfer limit, price or upkeep. Selecting
a hex opens its floating inspection or construction surface. Empty owned sites
open the generator/storage catalogue already locked to that tile; occupied sites
show the actual facility controls. City tiles show customers and demand by use.

The map reveals three hexes beyond owned land and active utility connections.
Terrain and structures fade and desaturate with distance; undiscovered cells
cannot be bought. Acquiring a visible frontier tile extends that frontier, so the
map has no small fixed boundary. Geography comes from a versioned integer
coordinate hash shared by every co-op company, independently of weather seeds.

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

An unowned tile can be purchased immediately when it touches a physically owned
company tile. Active utility PPAs and connected peer land extend sight without
granting purchase adjacency. Acquired utility land and retained paid disconnected
property are company-owned anchors for further adjacent purchases.
Prices use 2005 dollars, indexed by the existing seeded CPI:

- General building tiles cost $3 million each. The original larger land area's
  seven tiles cost one seventh of its former $18 million price each. Any ordinary
  onshore generator or storage technology can use general sites, subject to
  normal technology and quote limits. General land has no additional site MW cap.
- Residential tiles cost $32 million and add 16,000 customer accounts at the
  scenario's opening date. Industrial tiles cost $12 million and add 400 accounts,
  each with demand equivalent to 20 ordinary accounts. Account transfers scale with
  the existing dated market growth and update the company's demand sector mix.
  These city tiles have no building sites or inherited plants.
- Hydro tiles cost $16 million and provide one fictional 20 MW hydro site.
  Geothermal tiles cost $14 million and provide one fictional 25 MW site.
  Facility construction is a separate purchase using the existing technologies,
  construction schedules and operating models. A commissioned hydro site remains
  consumed after the plant is retired.

Land has no construction clock or recurring upkeep. Its dated receipt records the
price, and land remains a non-depreciating capital asset. Exchanging cash for land
preserves net worth while reducing cash available for facilities. Customer
transfers are counted once and join the retention objective's baseline before
its deadline; buying land does not replace a required utility acquisition.

Ordinary inspection offers one clearly priced **Connect** action. “Connection cost”
is the same instant land transaction described above; the wording adds no line
capacity, recurring fee or construction delay. The explicit
**Connect** icon toggles price labels and supports repeated purchases without
opening construction after each one. Its pressed state remains on until toggled off;
dragging, focus changes and arrow navigation never spend cash. Both entry points
share pending commitments, and co-op ownership appears only after host acceptance.

The historical industrial, wind and open-land labels all describe ordinary
building land. Any ordinary onshore generator or storage technology can use those
cells, with no additional site MW cap; the technology's own calendar, size and
resource limits still apply. Named hydro and geothermal sites retain their
technology restrictions and physical power limits, and inland water does not
permit new offshore construction. Storage retains the existing technology quote
for power and energy duration. Paused
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
the current site limits. Schema 16 assigns retained facilities to separate
compatible hexes deterministically. Retained fleets exceeding today's authored
budgets receive individual legacy overflow hexes rather than losing assets or
stacking several facilities on one cell. Construction and paused projects reserve
their cell immediately; cities cannot be built over. Schema 17 adds individual
tile receipts. Earlier whole-area purchases retain every previously paid-for cell
and their exact capital value, without extra charges or refunds. Schema 18 keeps
previously paid individual receipts under their original visibility rule while
requiring owned physical adjacency for new purchases. Inland water is a lake;
previously installed offshore plants retain their output and finances, with no
right to build a replacement offshore plant on the lake.

In co-op, the host serializes purchases independently for each tile. The first
valid accepted claim owns that tile; another company keeps its cash and cannot
build there. Room views and restored worlds derive ownership from receipts.
Recognized published schema 13, 14, 15, 16 and 17 rules
identities have ordered migrations; existing duplicate uplands rights are
preserved because those maps were company-local. New land claims are exclusive.
Utility acquisitions remain separate company choices. Automatic peer market
quantities remain bounded, without player wire controls or new wire fees. Buying
and selling choices remain available under Agreements → Co-op power sharing,
including when a restored company previously disabled either direction.
