# Across the Valley map

Scenario 116 and mods based on it share one company power pool. Facilities and
storage serve every owned customer's demand automatically. Territory location
controls suitable finite sites and inherited customer demand. It never limits
power transfers or adds a separate line project or fee beyond the tile's connection
cost. The authored starting area extends into deterministic terrain as players
acquire individual tiles with **Connect**. Each hex contains a city with no
construction slot, or exactly one facility site. Regional weather remains shared, with the small local
[terrain modifiers](terrain-modifiers.md) applied to wind speed and construction.

The map labels the player's utility “You” and names neighboring utilities directly,
with distinct ownership borders. Acquired utility land joins the player's border.
Unowned tiles have no proper names. Terrain is a separate 3D surface
beneath cities, generators, storage or transmission towers. Empty developed sites
show towers, with automatic wires joining adjacent developed cells of the same
company. Wires are visual: they add no transfer limit, price or upkeep. Selecting
a hex opens its floating inspection or construction surface. Empty owned sites
open the generator/storage catalogue already locked to that tile; occupied sites
show the actual facility controls. City tiles show customers and demand by use.

Across the Valley opens with a fixed 196-hex board. Terrain and structures
desaturate over three distance bands from the company's land. New connections
stay within the board. Older saves retain their paid sites beyond its edge.
The board uses the same versioned coordinates in single-player and co-op.

Vergennes, Waterbury, Bristol, and Middlebury each have a local utility with a
neighboring plant. Touching either site lets the player acquire both sites and
the utility's customers together. The seller removes the equipment on transfer.

Valley Electric and Ridge Electric can each be inspected from any tile.
Acquiring either utility requires a shared land border with one of its tiles.
Their plants, customers, sites, corporate debt and dated third-party obligations
transfer together. A purchase agreement with the acquired seller ends as an
external supply/charge; its owned fleet replaces that promise. Buying an inefficient
fleet can increase operating costs. Acquiring it does not improve its plants.

Neighbor agreements use the existing supplier availability, market pricing and
monthly minimum accounting. Each has a finite quantity and duration. Neighbor
blocks cannot overlap or queue before the active term expires. Supplier limits,
weather, expiry and minimum bills remain; no line is built or upgraded to sign.
Inherited third-party contracts retain their own dates and replacement windows.

An available tile can be purchased when it touches a physically owned company
tile. Acquired utility land and retained paid property both qualify as company
land for adjacent connections within the board.
Prices use 2005 dollars, indexed by the existing seeded CPI:

- General building tiles cost $3 million each. The original larger land area's
  seven tiles cost one seventh of its former $18 million price each. Any ordinary
  onshore generator or storage technology can use general sites, subject to
  terrain siting allowances and normal technology and quote limits.
- Medium cities cost $32 million and add 16,000 customer accounts at the
  scenario's opening date. Small cities cost $12 million and add 400 service accounts,
  each with demand equivalent to 20 ordinary accounts. Account transfers scale with
  the existing dated market growth and update the company's demand mix.
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
**Rapid connection mode** icon toggles price labels and supports repeated purchases without
opening construction after each one. Its pressed state remains on until toggled off;
dragging, focus changes and arrow navigation never spend cash. Both entry points
share pending commitments, and co-op ownership appears only after host acceptance.

The historical industrial, wind and open-land labels all describe ordinary
building land. Any ordinary onshore generator or storage technology can use those
cells, within a finite terrain-and-technology power allowance. Limits in MW,
in plains/forest/hills/mountain order, are:

- Solar: **150 / 75 / 100 / 25**.
- Onshore Wind and Airborne Wind: **300 / 200 / 450 / 450**.
- Thermal plants, Enhanced Geothermal and storage: **1000 / 600 / 750 / 400**.

These are fictional gameplay siting allowances, not surveyed hex areas or literal
hectares-per-MW conversions. Solar receives the smallest ordinary-land allowance;
mountain solar has little contiguous suitable ground. Wind shares its surrounding
land with other uses, while thermal and battery plant footprints are compact.
The technology's own calendar, size and resource limits also apply, and the lower
ceiling wins. Named hydro and conventional geothermal sites retain their
technology restrictions and physical power limits, and inland water does not
permit new offshore construction. Ocean wind retains its site's resource ceiling.
Storage retains the existing technology quote for power and energy duration:
four-hour batteries on a 400 MW mountain site can hold at most 1600 MWh, provided
their current technology energy ceiling also permits it. A smaller project still
uses the whole slot; no unused allowance can be pooled with another tile. Paused
and unfinished projects reserve sites; selling an ordinary project frees one.
Existing plants retain their placement, capacity and finances when terrain
allowances change, including plants on individually purchased frontier cells.
New construction and capacity-expansion targets must fit today's allowances.
Inherited hydro retains its named provenance.

Cities share one visual family: small towns, medium urban centers and large city
skylines. Customer counts determine the tier; accounts below 8,000 are small,
below 50,000 medium, and the remainder large. Counts and load scaling retain the
authored economic identities. Every city has a seed-and-ID-derived mixture of
residential, commercial and industrial demand. Discovery and connection order do
not change that mixture. Inspection and the company demand calculation use the
same profile, including for cities the player does not own.

## Capacity upgrades

An existing generator or storage facility offers **Upgrade capacity** in its
details. The cash price is the current quote for the target size less the current
quote for its installed size, retaining its technology, location and build options.
The review shows the total target, added capital, cash remaining and construction
time. Added capacity uses the normal target project's construction duration;
existing capacity continues operating under its ordinary dispatch rules. Storage
retains its actual stored energy, and hydro retains its stored water.

Each facility supports one capacity project at a time. A pending retrofit prevents
another project. Completion preserves the plant's identity, age, loans and history;
it adds the paid capital and operating-cost difference. Cancellation returns the
capacity project's capital once without undoing already emitted construction
carbon. Co-op commands and save validation bind each project to its own identity.

Producing plants use a green plus, idle plants a red minus, and active 3D models
gain saturation and illuminated windows. Charging remains a separate storage state.
The bottom-right **Map layers** menu independently controls operating, idle/paused
and construction markers. These preferences only affect badges.

The relative allowances draw on primary-source mechanisms rather than equal-area
engineering comparisons. [NREL's solar land-use study (2013)](https://docs.nlr.gov/docs/fy13osti/56290.pdf)
describes extensive array cover. [NREL's wind land-use study (2009)](https://docs.nlr.gov/docs/fy09osti/45834.pdf)
separates permanent disturbance from much larger turbine spacing, explaining why
the game's shared-land allowance differs from total wind lease area.
[BLM's solar-zone identification protocol](https://blmsolar.anl.gov/solar-peis/sez/identification/)
considers slope and contiguous suitable area. [SMUD's proposed Dry Creek battery project](https://www.smud.org/Corporate/Environmental-Leadership/Power-Sources/Dry-Creek-Energy-Storage-Project)
places 160 MW / 640 MWh on about 15 acres, illustrating compact storage without
establishing a universal density. None of these sources specifies this game's
rounded caps. `territoryTilePowerLimit(tile, facility)` owns the selected
technology allowance; omitting the facility returns the greatest physical
allowance for inventory displays. `tileFitsFacility` applies it at site selection
and authoritative purchase validation.

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
Utility acquisitions remain separate company choices. Discovered tiles show
the acquiring company's current facilities, including new construction.
If several companies acquire the same utility, each sees its own fleet there.
Other viewers see the first acquirer in room roster order. Automatic peer market
quantities remain bounded, without player wire controls or new wire fees. Buying
and selling choices remain available under Agreements → Co-op power sharing,
including when a restored company previously disabled either direction.
