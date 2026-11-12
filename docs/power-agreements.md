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
$0 upfront payment are game assumptions. New contracts commit the whole deliverable
block whenever the supplier is available: there is no arbitrary minimum utilization
fraction. Existing saved contracts retain their pay-as-delivered terms.

A block becomes reviewable 24 calendar months before its loss. On-time acceptance
starts at the loss boundary. Late acceptance starts at the strictly next calendar
month; acquisition never backdates a replacement. The same product can replace
an accepted agreement when its term ends, provided new delivery starts before
1 January 2025. Accepted delivery may extend beyond that finish date.

## Dispatch and persistence

The interface shows only maximum deliverable coverage, rather than both nominal
and deliverable capacities. Prices are shown in today's money with their inflation
rule. The market comparison uses the same current spot price as the connection,
including current conditions; it is not a forecast of prices over the agreement's
term. Reviews disclose the minimum purchase and that covered purchases retain the
agreed rate even when market prices fall.

Active agreement slices serve purchased customer energy before residual market
purchases, ordered by agreed price and stable identity. Local generation can displace
physical deliveries, but cannot remove the minimum payment. Supplier-ready minimums
are allocated before buyer decisions, within the commissioned route's weather and
incident rating, purchased access, and upstream source budgets. Buyer pause is
ignored only for this availability calculation; physical flow still stops.
Physical outages and source scarcity reduce the minimum; low customer demand,
market-buying settings, and buyer pause do not. There is no extra penalty, banking,
refund, or make-up right. Unused minimum charges are import expenses and create no
energy, emissions, storage, export revenue, or change to physical-flow price averages.

Co-op clears supplier-ready commitments once in stable company order with a
separate commitment budget. Every company's useful contract delivery is physically
reserved before any residual spot purchase. Unused commitments can release physical
energy for spot purchases, without enlarging another company's payable minimum.
Legacy pay-as-delivered purchases use remaining supply after fixed commitments.
Contract and market flows consume one physical line rating and the same regional
source budget. New fixed-block products buy firm access up to the unscaled purchased
access ceiling, while merchant access retains its weather/scarcity scaling. Both
remain constrained by the scaled gross supplier pool: firm access never creates
extra generation. Where purchased access is lower than that pool, firm commitments
can serve demand that the buyer's merchant allocation cannot. The inherited regional
routes currently expose the entire supplier pool as access, so direct solo reliability
can be equal even with firm terms. Paid fixed blocks serve load before legacy
pay-as-delivered imports; unused commitments still cannot supply exports or storage.

Terms are half-open `[startMinute, endMinute)`. Completed elapsed intervals alone
append actual accounts and reduce cash. Initial dispatch, current-frame reforecasts,
month-opening pre-rolls, and paused clocks cannot accrue actual energy or payments.
The final elapsed interval before expiry is settled before the expired preview.
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

The earlier interface-only comparison, with pay-as-delivered agreements, used
seed-12345 Employee playthroughs with the same acquisition and retirement
actions. Opening-year import costs moved by about
$231 on an $83.47M total. The old inherited-only routes stopped in month 183;
retained connections now let both routes play the full 240 months, although
surviving the supply withdrawal does not guarantee that all mission goals pass.
In 2020, the Valley route buys about 1,282 GWh from the market without replacements,
6 GWh with on-time replacements, or 126 GWh when signing late. Ridge's respective
figures are 1,308, 279 and 461 GWh. These are annualized recorded flows in the
representative-day model. Whole-company dispatch and retained customers also
change, so the runs are not an isolated price sensitivity: Valley's 2020 import
bill is about $218M without replacements and $300M with them. Agreements hedge
market exposure; they do not promise cheaper energy or eliminate shortages.

For the new fixed-block obligations, matched 24-month Employee runs with seed
12345 and strategy `none` compare the pre-minimum implementation at `9dd567c3`
with the minimum implementation at `ebc19f96`. Ending cash changes from about
$238M to $216M and total expenses from $314M to $336M. Both serve all 4.1 TWh of
requested energy, end with 97,270 customers, and emit 440,414 tons. The roughly
$22M additional cost is payment for available but unused inherited supply; the
minimum does not create physical imports or emissions. The full scenario sweep
also retains its economic invariants. These measurements describe the authored
opening contracts, not a promised saving from a replacement offer.

The cash-funded Valley mixed reference plan also changes its capital timing to
cover these obligations. It orders its planned 150 MW gas peaker in month 72
instead of 84, and its first 200 MW wind farm in month 120 instead of 60. Every
plant size, financing choice and retail-rate action stays the same. The earlier
peaker bridges the acquired demand while wind is built, and the later wind order
preserves the cash acquisition reserve. At CEO difficulty with seed 12345 and a
month-108 purchase, the plan completes all four mission goals and serves 99.957%
of lifetime demand. Its lowest month-end cash is about $24.8M and its final cash
about $1.070B; retained customers are 130.1% of the expanded retention baseline.
These are outcomes of one paid operating plan, not guaranteed acquisition returns.

Schema 11 versions accepted receipts separately from inherited terms. New games
inherit fixed-block obligations from ownership, and all newly accepted offers bind
fixed-block terms in their quote keys. The schema-10 migration explicitly preserves
legacy pay-as-delivered contracts without changing recorded cash or history.
Per-agreement monthly accounts retain supplier-available MWh, useful MWh and
payments, with accounting start and exclusive accounted-through boundaries,
including after expiry. Partial accounting starts at the first observed interval;
it never reconstructs unknown earlier usage. The parser rejects noncanonical
identities, versions, dates, discontinuous months, useful energy above availability,
energy above canonical coverage and elapsed time, or inconsistent payment arithmetic.
Inflation-dependent payment checks finish after economic data loads and before the
saved grid opens.

Accepted receipts persist block/cycle identity, acceptance minute and resolved
start/end. Capacity, price and emissions are derived from canonical authoring.
The reducer revalidates the reviewed quote; the save parser rejects forged terms,
duplicates, overlap, unknown blocks, acceptance before ownership and invalid
inherited interfaces. The schema-9 migration adds only already-owned interfaces
and an empty acceptance ledger. It preserves recorded history, company accounts,
construction and acquisition receipts; continuation refreshes current/future
forecasts through the existing data-loaded owner.

Reviews bind the agreed coverage, real price and delivery term rather than a
particular clock tick. Confirmation records the actual acceptance time, while a
change to the delivery month requires a fresh review.

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

The [2011 Seabrook announcement](https://newsroom.nexteraenergy.com/Green-Mountain-Power-Strikes-Long-Term-Low-Cost-Power-Deal-With-NextEra-Energy-Resources?l=12)
describes a 23-year agreement with inflation adjustment and changing delivery
volumes. [VEC's 2021 audited accounts](https://vermontelectric.coop/client_media/files/FINAL_Financial_Audit_Report_for_2021.pdf)
describe both a twenty-year nuclear contract and a four-year shortfall purchase.
These support offering long-term supply and shorter bridge products; they do not
establish the game's replacement prices or its simplified payment terms.

The [World Bank PPA overview](https://ppp.worldbank.org/sector/energy/energy-power-agreements/power-purchase-agreements)
describes purchase obligations and capacity payments even when buyers do not take
energy. The [DOE PPA overview](https://www1.eere.energy.gov/wip/solutioncenter/pdfs/exploringpowerpurchaseagreementsthebasicspart1.pdf)
describes commitments to purchase delivered output. These support modeling an
explicit commitment, but do not establish a universal minimum percentage or a
guaranteed discount; this game's full available-block product is an authored choice.

## Decision forecast

The selected agreement is compared against otherwise identical ordinary market
purchases through its exact exclusive delivery end, including years beyond the
mission. Both branches use the real forecast reducer and the same seeded expected
weather. Only the assessed agreement is omitted in the market branch; its wire,
other agreements, current fleet, trading rules, policies and scheduled effects stay
in place. The headline cash benefit/cost is the difference in closing company cash,
including customer and export income, all operating and financing costs, and unused
minimum payments. It is future nominal money, undiscounted, not agreement profit
or an equivalent-energy price saving.

This decision comparison uses the same 15-minute intervals as live settlement.
The general hourly outlook remains a sampled estimate and can approximate contract
changes inside a sample when opened between hours.

Each demand-served percentage divides served customer energy by that alternative's
own requested customer energy over the displayed term. Customer retention can
change both denominators. Missing market energy is never treated as comparable
cheap energy, and equal service shares are explicitly shown. A comparison with
market buying disabled is unavailable rather than silently enabling purchases.
Co-op forecasting is unavailable until it can use complete world context; observed
usage and payments remain accessible in both cases.

Offers show the full delivery term; existing agreements show remaining-term cash
and service. Recorded and projected energy are added before dividing to show
full-term use where history is complete, or an explicitly dated since-recording
estimate where it is partial. Inherited signing dates remain unknown. Expired
accounts remain accessible. No observed historical counterfactual is invented.

The existing persistent projection worker serializes data loading and performs
both runs off the main thread. A bounded result cache and shared with-agreement
baseline avoid repeated work. Monthly and meaningful decision changes invalidate
it, and stale request IDs are discarded. Ordinary ticks update observed progress
without launching new paired runs. Forecast results retain their exact accounting
cutoff: newer live actuals are never added to an overlapping cached remainder.
Unavailable, loading, updating, error and retry states keep acceptance accessible.
