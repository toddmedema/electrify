# Legacy campaign

The Campaign entry on Choose a game opens a fictional Northern California utility from
1882 through 2061. Each of its nine CEO terms lasts 240 simulated months. The existing
speed controls still simulate every tick; a completed objective never skips the remaining
years. The company pauses at a handover until the player continues or saves and exits.

| CEO term                               | Distinct required objective                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| First Light (1882–1901)                | December electricity revenue covers December operating costs by 1885.                                 |
| Beyond the Dynamo (1902–1921)          | End the term with 150% of opening customers, capped at 95% of the addressable market.                 |
| Affordable Growth (1922–1941)          | End the term with a billed rate within 110% of the frozen reference benchmark.                        |
| Everybody Plugs In (1942–1961)         | Achieve reachable supply headroom of at least 10% of the opening peak by 1952.                        |
| The Power You Don't Build (1962–1981)  | End the term saving at least 5% of eligible home and business electricity through efficiency.         |
| The Price of Power (1982–2001)         | Have cash covering one month of operating costs by 2000.                                              |
| The Sun Moves the Peak (2002–2021)     | End the term serving at least 99.5% of evening demand, between 17:00 and 21:00.                       |
| Renew the Grid (2022–2041)             | Retire oil equipment commissioned through 2000 by 2035.                                               |
| A Different Kind of Growth (2042–2061) | Keep cumulative operational, imported and construction emissions within the frozen whole-term budget. |

Only the first term initializes a company. Later terms preserve facilities and their purchased
engineering, construction progress, hydro-site claims, loans, cash, customers, price memory,
program cohorts, interties, and the continuous 1882-based clock. Customers are game-scale
accounts; a handover never replaces them with a new starting population. A company that avoids
oil or import dependence can legitimately avoid the corresponding shock.

Campaign saves are unranked. IDs 117–125 resolve native definitions without adding them to the
challenge catalog. Public links to any of these IDs open campaign setup. The headless simulator
can initialize the later definitions as independent balance fixtures; the player cannot use
them to bypass inheritance.

## Rules and money

Campaign goals have exactly two timing forms: **by YEAR** means one check at the end of
December of that year; an **undated goal** is checked once at the end of the CEO term.
A completed checkpoint stays complete. Earlier debt, prices, service or reserves do not fail
a goal, and later changes do not reopen a completed milestone. Monthly measurements use the
checkpoint month's data rather than a multi-year average. The carbon budget still counts
all term emissions, but its verdict is made only at term end. These timing changes apply to
campaign definitions; existing challenge and mod goals retain their authored behavior unless
explicitly marked as checkpoints.

Every term requires solvency. The customer-growth target replaces the 90% retention goal in
Beyond the Dynamo; the other terms retain that safeguard. Later terms add term-end debt and
billed-rate limits. Terms 7–8 also limit emissions intensity; the final term has a single
whole-term carbon budget without additional intensity checks. The historical task appears first, with shared
safeguards after it. The handover dialog previews the incoming CEO's exact goals by privately
running the same transition used by Continue; this neither advances nor replaces the live company.

Financial coverage excludes grants, capital purchases and loan principal; it includes fuel,
maintenance, imports, interest, carbon charges and program expenses. Efficiency uses measured
saved energy divided by eligible gross load, not the program switch or an unweighted average.
Evening service has its own tick-level energy meters. Reserve uses the lowest reachable headroom,
not nameplate capacity or an average that could hide shortages. Paused old oil plants still count;
newer replacements and equipment not yet commissioned by 2001 do not. A company that already
retired this cohort has legitimately fulfilled that goal. Missing measurements cannot earn a pass.

Each term's bounded rules compile on a local 240-month clock. The trusted runtime translates
events and reports to the continuous clock while objective evidence stays local. Completion
records archive their bounded evidence, recomputed verdicts, and debriefs. Save import checks
the generation sequence, physical and financial baselines, and evidence, including after the
global clock passes 1,200 months. These corruption checks do not authenticate edited saves.

Cash and purchases use the current year's nominal dollars. Campaign rate and debt goals are
frozen in the CEO term's final-year nominal dollars and compare directly with actual billed
rates and outstanding principal. Published targets are rounded to three significant digits;
the displayed value is the enforced limit. Large goal amounts use k/M/B suffixes. The
authored competitor benchmark is rebased at each handover, independently
from the player's price; price memory is preserved. Opening cash is the down payment for the
100 kW steam quote plus six months of opening forecast operating outlay.

Debt allowances scale with frozen opening peak demand. The authored 2023-dollar allowances per
MW are $20 million for terms 2–3, $30 million for terms 4–5, $20 million for term 6, and
$15 million for terms 7–9, converted to each term's final-year dollars. The conversion factors
are frozen with the company context and archived at handover, so cold imports do not need
economy data to interpret financial evidence. These are game parameters, not historical
borrowing limits. They make later borrowing depend on the inherited company's size.

The final carbon budget is a planning proxy: opening representative-month average demand,
annualized to 8,760 hours and twenty years, at 0.25 tonnes/MWh with a 1.3 demand allowance.
It is frozen before play and includes the simulation's operational, import, and construction
emissions. It is not a claim to predict twenty years of consumption or to reproduce SB 100.

These targets are authored board requirements, not historical regulations. The themes draw on
[early commercial electricity](https://edison.rutgers.edu/images/archive/innovations/EL/PearlStreetHeadnote.pdf),
[California's regional grid development](https://seuc.senate.ca.gov/background-electricity-policy),
[postwar electricity growth](https://docs.cpuc.ca.gov/published/report/3822.htm),
[the efficiency response to the 1970s crisis](https://www.energy.ca.gov/about/50-years-energy-leadership),
and [CAISO's evening flexibility analysis](https://www.caiso.com/Documents/FlexibleResourcesHelpRenewables_FastFacts.pdf).
Customer growth represents aggregate accounts, not equitable geographic access. The crisis goal
teaches liquidity under constrained supply: [GAO's account](https://www.gao.gov/assets/a234932.html)
also identifies market power and market-design restrictions, which this game does not reconstruct.
The oil cohort is a fictional modernization commitment, not a universal 30-year retirement law;
[California's cooling policy](https://waterboards.ca.gov/water_issues/programs/ocean/cwa316/index.html)
permits retirement, repowering and retrofits, with reliability extensions. The final budget is a
future planning exercise; [SB 100](https://www.energy.ca.gov/sb100) concerns annual retail sales,
not this simulation's cumulative lifecycle emissions measure.

## Historical data and explicit assumptions

`src/data/LegacyEra.ts` owns the campaign-only engineering, availability, and scale assumptions.
It runs through the normal facility quote path before inflation, difficulty, and LCOE. The
operating asset retains its purchased vintage. The catalog's normal modern path is unchanged.

- Early steam uses the existing Coal identity, 50–500 kW sizes, a 138 Btu/Wh heat rate, and
  authored small-project capital and operating costs. The 1902 and 1922 vintages improve new
  equipment; old plants do not improve automatically.
- Four fictional, dated Sierra hydro sites use the existing reservoir dispatch and permanent
  site ledger. Their capacities and costs are authored proxies, not reconstructions of dams.
- Postwar Oil represents steam generation, with slower response and the national 1955/1960
  steam heat-rate benchmarks. Gas combined cycle, geothermal, wind, solar, nuclear ordering,
  and storage retain explicit regional availability dates.
- Before 1980, seeded weather resamples complete recorded 1980–2019 years with city/basin
  coherence. Native campaign calls explicitly opt into this historical model. Before 1975,
  fuel prices use the first available receipts scaled by modeled CPI;
  the 1973–74 oil transition is authored. The recorded 1979 and 2000–01 shocks are not doubled
  by event multipliers. Pre-1913 CPI is held flat and early prime is modeled at 6%.
- Efficiency and curtailment open in 1973, time-of-use in 1982, solar/thermal programs in 2000,
  EV programs in 2010, and customer batteries in 2015. UI, commands, imports, and forecasts share
  these gates.
- Crisis corridor limits, future demand steps, and future emissions targets are scenario
  assumptions. Absolute corridor limits use frozen opening demand/capacity, so later upgrades
  do not silently change the authored event's surviving MW.

Research context and the accepted design are in
[issue 611](https://github.com/toddmedema/electrify/issues/611#issuecomment-6567837989).
Source comments distinguish observed benchmarks from authored engineering and cost proxies:
[IURC historical glossary](https://pubs.naruc.org/pub/DD7DB67E-1866-DAAC-99FB-36526B06C7C6#page=87),
[EIA national steam heat rates](https://www.eia.gov/totalenergy/data/annual/txt/ptb1206.html),
[BLS annual CPI](https://www.bls.gov/regions/mid-atlantic/data/ConsumerPriceIndexAnnualandSemiAnnual_Table.htm),
and [Rutgers' Pearl Street account](https://edison.rutgers.edu/images/archive/innovations/EL/PearlStreetHeadnote.pdf).
Pearl Street's district investment is not treated as generator-only capital cost.

## Verification

Focused suites cover legal sub-MW quotes, vintage preservation, dated hydro claims, weather
reload determinism, program gates, projected term clocks, loan settlement, all nine handovers,
and save rejection for manipulated context or evidence. The headless campaign suite exercises
real construction, pricing, cash, dispatch, objective windows, and successive CEO terms.
The browser campaign spec checks entry placement, setup, an actual financed 50 kW purchase,
and saved handovers in both themes at desktop, 390 px, and 360 px widths. Its near-boundary save
fixture tests the interface and continuity; the headless simulation separately tests economics.
