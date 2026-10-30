# Across the Valley

Scenario 116 is a fictional Vermont Investor utility, January 2005–December 2024.
A completed Tier-1 connection to Valley Electric or Ridge Electric unlocks that
utility's acquisition. Optional upgrades buy transfer capacity, not permission to
acquire. Human co-op companies remain independent.

## Authored portfolios and historical references

The three utilities, their ownership, acquisition prerequisite, fleet capacities,
asset ages, source entitlements, network costs, prices, deadlines and geographic
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
All acquisition prices, assumed debt, fees and service-network O&M are authored
2005-dollar values; the transaction indexes once to its purchase month's nominal
money. Plant quotes and intertie costs retain their existing owners.

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
weather. Acquisitions do not add weather diversification.

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
contracts, retirement obligations and transaction validation. Corporate borrowing
and the non-resellable service-network assets remain in their financial ledgers.
They do not track separate operating customer populations. Network impairment
uses combined company retention while each asset keeps its purchase vintage and
480-month depreciation schedule.

The end-of-2024 retention goal is 90% of the original 90,000 customers plus the
customers transferred in purchases before that evaluation. A purchase during
Keep playing does not rewrite an already recorded mission result. The original
Oil A and acquired original oil retirement deadlines remain unchanged. Valley's
nuclear purchase still drops from 160 MW to 80 MW in January 2017, and all bounded
purchased-power rights serve the combined company without external resale.

Inherited Ridge gas keeps a fixed $147,475 opening cold-weather package value,
quoted by the normal winterization owner for 100 MW in January 2005. This authored
book component keeps offline save validation exact; new construction and
retrofits continue to use current dated quotes.

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
financed purchases, firm and mixed portfolios, line-only and unprepared controls,
and an optional purchase of both targets.

```sh
ELECTRIFY_EXPANSION_BALANCE=full \
ELECTRIFY_EXPANSION_BALANCE_REPORT=/tmp/electrify-expansion-balance.json \
npm run test:once -- UtilityExpansionBalance --runInBand
```

Reports record company-wide energy, finances, customer retention, accepted
transactions, timed obligations and outcomes. Early losses are not evidence about
later events. Current-format saves persist the aggregate customer and market
totals, transaction and financial ledgers, and one forecast timeline.
