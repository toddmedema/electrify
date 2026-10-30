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
therefore use the shared fuel-heating archetype. Browser, worker, headless and
offline data entry points load all three records for Burlington. The shared
runtime retains its established 2019 historical cutoff; subsequent play uses
seeded weather forecasts, while the downloaded later observations remain on disk.

Calibration fixes each area's accounts, disables customer switching and growth,
and uses neutral pricing. It evaluates the real `areaBaselineDemand` and
`demandByTypeAt` helpers at every quarter-hour of the 2005 weather. Structural
end-use growth is frozen while fitting. Shape exponent is fitted to peak/mean;
scale is fitted second to annual delivered energy, using the game's normal
representative-day annualization. Account counts are never fitting parameters.

| Area      | Accounts / addressable pool |    Demand exponent |       Demand scale | Fitted annual MWh | Fitted peak MW |
| --------- | --------------------------: | -----------------: | -----------------: | ----------------: | -------------: |
| Champlain |            90,000 / 180,000 | 1.1099837624991467 |  6.595735259684209 |         2,000,000 |            352 |
| Valley    |           159,000 / 318,000 | 1.1856851657201783 | 4.1378209720279155 |         2,200,000 |            406 |
| Ridge     |            50,000 / 100,000 | 0.9882172536490237 |  5.877229717601884 |         1,000,000 |            160 |

`src/data/UtilityExpansion.test.ts` checks annual energy within 5% and peak within
10%. Explicit sector mixes retain each sector's daily profile rather than being
renormalized away at every tick, so Ridge's larger industrial share is steadier.
Old callers retain their original demand calculation exactly. Later regional
end-use trends continue normally; no data-center or mining block is scheduled.
The locations share correlated Vermont weather: owning another utility does not
guarantee weather diversification.

Existing Champlain and Valley hydro plants have bounded, explicitly fictional
inherited inventory claims. The catalogue provenance names the issue rather than
claiming these are researched historical sites. No new conventional hydro,
pumped hydro, geothermal or inland offshore wind is offered. Acquired reservoirs
activate at half full.

## Balance and regression evidence

The reusable fixture is `src/testing/UtilityExpansionBalanceFixtures.ts`; the
runner is `src/testing/UtilityExpansionBalance.sim.test.tsx`. Routine CI runs eight
representative full-term cases and audits residual values at all five
difficulties. The full authoring matrix uses seeds 12345, 1 and 7 at every
difficulty, covering 195 runs: a line-only control and unprepared financed
acquisition for each target; firm and mixed portfolios with both cash and loan
purchases for each target; and a financed acquisition of both utilities.

```sh
ELECTRIFY_EXPANSION_BALANCE=full \
ELECTRIFY_EXPANSION_BALANCE_REPORT=/tmp/electrify-expansion-balance.json \
npm run test:once -- UtilityExpansionBalance --runInBand
```

The identical annual tariff strategy follows the existing competitor benchmark
from the initial $0.105/kWh for every case. Lines begin at month 0; the first
financed purchase occurs at month 96 (January 2013). Cash strategies buy at month
100 (May 2013), reserving working capital for a cheaper 150 MW local gas peaker
instead of the first CC unit. These are distinct purchase and construction plans,
not an isolated comparison of borrowing costs. The firm portfolio adds 100 MW
Champlain gas CC units at months 0, 60 and 144, plus 150 MW local gas CC units in
the acquired area at months 96 and 156 when financed; cash plans replace the
month-96 CC with the month-100 peaker. The mixed portfolio replaces the month-60
unit with 200 MW wind and the month-156 unit with 300 MW local wind. The both-target
case also buys Ridge at month 108 and builds its local 150 MW CC units at months
108 and 168. All construction follows ordinary financing and lead times. Original
Champlain oil A retires at month 180; acquired oil assets retire at month 216.
Controls omit acquisition deliberately; unprepared cases omit added generation.

Reports separate physical survival from mission completion, and explicitly mark
whether a run reached the 2017 supply reduction, 2023 acquired-oil deadline and
2024 retention evaluation. An early loss is not evidence about a later event.
Local meters retain delivered energy, demand, gross imports (including physical
internal support), emissions and the worst constrained margin. Consolidated
imports remove internal transfers, while network and debt costs remain booked
once. The report records its generated simulation compatibility ID and base
revision; full matrices must be regenerated when relevant behavior changes.

The initial CEO Valley cash plan at month 96 could not fund both acquisition and
the first CC: it left $27.22–28.07M for firm portfolios against roughly $49.8M
down, while mixed portfolios were $1.33–2.23M short of the acquisition itself.
Waiting until January 2014 made both transactions affordable but left the new
plant unfinished during 2016 shortages. The May 2013 cash/peaker plan clears
both working-capital and construction constraints without changing source
prices, difficulty, tariff strategy or reliability rules.

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

## Production bundle budget

Compared with dependency commit `86850f16`, the frozen production build adds
36.10 kB gzip across all JavaScript (2.30%), from 1566.29 to
1602.39 kB. The increase is the operating-area engine, catalog, acquisition UI and
save validator, including the existing simulation worker variants; it adds no npm
dependencies. The total-JavaScript budget increases by exactly those 36,098 bytes
to retain its existing headroom. Main JavaScript, CSS, tick-performance ceilings
and the 10% bundle tolerance remain unchanged.
