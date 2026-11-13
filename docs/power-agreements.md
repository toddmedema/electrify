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
inherited coverage ends on 1 January 2025. These authored prices remain the
inflation-indexed ceilings for inherited v3 terms; their duration discount and
current-market cap apply below. Existing v1/v2 prices continue following their
original inflation rule. Nuclear's zero operational emissions remain confined to
its inherited contract; regional replacements use regional market emissions.

Only the authored scenario 116 offers replacements, including in co-op. Modded
and custom scenarios cannot accept these products. Existing v1/v2 Québec
replacement blocks retain their $65/MWh authored 2005-dollar price; regional firm
blocks retain $70/MWh. All new offers use v3 terms, with an integer choice of
1–10 calendar years. The authored five- or ten-year duration remains the default.
The discount rises linearly from 1% at one year to 20% at ten years. New offers
anchor their undiscounted ceiling to the connection's current regional spot
price at signing, so their initial rate is exactly 1% or 20% below that price at
the duration endpoints. The ceiling follows CPI relative to the signing month.
Inherited v3 terms retain their authored 2005-dollar ceilings and canonical end
dates, with the discount clamped at ten years. At every dispatch interval the
rate is the lower of that source's CPI-indexed ceiling and the connection's
unchanged current regional market price, multiplied by one minus the duration
discount. This is an explicit game guarantee, including when spot falls; it is
not a claim that real PPAs always beat spot.
A one-year market price is at least 1/0.99 times the agreement price, exceeding the
requested 0.5% premium. The market itself is unchanged for uncovered purchases.

The v3 minimum is 70% of supplier-available monthly covered MWh. Actual delivered
energy is paid at its interval rate. At the exclusive calendar-month or term end,
one top-up pays for any unused minimum energy at the month's availability-weighted
agreement rate. Consumption can move between hours within the month and all useful
MWh count against the minimum. Unused credit does not roll into another month.
Existing saved v1 pay-as-delivered and v2 whole-available-block promises retain
their original pricing, duration and billing. The two-year review window, 95%
delivery and $0 upfront payment remain game assumptions.

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
term. Reviews disclose the monthly energy minimum, inflation rule and below-market cap.

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
source budget. New v2/v3 committed products buy firm access up to the unscaled purchased
access ceiling, while merchant access retains its weather/scarcity scaling. Both
remain constrained by the scaled gross supplier pool: firm access never creates
extra generation. Where purchased access is lower than that pool, firm commitments
can serve demand that the buyer's merchant allocation cannot. The inherited regional
routes currently expose the entire supplier pool as access, so direct solo reliability
can be equal even with firm terms. Committed blocks serve load before legacy
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
bill is about $218M without replacements and $300M with them. These earlier terms hedge market exposure without promising cheaper energy.
New v3 rates have the explicit below-market cap, while unused minimum payments
can still outweigh that rate discount. No agreement eliminates shortages.

For the earlier v2 fixed-block obligations, matched 24-month Employee runs with seed
12345 and strategy `none` compare the pre-minimum implementation at `9dd567c3`
with the minimum implementation at `ebc19f96`. Ending cash changes from about
$238M to $216M and total expenses from $314M to $336M. Both serve all 4.1 TWh of
requested energy, end with 97,270 customers, and emit 440,414 tons. The roughly
$22M additional cost is payment for available but unused inherited supply; the
minimum does not create physical imports or emissions. The full scenario sweep
also retains its economic invariants. These measurements describe the authored
opening contracts, not a promised saving from a replacement offer.

The matched current v3 run (24 months, Employee, seed 12345, strategy `none`)
ends with about $274M cash and $277M total expenses. It likewise serves all
4.1 TWh, retains 97,270 customers, and emits 440,414 tons. The below-market rate
cap and 70% monthly energy minimum reduce costs from the earlier v2 terms in
this opening-contract comparison; the physical outcome is unchanged.

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

Schema 11 versions accepted receipts separately from inherited terms. Schema 12
adds v3 monthly-energy terms without rewriting any v1/v2 contract, cash or history.
Only new games inherit v3 terms; all newly accepted offers use v3. The schema-10
migration still explicitly preserves v1 pay-as-delivered contracts unchanged.
Per-agreement monthly accounts retain available MWh, useful MWh and payments.
V3 also retains available value and useful value at actual interval rates: an open
month's payment equals useful value; a closed month's payment adds the uniquely
derived unused-minimum top-up. Accounting start and exclusive accounted-through
boundaries persist after expiry. Partial accounting starts at the first observed
interval and never reconstructs unknown earlier usage.

The parser rejects noncanonical identities, versions, duration choices, dates,
discontinuous months, useful energy above availability, energy above canonical
coverage and elapsed time, inconsistent payment arithmetic, and weighted values
outside the positive spot floor and indexed ceiling. Aggregate meters prove
internal arithmetic and bounded exposure, rather than replaying an unrecorded
hourly price history. Inflation-dependent checks finish after economic data loads
and before the saved grid opens. Receipt/account limits derive from the five
canonical blocks and the maximum possible one-year renewal cycles before 2025.

Accepted receipts persist block/cycle identity, acceptance minute and resolved
start/end; v3 also persists its canonical integer duration, undiscounted signing
spot and signing temperature. Each v3 replacement derives its own real price
ceiling by dividing that spot by the signing month's CPI index. The parser
reproduces the seeded spot from the acceptance minute, run context and stored
temperature, which must be finite and between −100°C and 100°C. This proves the
price follows the canonical market formula; it cannot independently authenticate
historical temperature after those hourly frames leave the rolling timeline.
Capacity and emissions still derive from canonical authoring. The public action
accepts only block identity, duration and the reviewed quote key; the reducer
computes the signing snapshot itself. The save parser rejects forged terms,
duplicates, overlap, unknown blocks, acceptance before ownership and invalid
inherited interfaces. The schema-9 migration adds only already-owned interfaces
and an empty acceptance ledger. It preserves recorded history, company accounts,
construction and acquisition receipts; continuation refreshes current/future
forecasts through the existing data-loaded owner. Private forecasts advance their
own monthly meters at every elapsed interval; current-frame redispatch and pre-roll
never write the live ledger.

Reviews bind coverage, the current signing quote and delivery term. Confirmation
records the actual acceptance time. Changes to the signing market conditions or
delivery month require a fresh review; the review modal pauses ordinary play.

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
guaranteed discount; the original v2 full available-block product was an authored choice.

## V3 calibration provenance

The [EPA/DOE/NREL purchasing guide (2018)](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P100V9GG.TXT)
explains that short contracts can cost more and longer commitments reduce supplier
risk. [KYOS's September 2025 PPA assessment, page 2](https://www.kyos.com/app/uploads/2025/09/KYOS-PPA-Report-Sep-2025-No15.pdf)
uses a 20% risk discount against modeled ten-year capture prices. That is a model
assumption, not an observed transaction discount or a baseload wholesale saving.
The [UK government's corporate PPA evidence (2026), section 4](https://www.gov.uk/government/calls-for-evidence/corporate-power-purchase-agreements/corporate-power-purchase-agreements)
describes typical 10–15-year terms, CPI linkage and the higher volume risk borne by
firm baseload suppliers. These support the direction and scale of the game rule;
1% at one year and linear interpolation are explicit balancing choices.

[Manhattan Resources' June 2016 issuer circular, sections 7.2–7.3](https://links.sgx.com/FileOpen/Manhattan%20Resources%20Limited_Circular%20dated%2014%20June%202016.ashx?App=Prospectus&FileID=29298)
describes a negotiated monthly minimum purchase, without publishing a percentage.
The [Luminant/Bitfury January 2020 filed term sheet](https://www.sec.gov/Archives/edgar/data/1819989/000119312521161188/d127963dex1019.htm)
proposes 66.7% annual-average take-or-pay with seasonal selections; it is not
proof of a final flat monthly commitment. [APP's July 2024 developer presentation,
slide 24](https://www.aler-energia.org/contents/activitieseventsspeakersdocuments/64-app-apresentacao-seminario-aler_julho-2024_v2_compressed_compressed-1.pdf)
describes monthly invoicing and 80% of project generation take-or-pay, rather than
80% of nameplate capacity in every hour. The game's 70% monthly available-energy
floor, unrestricted intramonth flexibility and outage proration are informed game
calibration, not a universal industry rule. Retail avoided-bill savings and solar
capture-versus-baseload differences are not used as wholesale discount evidence.

## Decision forecast

The selected agreement is compared against otherwise identical ordinary market
purchases through its exact exclusive delivery end, including years beyond the
mission. Both branches use the real forecast reducer and the same seeded expected
weather. Only the assessed agreement is omitted in the market branch; its wire,
other agreements, current fleet, trading rules, policies and scheduled effects stay
in place. The Forecasted savings row shows the signed difference in closing
company cash, including customer and export income, all operating and financing
costs, and unused minimum payments. A loss remains a negative amount. It is future
nominal money, undiscounted, not agreement profit or an equivalent-energy price
saving.

This decision comparison uses the same 15-minute intervals as live settlement.
The general hourly outlook remains a sampled estimate and can approximate contract
changes inside a sample when opened between hours.

The reducer also computes each alternative's requested and served customer energy
internally; the terms table displays the cash comparison over the selected
term. Offers compare the full delivery term, while signed agreements compare the
remaining term. Recorded use and payments appear separately with their accounting
start date, including for expired accounts. Earlier missing history is identified.
Inherited signing dates remain unknown. A comparison with market buying disabled
is unavailable. Co-op comparison is unavailable until complete world context can
be forecast. Recorded history remains accessible in both cases.

Changing the duration updates the quoted terms immediately and launches a worker
comparison when the slider change is committed. A new comparison key cancels the
previous worker, and only the latest request can supply the savings row. Both runs
execute off the main thread. A bounded result cache and shared with-agreement
baseline avoid repeated work. Monthly and meaningful decision changes invalidate
the general projection. V3 agreement comparisons additionally bind their current
cutoff and weighted monthly meter, so a changed duration or updated actual use
cannot reuse a stale result.
The general projection signature stays stable across ordinary ticks; stale request
IDs are discarded. Forecast results retain their exact accounting
cutoff: newer live actuals are never added to an overlapping cached remainder.
Unavailable, loading, updating, error and retry states keep acceptance accessible.
