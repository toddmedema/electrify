# Intertie balance experiment

The model separates a utility's purchased transmission access from the regional corridor and separates neighboring spare generation from the wire rating. The per-scenario allocations live only in `src/data/IntertieAccess.ts`. They are calibrated game assumptions, not estimates of actual utility transmission rights.

## Design rules

- Access is authored per scenario, corridor and completed tier; it never scales with live customers or demand. Tier 1 retains its calibrated allocation. Custom games, including year or location overrides of a built-in scenario, use the regional profile defaults rather than inheriting that scenario's allocation. Island scenarios (Hurricane Season, Paradise) have no interties.
- Import room is the smaller of the weather-adjusted purchased wire rating and the purchased import allocation times its archetype availability. Completing a higher tier expands the wire and the authored import allocation. Each corridor's purchased access and each neighboring market's physical supply remain shared budgets, so duplicate lines cannot multiply access or create generation. Export access remains fixed across tiers.
- Quotes, dispatch, forecasts and invariants read access through the same effective-corridor helpers, so they cannot disagree.
- Detail text names the binding constraint (own wire rating, available import access, local need or trading rule, neighbor export demand) in words, not color alone.

## Allocation rationale

- 100/101 and 102/103 share a starting scale and geography, so each pair keeps equal access.
- 106 uses small municipal rights: 40 MW of neighbor supply before availability against 100 MW of new data-center load.
- 107 keeps full wire economics because Austin is multi-GW but caps neighboring spare power; the six-year new line still misses the 2021 freeze.
- 108 keeps Portugal useful at 65 MW while the base four-year Biscay line offers no timely relief during the emergency.
- 110 supports an import-led mixed plan: the 200 MW core corridor helps replace the lost 500 MW reactor, and the four-year Biscay line visibly misses the emergency.
- 111 scales to 1% of LADWP, so the three-year south line still misses the 2025 emergency; imports may cover a small remaining deficit.
- 112 (Mission 7) starts with 500 MW of Tier 1 import access for the import and export demonstrations, then restricts imports at every tier to 150 MW for one month after an acknowledged warning so the player practices recovery with existing gas. Outside that restriction, higher tiers can buy up to 650 MW of import access.
- 113 uses 1%-of-Eskom scale: 8.5 MW of spare neighbor power helps but cannot replace widespread coal losses.
- 114 supports an import-led option with 160 MW combined access; the two-year build just reaches 2016 if started immediately, and import prices above the tariff keep finances relevant. Shared-Kariba drought correlation is a known limitation.
- 115 uses 10%-of-Delhi wire scale, with asymmetric Bangladesh access (25 MW supply, 100 MW export) matching its net-buyer character.

## Reproducing the report

Use Node 24 after `npm ci`:

```sh
CI=true INTERTIE_REPORT_OUTPUT=/private/tmp/intertie-report.json node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --testMatch '**/src/testing/IntertieBalanceReport.tsx'
```

The explicit report entry point is excluded from ordinary Jest discovery. It runs the real simulation and records JSON after each cell. Optional environment variables:

| Variable                                                                                                      | Meaning                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `INTERTIE_REPORT_IDS=106,108`                                                                                 | Restrict scenarios; default all non-tutorial scenarios                                          |
| `INTERTIE_REPORT_DIFFICULTIES=Intern,CEO`                                                                     | Default two difficulty endpoints                                                                |
| `INTERTIE_REPORT_SEEDS=12345,1,7`                                                                             | Default 12345; Deep Freeze uses its authored 268107 in place of 12345                           |
| `INTERTIE_REPORT_PLANS=passive,intertie-1,intertie-2,both-interties,domestic-addition,mixed,established-plan` | Restrict portfolios                                                                             |
| `INTERTIE_REPORT_MATCHED_TARIFF=1`                                                                            | Apply the existing CEO reference plan's opening tariff equally across all comparison portfolios |
| `INTERTIE_REPORT_UPGRADES=1`                                                                                  | Include both lines with repeated upgrade attempts under the new simulator action                |
| `INTERTIE_REPORT_TIERS=1,2,3,4`                                                                               | Add direct-purchase `intertie-N-tier-T` and `both-tier-T` plans for each requested tier         |

Every intertie is ordered with financing and retried monthly until affordable. Duplicate orders after acceptance do not add meaningful decisions. `domestic-addition` uses the existing difficulty-specific reference build, falling back to the Intern reference where no opening build exists; `mixed` combines that same build with the first corridor. These are transparent reference portfolios, **not equal-cost optimized plans**. `established-plan` preserves the checked-in complete plan and its actual operating decisions. Mandatory scenario responses use the simulator's existing baseline response behavior consistently.

Each result reports the official outcome separately from physical/economic success. The latter requires surviving the entire duration with cash and customer/reliability objectives intact, while waiving only the decision-count requirement. A strategy fired only for insufficient decisions is not evidence that imports were balanced. Cash, objective-window served energy, worst monthly supply margin, customer retention, accepted decisions, imports expense and invariant failures are recorded. Updated runs additionally report debt and accepted line sizes/order times. Import-energy share reconstructed from monthly chart averages is explicitly labeled an estimate.

## Tier access experiment

The tier access change keeps Tier 1 costs, wire ratings, construction time and import/export allocations intact. Higher tiers buy authored import entitlements in addition to their existing wire upgrade. Export entitlements stay fixed; larger wire can still reduce weather-related export constraints. Custom games already have full regional budgets at Tier 1, so their upgrades remain wire-only. The tutorial's temporary 150 MW import restriction still caps every tier.

`IntertieTierReport.tsx` is a separate, explicit experiment. For each scenario, difficulty and seed it samples the same first year of forecast weather and demand for every available tier. It reports average, 5th-percentile and peak-demand import capacity, average export capacity, access budgets, and quoted project costs/timing. Its assertion requires each offered upgrade to increase mean import or export capacity by more than 1 W. This measures physical potential with no local demand or surplus constraint; it does not assert profitable operation, actual traded energy, or timely completion.

Run it with `INTERTIE_REPORT_OUTPUT` set to a writable JSON path and:

```sh
npm run test:once -- --runInBand --testMatch '**/src/testing/IntertieTierReport.tsx'
```

The report accepts the same `INTERTIE_REPORT_IDS`, `INTERTIE_REPORT_DIFFICULTIES` and `INTERTIE_REPORT_SEEDS` filters. Its defaults cover every authored allocation, Intern and CEO, and seeds 12345, 1 and 7; Deep Freeze substitutes its authored seed 268107 for 12345.

The candidate produced 600 eligible tier cells across all 26 allocations; 24 higher-tier cells were unavailable under the existing physical/technology limits. All 444 offered upgrade transitions increased mean import capacity, with a minimum observed increase of 0.135 MW. In Data Center Boom's New York connection, CEO seed 12345:

| Tier | Wire MW | Import allocation MW | Mean import capacity MW | Import capacity at local peak MW | Mean export capacity MW |
| ---: | ------: | -------------------: | ----------------------: | -------------------------------: | ----------------------: |
|    1 |      20 |                   15 |                    8.35 |                             9.13 |                   19.93 |
|    2 |      30 |                   20 |                   11.14 |                            12.17 |                   20.00 |
|    3 |      45 |                   25 |                   13.92 |                            15.21 |                   20.00 |
|    4 |    67.5 |                   30 |                   16.71 |                            18.25 |                   20.00 |

The added import headroom comes from purchased access, not from pretending a wider wire creates neighboring generation. The remaining seasonal/weather availability still constrains the import allocation. These sampled increases establish a physical benefit, not that every tier is a good economic choice in every mission.

A further 16 direct-purchase cells cover Data Center Boom, seed 12345, both difficulty endpoints, New York alone or both corridors, and all four tiers at the matched reference tariff. Every cell passes invariants. On CEO, New York alone at Tier 1 fails after 144 months with 83% customer retention; Tier 2 physically completes all 192 months with 90.2% retention. Tiers 3 and 4 fail after 84 months before construction finishes (0.6 and 2.4 years remain). All four both-corridor choices physically succeed, with final cash of $608M, $615M, $588M and $540M for Tiers 1–4 respectively. On Intern, New York alone succeeds at Tiers 1 and 2 but fails at Tiers 3 and 4. Thus extra purchased access can matter, while paying for the largest initial project can still be a poor choice. Physical success here waives only the decision quota; these sparse CEO plans still fail the official decision-count requirement. This small reference comparison is not an optimized strategy search.

The paired simulation comparison uses baseline commit `af4b868280c9af717951599fee96bc12d09cd313` and the tier-access implementation on that same base. The later upstream delta through `f7dd7134` changes only scoring-message copy among simulation inputs, not formulas, scenario data or reducers. Both matrices contain 144 cells: IDs `106,107,108,110,111,113,114,115`, Intern and CEO, seeds `12345,1,7`, matched reference tariffs, and `both-interties,upgraded-interties,established-plan` with upgrades enabled. Both runs have zero invariant violations. All 96 Tier 1/reference control rows match exactly across every recorded field, and all 48 established plans physically succeed.

Of the 48 upgrade-heavy cells, physical wins change from 12 to 12 on Intern and 5 to 8 on CEO. The only outcome changes are River Runs Dry on CEO, which gains an import-led option on all three sampled seeds. Heatwave + Drought, Sudden Nuclear Shutdown, Load Shedding and Delhi Summer still fail with upgrade-only plans at both difficulty endpoints on all three seeds; Deep Freeze still fails on CEO. These are sampled reference portfolios, not proof that no other import strategy can solve a mission.

River Runs Dry's new option is retained because the scenario explicitly supports an import-led strategy, with a measurable service and financial tradeoff. Before the change its CEO upgrade-only plan fails at month 58 on all three seeds; afterward it physically completes all 72 months. Comparing equally long completed candidate runs:

| CEO plan, three seeds | Final cash | Final debt | Electricity purchases | Customers retained vs first month | Overall demand served |
| --------------------- | ---------: | ---------: | --------------------: | --------------------------------: | --------------------: |
| Upgrade-only imports  |  $462–472M |      $203M |             $159–167M |                        91.2–92.6% |          99.64–99.67% |
| Established plan      |      $159M |      $148M |             about $5M |                            109.8% |                  100% |

The import-led plan retains more cash even after subtracting debt, but sacrifices customer growth and some service, carries more debt, and remains exposed to continuing electricity purchases. This is an intended new choice, not a claim that balance is guaranteed. The simple mixed reference loses to bankruptcy at month 29 in three additional candidate cells; it is not an optimized alternative. The upgrade-only plan's official decision-quota failure is reported separately and is not treated as protection against an overpowered strategy.

## Earlier allocation calibration: baseline evidence

Baseline commit `b775065`, seed 12345 (Deep Freeze 268107), authored tariffs, Intern and CEO: 180 portfolio cells across 14 scenarios. At least one single-intertie strategy physically succeeded in 8 of 12 intertie-enabled scenarios on Intern and 6 of 12 on CEO. This establishes a material balance issue without claiming that every scenario is solved by any line.

| Scenario                | Single-line physical win, Intern | Single-line physical win, CEO |
| ----------------------- | -------------------------------- | ----------------------------- |
| Carbon Fee              | No                               | No                            |
| Rise of Renewables      | No                               | No                            |
| The End of an Era       | No                               | No                            |
| The Shale Boom          | No                               | No                            |
| Data Center Boom        | Yes                              | Yes                           |
| Deep Freeze             | Yes                              | No                            |
| Heatwave + Drought      | Yes                              | Yes                           |
| Sudden Nuclear Shutdown | Yes                              | Yes                           |
| Wildfire Emergency      | Yes                              | Yes                           |
| Load Shedding           | Yes                              | Yes                           |
| The River Runs Dry      | Yes                              | No                            |
| Delhi Summer            | Yes                              | Yes                           |

Paradise and Hurricane Season have no interties and remain controls. Wildfire and River Runs Dry already physically succeed without discretionary changes on the Intern baseline; their import wins are not proof that the line caused success. Several legacy scenarios fail financially under their opening tariff regardless of a line, so the matched-tariff experiment separates that operating decision from the investment comparison.

The matched-tariff baseline covers 152 cells. Using each scenario's existing reference-plan tariff equally across portfolios, at least one single intertie physically succeeds in 12/12 enabled scenarios on Intern and 9/12 on CEO (all except Carbon Fee, Deep Freeze and River Runs Dry). Some of those passive portfolios also succeed; compare marginal service and finances instead of treating every import win as caused by the import.

The wider baseline matrix exposed a preexisting numerical invariant failure: tiny floating-point exports (about 0.00000006 W) occurred while importing in some portfolios. This is reported rather than silently excused; the dispatch change makes import/export mutually exclusive. Baseline result files still record those violations and therefore are diagnostic evidence, not a green test run.

## Earlier allocation calibration: measured results

All proposed allocations were retained after measurement. Two reference operating plans changed to prepare for risks previously hidden by oversized imports; the mission objectives and researched preparedness fee remain unchanged.

| Experiment                                                        | Before: Intern | After: Intern | Before: CEO | After: CEO |
| ----------------------------------------------------------------- | -------------: | ------------: | ----------: | ---------: |
| Authored tariff: scenarios with a successful single line          |           8/12 |          3/12 |        6/12 |       1/12 |
| Matched reference tariff: scenarios with a successful single line |          12/12 |          7/12 |        9/12 |       5/12 |

The authored-tariff before and after matrices contain 180 cells each. The final after matrix has zero invariant violations and every scenario has a physically successful established plan at the baseline seed. The matched-tariff comparison has 152 before cells and 176 after cells; the 24 added cells explicitly attempt repeated upgrades on both lines. That after matrix also has zero invariant violations. Counting a physically successful strategy does not assert that it maximizes profit, and some passive portfolios already succeed.

Deep Freeze, Heatwave + Drought, Sudden Nuclear Shutdown, Load Shedding and Delhi Summer now require complementary preparation at both difficulty endpoints in these tested portfolios. A further 96 emergency-scenario cells cover each single line and upgrade-heavy imports on seeds 1 and 7; those five scenarios still cannot be bypassed by those import strategies. Smaller connections remain useful: Wildfire's 4 MW neighboring supply can cover the baseline CEO deficit, while Data Center permits a two-neighbor import-led strategy; buying either connection alone misses the CEO customer-retention objective. Legacy scenarios retain multiple successful import options under a financially viable tariff.

In Sudden Nuclear Shutdown, the former CEO reference's 400 MW gas plant arrives too late to replace the reactor without the formerly oversized intertie. With 200 MW import access unchanged, 300 MW oil plus the same remaining reference decisions wins seeds 12345, 1 and 7, with final cash $251M, $444M and $538M. A 200 MW oil build fails those seeds with worst remaining gaps of 20–44 MW; 400 MW wins but leaves less cash. The reference therefore uses timely 300 MW oil backup.

Wildfire's former CEO reference relied on the enormous intertie instead of preparedness. It wins seed 12345 after scaling but loses seeds 7 and 20; the old code won seed 7. Replacing the unnecessary final-month coal pause with the existing $200k preparedness choice wins seeds 12345, 1, 7 and 20, ending with approximately $116M, $113M, $115M and $117M. All four final reference runs have exactly ten meaningful decisions and 100% emergency demand served. Keeping cash remains a physically successful alternative for an adequate baseline grid; preparedness can now be slightly more profitable because bounded exports change the value of customer disconnections and generator losses. Tests verify those outcomes rather than require one response to have universally higher cash.

The extra reference-plan seed sweep contained 52 cells, exposing the Wildfire weakness above and confirming the other sampled plans. These are reproducible samples, not a claim that every weather seed or arbitrary portfolio wins. The report runner asserts invariants and records strategy success/failure; expected losing strategies are evidence, not a failed matrix test. The tutorial is verified separately through reducer and browser tests.

A further 42 cells apply the CEO reference plans on Employee, Manager and VP at the baseline seed. All pass invariants; 39 win physically. The three exceptions are Sudden Nuclear Shutdown: the CEO oil plan becomes uneconomic when easier construction brings it online earlier. Replacing its opening build with 400 MW natural gas, while keeping its other decisions, wins all three settings with $1,085M, $1,149M and $1,204M final cash. Their shorter construction times let gas arrive before the reactor trip. Together with the endpoint results, this demonstrates a winning plan for every scenario on all five difficulties; it does not claim one unchanged operating plan fits every difficulty.

For scoped calibration, `INTERTIE_REPORT_BUILD=Oil:300` replaces or adds an opening generator build; `Battery:80` means 80 MWh. `INTERTIE_REPORT_RESPONSES` accepts a JSON map of scenario-choice IDs to options, for example `{"story:111:california-wildfire-2025:preparedness":"prepare"}`. The primary before/after single-line comparisons use the default response consistently; the revised established Wildfire plan explicitly funds preparedness.
