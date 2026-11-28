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
a hex opens its floating inspection or construction surface. Empty connected sites
open the generator/storage catalogue already locked to that tile; occupied sites
show the actual facility controls. City tiles show customers and demand by use.

Across the Valley opens with a fixed 196-hex board. Terrain and structures
desaturate over three distance bands from the company's land. New connections
stay within the board. Older saves retain their paid sites beyond its edge.
The board uses the same versioned coordinates in single-player and co-op.

Open any competitor's tile and choose **Acquire** to review its deal. A shared
border between a connected tile and any of the seller's sites enables confirmation. The same review
shows the cash price, customers, sites, and the change in expected supply margin.

The municipal utilities in Vergennes, Waterbury, Bristol, and Middlebury
transfer their city, customers, and neighboring plant site for cash. The seller
removes the equipment and the site becomes available to build on.

Valley Electric and Ridge Electric transfer their plants, customers, sites,
corporate debt, and dated third-party obligations. Their reviews include loan
terms, inherited power contracts, and monthly utility operations. A purchase agreement with the acquired seller ends as an
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

- Ordinary building land costs **$2.4 million plus $600,000 per hex** from the
  nearest city you own. The line cost per hex is multiplied by **1.00** on plains,
  **2.25** in forest, **1.40** in hills or **1.75** in mountains, using the
  terrain of the tile you connect. A plains tile costs $3 million at one hex and
  $4.8 million at four. Owning a closer city can lower later quotes. Municipal
  plant sites keep their parcel pricing as part of the utility acquisition.
  Ordinary onshore generators and storage can use general sites within the
  usual siting and technology limits.
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

The fixed hookup and per-distance line cost follow the structure of
[NREL's bottom-up transmission cost model, §§4.3.7–8](https://www.nrel.gov/docs/fy23osti/84875.pdf#page=24).
[MISO's 2024 cost guide, Tables 4.1-1 and 4.2-1/2](https://cdn.misoenergy.org/MISO%20Transmission%20Cost%20Estimation%20Guide%20for%20MTEP24337433.pdf)
estimates $1.8–2.2 million per mile for 115 kV overhead line and $8.3 million
for a new four-position 115 kV substation. The board uses schematic hex distance.
The game sets the one-hex plains cost at $3 million with a 20% line share.
The line terrain ratios come from the
[U.S. DOE National Transmission Planning Study, Chapter 3, Table D-3](https://www.energy.gov/sites/default/files/2024-10/NationalTransmissionPlanningStudy-Chapter3.pdf).
The study models clearing and access in forests as more expensive than the
mountain category. The game uses the destination terrain as a proxy for the route.

The connection cost is paid when work starts. Land is a non-depreciating capital
asset with no recurring upkeep. The price reduces cash available for facilities.
Utility acquisitions credit customers once and count toward the competitor goal.
The transferred customers join the retention baseline.

A new connection takes 1 month on Intern, 2 on Employee, 3 on Manager, 4 on
VP and 6 on CEO. You can start connections from tiles already under construction.
Tower assembly progresses with the game clock. Wires appear once the tower is
complete and has a live route to the grid. At that point, the tile can host
facility construction or add its customers. Planning a facility on a new site lets
you review the project and pay for the connection first. You can buy the facility
as soon as the tile is live.

The **Rapid connection mode** icon displays prices and supports repeated purchases
while the map stays open. Toggle it off, press Escape with focus on the map, or
start planning a project to exit. Dragging, changing focus and using the arrow keys
leave cash available. Both purchase entry points share pending payments. In co-op,
the host confirms the claim before the work appears on either map.

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
The bottom-right **Map layers** menu has one **Facility status** checkbox for
operating, idle, paused and construction markers, along with city-name labels.
Facility operation continues when the overlay is hidden.

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
and selling choices remain available under Trade → Co-op trade,
including when a restored company previously disabled either direction.
