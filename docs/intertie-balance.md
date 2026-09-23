# Intertie balance experiment

The change separates a utility's fixed transmission access from the regional corridor and separates neighboring spare generation from the wire rating. The authored allocations and implementation requirements are in [the implementation plan](intertie-implementation-plan.md). They are calibrated game assumptions, not estimates of actual utility transmission rights.

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

Every intertie is ordered with financing and retried monthly until affordable. Duplicate orders after acceptance do not add meaningful decisions. `domestic-addition` uses the existing difficulty-specific reference build, falling back to the Intern reference where no opening build exists; `mixed` combines that same build with the first corridor. These are transparent reference portfolios, **not equal-cost optimized plans**. `established-plan` preserves the checked-in complete plan and its actual operating decisions. Mandatory scenario responses use the simulator's existing baseline response behavior consistently.

Each result reports the official outcome separately from physical/economic success. The latter requires surviving the entire duration with cash and customer/reliability objectives intact, while waiving only the decision-count requirement. A strategy fired only for insufficient decisions is not evidence that imports were balanced. Cash, objective-window served energy, worst monthly supply margin, customer retention, accepted decisions, imports expense and invariant failures are recorded. Updated runs additionally report debt and accepted line sizes/order times. Import-energy share reconstructed from monthly chart averages is explicitly labeled an estimate.

## Baseline evidence

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

## Final measured results

All allocation rows in [the implementation plan](intertie-implementation-plan.md) were retained after measurement. The executable source of truth is `src/data/IntertieAccess.ts`. Two reference operating plans changed to prepare for risks previously hidden by oversized imports; the mission objectives and researched preparedness fee remain unchanged.

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
