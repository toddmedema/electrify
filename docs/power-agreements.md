# Physical interties and power purchase agreements

Across the Valley (scenario 116) separates an operating regional connection from
agreements covering some of its imports. Champlain opens with a 300 MW inherited
connection. Acquiring Valley or Ridge transfers its 350 MW or 60 MW inherited
connection, respectively, with the original agreement calendar. The separately
built Valley and Ridge expansion connections remain acquisition prerequisites.
Inherited connections have no separate construction, financing, upgrade or upkeep
charge; those assets and costs are inside the utility accounts.

The interfaces are fictional aggregate utility connections, matching the existing
`sourceInterfaceW` authoring. They are not historical Highgate ratings. Inherited
agreements display their known reductions and end dates; their original signing
and delivery start dates are unknown and are not invented.

## Authored terms

Inherited nominal coverage and 2005-dollar prices are unchanged: Champlain has
100 MW regional nuclear at $40/MWh and 120 MW Québec hydro at $60/MWh; Valley has
160 MW nuclear at $40/MWh and 120 MW Québec hydro at $60/MWh; Ridge has 40 MW
regional firm at $55/MWh. Deliverability is 95%. Valley nuclear falls to 80 MW on
1 January 2017. Québec coverage falls to 60 MW per utility and Ridge firm to
20 MW on 1 January 2020. Champlain nuclear ends on that date; the remaining
inherited coverage ends on 1 January 2025. Inflation applies once to the agreed
2005-dollar prices. Nuclear's zero operational emissions remain confined to its
inherited contract; regional replacements use regional market emissions.

Only the authored scenario 116 offers replacements, including in co-op. Modded
and custom scenarios cannot accept these products. Québec replacements cover
60 MW for ten calendar years at $65/MWh in 2005 dollars, following inflation.
Regional firm replacements cover the lost Champlain 100 MW, Valley 80 MW or
Ridge 20 MW block for five calendar years at $70/MWh in 2005 dollars, following
inflation. These prices, terms, the two-year review window, 95% delivery and
$0 upfront payment are game assumptions. The game charges only delivered energy;
there is no capacity payment, deposit, take-or-pay obligation or cancellation.

A block becomes reviewable 24 calendar months before its loss. On-time acceptance
starts at the loss boundary. Late acceptance starts at the strictly next calendar
month; acquisition never backdates a replacement. The same product can replace
an accepted agreement when its term ends, provided new delivery starts before
1 January 2025. Accepted delivery may extend beyond that finish date.

## Dispatch and persistence

Active agreement slices serve purchased customer energy before residual market
purchases, ordered by agreed price and stable identity. They are not must-take:
weather generation can displace purchases. Contract and market flows consume one
physical line rating and the same purchased access and regional source budgets.
Co-op planning reserves agreement delivery before residual market settlement.
Pausing a connection stops all flow without cancelling its agreements or moving
their terms. Market buying **None** stops discretionary market and peer imports
while committed agreements remain available. Contract coverage cannot fund
optional external export or storage arbitrage.

Expired coverage leaves the connection in service. All uncovered purchases use
the existing market owner, including trends, weather, scarcity, seeded noise and
shared availability. Valley's former balancing purchase is ordinary uncovered
market buying; its old $75 tariff and 75/60 markup are removed. This intentionally
changes scenario 116 economics: spare inherited interface capacity and post-expiry
spot purchases can avoid the old automatic supply cliff. Service and cash warnings
must come from the actual forecast, with measured balance comparisons maintained
alongside the scenario simulation evidence. Other scenarios retain their ordinary
market path and seeded outputs.

Schema 10 persists accepted block/cycle identity, acceptance minute and resolved
start/end. Capacity, price and emissions are derived from canonical authoring.
The reducer revalidates the reviewed quote; the save parser rejects forged terms,
duplicates, overlap, unknown blocks, acceptance before ownership and invalid
inherited interfaces. The schema-9 migration adds only already-owned interfaces
and an empty acceptance ledger. It preserves recorded history, company accounts,
construction and acquisition receipts; continuation refreshes current/future
forecasts through the existing data-loaded owner.

## Historical context, not reconstructed utility books

[CVPS's 2006 Form 10-K](https://www.sec.gov/Archives/edgar/data/18808/000001880807000013/fnl10k.htm)
describes long-term purchases alongside hourly market balancing. Its quoted
nuclear and Québec costs inform the scale of the inherited game assumptions.
The [2011 Québec agreement filing](https://www.sec.gov/Archives/edgar/data/18808/000001880811000012/fm8k41811.htm)
describes a different real contract, delivered from November 2012 through 2038
with inflation and market indexing. It does not establish the game's $65 quote.
[Hydro-Québec's New England account](https://www.hydroquebec.com/clean-energy-provider/markets/new-england.html)
distinguishes physical interconnection capacity from agreement energy. The game's
five-year regional bridge and delivered-energy simplifications are authored
choices, not historical offers or claims of absolutely firm nuclear output.
