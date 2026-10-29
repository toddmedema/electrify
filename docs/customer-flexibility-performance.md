# Customer flexibility performance audit

This audit builds on PR #576 at `23a2be08`. It retains two changes: the fixed
battery-adoption and smart-charging capability tables are private, readonly module
constants. Previously, the simulation constructed these nested arrays repeatedly,
including once per battery installation cohort. The interpolation, eligibility,
costs and dispatch calculations are unchanged.

One subagent measured and implemented the candidates, a second challenged the
proposals, and a third independently reviewed the code and measurement controls.

## Simulation evidence

Windows x64, Node 24.14.0. The principal comparison uses the real reducer inside
Redux Toolkit's Immer, with frozen input states. A supported custom game starts
in San Francisco in 2025 with one million customers, 1 GW of gas combined cycle
and 1 GW of utility solar, seed 12345, Employee difficulty and a $0.07/kWh rate.
All three flexibility programs start in month 1. Sixty months of actual play develop the
fixture, including 36 thermal and 48 battery installation cohorts.

The fixture demonstrates actual thermal shifting, EV shifting, battery charging
and battery discharge. Each variant and workload receives a full discarded
96-month warmup. Seven alternating before/after pairs then run 96 months each,
completing 9,216 ticks per run. The temporary control switches
the legacy and optimized public cohort, cost and eligibility functions directly;
there are no timing-spy wrappers in the measured path.

The temporary harness uses standard Jest VM globals (`Math`, `Number`, `Object`,
`Array`, `JSON` and `BigInt`). The regular `perf:bench` retains its historical
Math-only binding. Compare percentages within the paired experiment rather than
absolute timings between those two harnesses.

| Active-program workload  | Median before | Median after | Median paired reduction |  Pair range |
| ------------------------ | ------------: | -----------: | ----------------------: | ----------: |
| Simulation time per year |     92.402 ms |    83.666 ms |                   8.97% | 4.78–11.60% |
| Median month rollover    |      4.096 ms |     3.617 ms |                  11.27% | 8.71–12.84% |
| Median ordinary tick     |     0.0309 ms |    0.0295 ms |                   4.21% |  3.88–4.55% |

Percentages are medians of paired reductions, rather than ratios of the two
independent median columns. Every pair produced matching SHA-256 hashes of the
complete enumerable game state and serialized commitment metadata, computed
outside the timed ticks.

A separate post-timing audit repeated the same windows through both variants,
checking the owning failure conditions and cash at every completed month.
All runs remained playable and completed all 96 months;
the active workload ends at month 156 of its 240-month scenario. Its prior
60-month history also passed the failure/cash audit. Cash at the opening tick and
all completed-month checkpoints was positive.

A fresh game without enrolled programs is the control. Its ordinary-tick paired
median change is zero; total-time differences span noise around zero, with a
median 1.73% slowdown and a range from 4.16% slower to 7.04% faster. This audit
claims no fresh-game speed improvement. The regular `perf:bench` workload also
has no active customer programs and remains a separate regression gate.

## Mobile and rendering evidence

Production headless Chromium samples use a 390 px phone viewport at 12x game
speed. The active main-screen and Insights samples each cover twelve rendered
month boundaries, including January, plus a 350 ms tail. Before optimization,
the worst ordinary, month and January frame gaps were 16.8 ms, with no long
tasks. Fresh phone and desktop controls also held that host cadence. The desktop
host delivered approximately 60 Hz callbacks, so it cannot establish 120 Hz
performance.

A 4× CPU-throttled active Insights sample exposed remaining stalls: worst
ordinary/month/January gaps of 116.6/183.3/83.4 ms, with fifteen long tasks and a
worst long task of 179 ms. This is a lab proxy, not a measurement on a physical
phone. Matched active Insights samples after the change preserve the native-CPU
cadence, while the throttled sample remains mixed:

| Active phone Insights | Before ordinary/month/January worst gaps | After ordinary/month/January worst gaps | Long tasks before/after |
| --------------------- | ---------------------------------------: | --------------------------------------: | ----------------------: |
| Native CPU            |                    16.8 / 16.8 / 16.8 ms |                   16.8 / 16.8 / 16.8 ms |                   0 / 0 |
| 4× CPU throttle       |                  116.6 / 183.3 / 83.4 ms |                100.0 / 216.7 / 100.1 ms |                 15 / 17 |

The throttled after sample's worst long task was 225 ms. These single browser
pairs do not establish a whole-frame improvement; substantial throttled stalls
remain. The paired simulation figures above are not whole-frame speedups.

The audit also tested a narrow memo boundary around the mobile stable-grid
tooltip. Across 1,152 actual Redux tick states, its formatted text stayed
unchanged on 10.24% of fresh-game updates and 18.40% of active-game updates.
Three alternating warmed render pairs produced inconsistent fresh-game totals,
including a 2.77% regression, and only small ordinary-render gains. The memo was
dropped. No UI code, displayed values, update cadence or tooltip behavior changes
are retained.

## Scope decisions and validation

The challenger rejected persistent fleet caches and shared deferred queues
because their invalidation and ownership risks outweighed their potential gain.
Thermal date/profile cleanup and an additional billing branch were also dropped
because attribution suggested too little benefit for this pass. An obsolete
program launcher was excluded from production-render claims.

Independent QA found no actionable production defect. It verified that the
legacy copies match the baseline, both A/B variants reach the actual reducer
call paths, the paired statistics and complete-state hashes agree, and
eligibility stays identical at curve boundaries, fractional and malformed years,
and country/region fallbacks. The playability audit closed its final evidence
question. All 53 focused tests and the production web build passed.

`npm run check:ci` passed all 14 gates in 883 seconds: formatting, lint, types,
desktop runtime units, CI tooling, covered tests, simulation suites, simulation
CLI, tick performance, production build, bundle size, the configured production
browser matrix, desktop renderer build and headless multiplayer. No native windows
were opened. The temporary servers are stopped.

After rebuilding the web artifact, `npm run perf:rebaseline` passed with the golden
snapshot unchanged. The regular benchmark recorded overall/rollover Immer ratios
of 1.463/1.099. The existing 1.632/1.294 ceilings and 25% tolerance are retained,
rather than accepting the generator's looser 1.828/1.374 suggestions. This inactive
workload does not measure the active-program improvement above.

The refreshed web bundle is 912.113 kB main/initial JS, 1,450.318 kB total JS and
26.630 kB CSS. The previous checked-in baseline was 903.686/1,434.521/25.038 kB;
that comparison includes the already-merged customer-program work in PR #576.
The retained source patch changes no CSS or UI. The original bundle gate passed
before this refresh, and its 10% tolerance is unchanged. Browser census ceilings
are unchanged. Temporary profiling code and copied legacy functions stay out of
the PR.
