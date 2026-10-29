# Independent review of customer flexibility programs

Reviewed 19 October 2026, independently of the three implementation authors. Scope included
the [thermal](thermal-flexibility-program.md), [EV](managed-charging-program.md), and
[battery](customer-battery-program.md) research plans, their data and dispatch helpers, and
policy accounting, forecasts, imports, saves, and interface integration.

## Plan and implementation verdicts

**Controlled heating and hot water: supported.** New Zealand's historical relay controls and
Australia's water-heating trial support the mechanism; Québec supports modern automated winter
heating response. The implementation distinguishes those technologies, sizes the pool by local
equipment, freezes capabilities at installation, excludes cooling, and repays deferred energy.
The principal limitation is an authored country-level equipment envelope held fixed across eras.
Daily partial throttling and full recovery are aggregate game assumptions, rather than Hilo's
event schedule or a building-temperature model. Maintenance payments justify retaining controls;
the program does not simulate controller retirement or automatic technology upgrades.

**Managed EV charging: supported.** British trial and charger-policy evidence supports controlled
charging with incentives and overrides. Fleet stock is kept separate from new sales and smart
charging capability. The implementation has no modern flexible EV load in 1980, very little in
2015, regional adoption differences, bounded future uptake, an inflexible transport floor, and
energy deadlines that survive cancellation. Recurring costs are capped by vehicles represented
in the existing transport load. The road/rail split, cars per account, charging energy and future
adoption curves remain explicit calibrations; this is not a national vehicle or travel model.

**Customer batteries and VPP: supported.** Australian operating evidence supports aggregation,
while Germany's early market establishes the historical limit. The plan correctly distinguishes
observed household bill differences from the causal return on a subsidy. The implementation
funds only households accepting the VPP agreement, freezes both hardware eligibility and agreement
take-up at installation, and uses that same funded pool for rebates, payments and storage capacity.
All surviving funded assets can dispatch while On, subject to power, reserve, loss and aging
limits. New storage starts empty; only actual rooftop or generated grid surplus can charge it.
The fixed 5 kW/10 kWh design, agreement take-up, compensation and aging schedule are authored
assumptions. There is no ancillary-service income, automatic replacement program, or household
dispatch optimization. Existing household batteries before 2016 do not imply access to this VPP
rebate program.

## Findings resolved during review

- Fresh forecasts initially discarded existing customer-battery energy. They now carry the
  preceding tick's stored energy or the current tick's saved starting state.
- Save validation initially rejected scheduled changes after flexibility rollout reached 100%.
  Fully enrolled programs can now retain pending Off and window changes.
- Battery discharge could award tariff credits for recovered residential energy supplied by the
  household battery. Billing now prorates recovery to electricity still supplied by the utility.
- Forecast enrollment costs initially depended on an unpopulated transport-demand timeline.
  Forecasts now receive the represented transport baseline explicitly.
- The initial battery design subsidized every addressable installation but credited only an
  enrolled quarter, omitting benefits from the other subsidized systems. This made the program
  artificially expensive and did not honor the proposed rebate tied to an access agreement.
  The corrected design funds only willing participants, uses one shared household-count helper
  for rebates and physical capacity, and does not apply a second enrollment discount. Both
  eligibility factors freeze per cohort, preventing free later enrollment growth. Availability
  requires both household battery technology and VPP readiness, beginning in 2016.
- Interface counts, budgets and rooftop-surplus copy omitted the new behavior. They now include
  the three programs, continuing payments, completed installation budgets and early VPP limits.
  The estimated completion month was also aligned with the final funded installation month.
- Research citation dates were corrected for the Norwegian vehicle release and German battery
  newsletter. Measured results and authored assumptions remain separately identified.
- Inactive batteries initially added zero-valued fields to legacy chart records. Dispatch now
  records battery state only for a funded rollout, carried energy, or a previously dispatched
  tick. The guard preserves active and historical-cohort behavior; shared empty results are
  read-only in this call path. Existing golden outputs must pass without rebaselining.

## Acceptance and validation

**Independent approval: all three plans and implementations are acceptable.** No unresolved
implementation defect was identified in the reviewed core code. The additional regressions were
reviewed: completed-rollout pending saves for all three offers, actual dispatch and costs reproduced
exactly over three months, and rooftop self-consumption plus battery input bounded by production.
After the funded-only correction, the implementation author's focused run passed all 50 tests
in the battery helper, integration and save upgrade suites. The added checks connect subsidy to
the funded household count and prevent early cohorts gaining free later agreements or capacity.
Earlier focused thermal/EV integration checks also passed. The independent review preceded the
broader gates; the integrator subsequently completed the following checks on the final source:

- All eight `npm run check` gates passed in 301 seconds, including covered tests and long
  simulations. All 21 existing scenario golden hashes remained unchanged.
- `npm run sim -- --all` passed every invariant across all 21 scenarios.
- Eight headless browser journeys passed at 1280 × 800 and 390 × 844, covering scheduling and
  cancellation in both themes. All four new-program journeys passed again after improving
  screenshot framing. Review screenshots were checked for clipping, contrast and stray overlays.
- The production web build and existing bundle-size gate passed without changing baselines.
- `npm run perf:bench` passed both existing ratio limits: 1.38 overall and 1.06 at rollover.

The remaining assumptions above are acceptable for the game's centralized aggregate simulation.
They constrain the meaning of the forecasts: a program is not guaranteed to pay for itself, and
overseas trial performance is not applied as an unconditional reduction in whole-grid demand.
