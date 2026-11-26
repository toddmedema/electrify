# Across the Valley

Scenario 116 is a fictional Vermont Investor utility, January 2005–December 2024.
Acquire three competing utilities by December 2014. Build facilities, sign power
agreements, and connect
individual building sites as your service area grows.
All owned customers and facilities share one company power pool. Location controls
finite suitable sites. Connecting uses the existing tile price; there is no
additional line project, transfer bottleneck or recurring connection fee. Human
co-op companies remain independent, with new empty-land claims accepted once in
host command order.

Inherited nuclear and Québec hydro commitments retain their original dates.
Each deal transfers the customers and sites shown in its review. Regional deals
also transfer operating plants, debt, and inherited power contracts. A PPA with
the acquired seller ends as an external delivery and charge. Visible unowned
tiles touching physically owned company land are purchasable; a PPA extends sight
without granting purchase adjacency. General land, mixed-demand cities, and
special hydro or geothermal sites have distinct cash prices and benefits. See
[territories](territories.md) for site budgets, accounting and legacy-save conversion.

The map uses a low-poly 3D hex board, following the visual direction in
[issue 603](https://github.com/toddmedema/electrify/issues/603). Small, medium and large cities indicate
customers. Plains, forest, hills, mountain, river and lake have distinct
terrain meshes, with separate upright cities, generators, storage and towers.
The simulated day drives sun/moon lighting and simple shadows. The map requires
WebGL2. See [the 3D style](map-3d-style.md).
Each hex holds one facility or a city; construction reserves its slot immediately.
Independent utilities show their authored starting fleet. Empty developed hexes
show towers and automatic wires to adjacent developed cells of the same utility.
Selecting an individual hex opens its floating facility, city or construction
surface. Empty owned tiles select their build destination automatically. The Rapid connection mode
icon toggles repeated connections with visible prices along owned borders.
**Build** lets players choose a technology and size first, then compare compatible
connected and unconnected sites. Inspection spends nothing. The selected site
shows connection and project costs, expected output and commissioning date; only
explicit confirmation connects the site and starts construction.
The map stays visible while Fleet, Agreements and the other dock icons open one
inspection or tool panel; selecting the active icon closes that panel. There is no
separate Map button. Acquiring land
or connecting to a utility reveals up to three hexes farther into the fixed
196-hex board, with progressively faded terrain and structures. Coordinate-based
generation restores terrain recorded in older saves. The wires are visual and add
no transmission management. Utility names
float above their land, with the player labeled “You” and distinct ownership borders.
Neutral land has no proper name; symbols show its benefit. Native map buttons support
keyboard, touch and controller selection without a numbered key.

Towns add homes, shops and workshops as their modeled long-term residential,
commercial and industrial demand grows. Each January the map compares the
town's public sector profile with its opening profile. A sector adds one block
once its increase reaches 5% of the town's opening demand across those three
sectors. The buildings reflect regional market growth and each town's starting
demand mix. The city inspector shows current demand for owned cities and
estimated demand elsewhere.

## Champlain Valley-inspired geography

The board is a schematic, not a surveyed map, a fixed-area GIS grid or a
reconstruction of 2005 utility boundaries. The
[Vermont biophysical regions map](https://efotg.sc.egov.usda.gov/references/public/VT/Bio_Region.pdf)
and [Lake Champlain Basin Program topography](https://atlas.lcbp.org/nature-environment/geology/)
provide its broad organizing pattern: western lake and lowlands rising toward the
Green Mountains in the east. Existing river cells suggest the Winooski settlement
corridor. They do not trace its course or establish real plant locations.

The authored override map in `src/data/TerritoryTiles.ts` makes Champlain sites
1–7, 12 and 13 plains, together with green-uplands sites 2, 3 and 6. Valley sites
3 and 8 and Ridge site 10 form additional mountain ground to the east. Existing
forest pockets, both western lake cells, river cells and inherited wind terrain
remain. No water cell consumes an existing land reservation, and no ocean, hydro
claim or geothermal resource is added. A fixed border of versioned terrain
cells rounds out the authored board.

The authored cities represent Burlington on the lake side of the board, Winooski
on the river to its northeast, and Williston to the southeast. Vergennes and
Middlebury extend the western settlement corridor southward, with Bristol
inland and Waterbury farther east. The
[Vermont municipal map and population counts](https://outside.vermont.gov/dept/sos/Services/LAB/LAB%20Senate%20Map%20FINAL%20SMD%202021%201129.pdf)
guide relative placement and the small, medium, and large artwork tiers. The
utilities retain their fictional service-area customer totals and their existing
location metadata. The four smaller settlements each have a local utility and neighboring generation.

## Authored portfolios and historical references

The three utilities, their ownership, fleet capacities,
source entitlements, network costs, base prices, deadlines and geographic
service areas are game assumptions from [issue 683](https://github.com/toddmedema/electrify/issues/683).
They are not a reconstruction of Green Mountain Power, Central Vermont Public
Service, VELCO, Hydro-Québec or ISO New England ownership or contracts.

The scale references are GMP's approximately 90,000 customers, 2.01 TWh retail
sales, 351.9 MW peak and 10.38 cents/kWh blended rate in 2005
([GMP 2005 SEC report](https://www.sec.gov/Archives/edgar/data/43704/000004370406000023/gmpform10k2005.htm))
and CVPS's approximately 159,000 customers, 2.20 TWh metered sales and 406.1 MW
peak in 2010 ([CVPS 2010 SEC report](https://www.sec.gov/Archives/edgar/data/18808/000001880811000007/fm10kye2010.pdf)).
The reference years differ. CVPS's 2.36 TWh native-load supply requirement includes
losses and is not its metered retail energy. Ridge Electric is wholly fictional.

The 2011 CVPS acquisition headline was approximately $472.3M equity and $230M debt
([issuer announcement](https://www.sec.gov/Archives/edgar/data/18808/000114036111036498/ex99_1.htm)).
The [BLS annual CPI-U series](https://www.bls.gov/opub/mlr/2019/highcharts/data/paulin-fig2.stm)
converts these to approximately $410M and $200M in 2005 dollars, using
195.3/224.939. These are valuation references, not exact adjusted closing cash.
Regional base prices, assumed debt, fees and service-network O&M are authored
in 2005 dollars and indexed to the purchase month. In new games, regional and
municipal generators start between four and 30 years old, using the game seed
and each plant's identity. The regional equity quote replaces the original
opening fleet value in the base price with the seller fleet's current depreciated
value. Municipal quotes add the plant's depreciated value to the price of the
sites. Earlier saves retain their original seller ages and pricing rules.

The $0.105/kWh retail-style rate accompanies explicit service-network O&M; no
additional generation-share discount applies. Assumed loans use 5% fixed interest
and 240 remaining months, while new purchase borrowing uses the player's credit
rate and the existing 360-month purchase terms. Equipment carries its calendar
age and receives no new construction-emissions charge when acquired.

Purchased nuclear power has zero operating CO2, not zero lifecycle emissions.
Québec hydro purchases retain the existing Québec market intensity series.
Regional purchases and pools use the rounded ISO-NE Table 5.4 generation-intensity
proxy: 417 kg/MWh in 2005, 376 in 2010 and 354 in 2011, interpolated and held at
354 through 2024 ([ISO-NE 2011 emissions report](https://www.iso-ne.com/static-assets/documents/genrtion_resrcs/reports/emission/2011_emissions_report.pdf)).
These are average operating-generation intensities, not marginal or lifecycle
rates. Prices, source-interface ratings, fixed 95% deliverability and Valley's
January 2017 nuclear-cap reduction are authored assumptions; that date makes no
claim about Vermont Yankee's closure.

## Weather and demand calibration

The existing `scripts/fetch-weather.js` pipeline fetched separate 1980–2025 ERA5
records via Open-Meteo for Burlington (44.4759, -73.2121), Rutland (43.6106,
-72.9726) and White River Junction (43.6489, -72.3193). Each binary contains
13,248 hourly observations of the game's representative monthly days. All three
records resolve to `America/New_York`; all locations have `VT` state metadata and
therefore use the shared fuel-heating archetype. The merged company uses
Burlington weather for its one operating area. The other records remain authored
location data. The shared runtime retains its established 2019 historical cutoff; subsequent play uses
seeded weather forecasts, while the downloaded later observations remain on disk.

Seller-profile calibration fixes each utility's accounts, disables customer
switching and growth, and uses neutral pricing. It evaluates the real `areaBaselineDemand` and
`demandByTypeAt` helpers at every quarter-hour of the 2005 weather. Structural
end-use growth is frozen while fitting. Shape exponent is fitted to peak/mean;
scale is fitted second to annual delivered energy, using the game's normal
representative-day annualization. Account counts are never fitting parameters.

| Utility   | Accounts / addressable pool |    Demand exponent |       Demand scale | Fitted annual MWh | Fitted peak MW |
| --------- | --------------------------: | -----------------: | -----------------: | ----------------: | -------------: |
| Champlain |            90,000 / 180,000 | 1.1099837624991467 |  6.595735259684209 |         2,000,000 |            352 |
| Valley    |           159,000 / 318,000 | 1.1856851657201783 | 4.1378209720279155 |         2,200,000 |            406 |
| Ridge     |            50,000 / 100,000 | 0.9882172536490237 |  5.877229717601884 |         1,000,000 |            160 |

`src/data/UtilityExpansion.test.ts` checks annual energy within 5% and peak within
10%. The acquired portfolio contributes to one combined demand profile and sector
mix; it does not keep its own customer population, weather or dispatch.
Old callers retain their original demand calculation exactly. Later regional
end-use trends continue normally; no data-center or mining block is scheduled.
Acquired facilities join the existing fleet and use the same operating-area
weather. Local [terrain modifiers](terrain-modifiers.md) adjust onshore wind speed
and construction costs across technologies.

Existing Champlain and Valley hydro plants have bounded, explicitly fictional
inherited inventory claims. The catalogue provenance names the issue rather than
claiming these are researched historical sites. No new conventional hydro,
pumped hydro, geothermal or inland offshore wind is offered. Acquired reservoirs
activate at half full.

## One combined company

An acquisition adds the seller's current customers and addressable market once.
After that transfer there is one customer count, one demand profile, one fleet,
one policy ledger and one dispatch calculation. All generation and storage can
serve the combined load. There are no service-area selectors, separate customer
retention tests or internal transfer-capacity constraints.

The combined demand profile blends the authored portfolios using their fixed
customer counts to weight demand scale and shape. Sector shares use customer
counts multiplied by demand scale. The resulting composition applies to one
evolving company customer count and Burlington weather. Customer switching and
growth apply to the whole company. Existing customer-program installations, stored
energy, incentives and historical benefits are preserved at their actual amounts;
buying customers does not install another copy of that equipment.

Acquisition receipts retain target identity and timing for purchased-power
contracts, scenario progress, and transaction validation. Corporate borrowing
and the non-resellable service-network assets remain in their financial ledgers.
They do not track separate operating customer populations. Network impairment
uses combined company retention while each asset keeps its purchase vintage and
480-month depreciation schedule.

A purchase during Keep playing leaves the recorded mission result final.
Valley's nuclear purchase drops from 160 MW to 80 MW in January 2017, and all bounded
purchased-power rights serve the combined company without external resale.

Inherited Ridge gas keeps a fixed $147,475 opening cold-weather package value,
quoted by the normal winterization owner for 100 MW in January 2005. This authored
book component keeps offline save validation exact; new construction and
retrofits continue to use current dated quotes.

## Renewal and replacement decisions

The service network has an inherited cost floor. Its annual operating cost scales
with the combined customer's count relative to the acquired portfolios' authored
opening accounts, with no discount below that opening cost. Routine maintenance
and renewal are included in this operating budget and follow ordinary monetary
inflation; there are no dated renewal-cost jumps. The opening costs are authored
game assumptions, not estimates of historical Vermont utility spending. The live
simulation, forecasts and company offers use the same `utilityNetworkAnnualOM`
owner. Offers show the incremental combined-company cost, which can differ from
the seller's standalone cost.

The dated purchased-power changes are visible before acquiring a utility.
Valley's nuclear right falls from 160 to 80 MW in January 2017 (152 to 76 MW
deliverable). In January 2020, Champlain's 100 MW nuclear right ends, both Québec
rights fall from 120 to 60 MW (114 to 57 MW deliverable), and Ridge's firm pool
falls from 40 to 20 MW (38 to 19 MW deliverable). Remaining agreements retain
their existing real prices. Players must sign finite replacements or build supply;
there is no unlimited regional-market fallback. The Valley reminder arrives in
2013, and the common 2020 change is announced in 2016.

Use **Acquire** from any competitor's tile to review price, customer transfer,
sites, and expected supply margin. Municipal offers include the plant being
removed and the cost of each site. Regional offers include financing, operating
plants, and dated power contracts. Confirmation requires a shared border, an up-to-date
quote, and enough cash. Agreements display forecasted cash impact against
omitting the agreement rather than assuming unlimited substitute purchases.

Scenario's Supply plan shares the existing tariff-sensitive projection. It shows
the next year's customer count and peak demand, the first projected month below
the difficulty's service threshold and future contract limits. Preparation dates use the real dated, difficulty-scaled quote
for a reference 150 MW combined-cycle plant. Other projects and demand programs
remain choices; the reference does not claim to cover the whole forecast gap.

Community mods can use Across the Valley as a base while keeping its 2005
Burlington opening, 90,000 customers, demand profile, starting fleet and 240-month
term. Cash, tariffs, construction/program modifiers and authored events remain
customizable. Its four obligations are inherited unless the package replaces
them. Importing only its official arc into another base adds no global shock:
utility ownership and dated seller contracts belong to the expansion base.

## Verification and balance

The reusable fixture is `src/testing/UtilityExpansionBalanceFixtures.ts`; the
runner is `src/testing/UtilityExpansionBalance.sim.test.tsx`. Full authoring
coverage uses seeds 12345, 1 and 7 at every difficulty: each target with cash and
financed purchases, firm and mixed portfolios, independent-generation and unprepared controls,
and an optional purchase of both targets.

```sh
ELECTRIFY_EXPANSION_BALANCE=full \
ELECTRIFY_EXPANSION_BALANCE_REPORT=/tmp/electrify-expansion-balance.json \
npm run test:once -- UtilityExpansionBalance --runInBand
```

Reports record company-wide energy, finances, customer retention, accepted
transactions and the acquisition outcome. Early losses are not evidence about
later events. Current-format saves persist the aggregate customer and market
totals, transaction and financial ledgers, and one forecast timeline.

The land-development playbook buys one tile in the original larger general-land
area for one seventh of its former $18M cash price, builds 100 MW of wind there,
and completes the 240-month scenario
alongside a prepared Valley acquisition at every difficulty. The land purchase
reduces cash available for facilities while its non-depreciating value preserves
net worth. Separate controls check that unused finite agreements still charge
their minimum and that signing a neighbor PPA cannot create duplicate power
after buying its seller.

Prepared cash and financed portfolios track full-term service, acquisitions, customer
retention and financial invariants. Unprepared acquisition controls must
expose the 2020 loss of contracted coverage instead of receiving free replacement
market access. CEO cash plans also exercise neighboring acquisition dates in
January, March and May 2014. Report current integrated outcomes with the PR;
historical physical-routing results do not establish this revision's balance.

The save regression uses a normal first-year rollover with inactive optional
customer-battery meters, raw validation before JSON normalization, and a full
IndexedDB write/read/reopen. Chart accumulation omits absent optional meters while
preserving zero values. Malformed untrusted chart records remain rejected. This
catches the annual autosave failure that JSON-only round trips had hidden.
An additional regression plays a natural early acquisition through a terminal
reliability loss, then writes and reopens its raw result in IndexedDB. The immediate
ownership verdict omits a cleared optional reason instead of retaining an own
undefined value; strict untrusted-result validation remains unchanged.

## Production performance

The combined-company model uses the original tick and bundle budgets from
`master`, with the existing 10% bundle tolerance. Current production measurements
are reported with the integrated PR checks. No npm dependencies are added.
Web and desktop production builds use two Terser compression passes while
preserving CRA's other compiler and profiling options and the existing bundle ceilings.
Scenario 116's economic outputs reflect the combined
model; earlier scenarios retain their seeded economic outputs. Six variant
result hashes also reflect the clarified retention-definition text. Restoring
only that sentence in memory reproduces all six earlier hashes exactly.
