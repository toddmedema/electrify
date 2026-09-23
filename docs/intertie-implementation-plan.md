# Intertie balance implementation plan

Status: accepted allocations after the measured portfolio comparisons in [the balance report](intertie-balance.md). Regional profile values are gameplay abstractions, not measured engineering entitlements. No new firm-contract system.

## Architecture and scope

1. Add a small authored scenario-access catalog keyed by scenario and corridor/neighbor, separate from physical TransmissionProfiles. Store initial access MW, accessible neighboring supply MW and export demand MW. Quote capital and annual operating cost as original per-W amounts times purchased access. Preserve authored construction duration, price, emissions and archetype. The cap is fixed at scenario initialization, never a function of current customers or demand. Custom games, including year or location overrides, use regional profile defaults rather than silently inheriting a source scenario's allocation. Island scenarios retain no interties.
2. Pass access through shared effective-corridor/effective-market helpers used by building, details, projection, imports, exports and upgrades. Avoid reducer import cycles. Prefer derived authored lookup over trusting access fields in imported saves; if storing a resolved access snapshot, validate every field against the authored/current custom scenario. ScenarioId-only lookup must not apply an unrelated location's access. Current model need not preserve older saves.
3. Dispatch import allowance = min(weather-adjusted purchased line rating, accessible neighbor supply * existing archetype availability). Aggregate all lines by neighboring market, sharing a single supply and export-demand budget. Increasing wire cannot create neighboring generation. Dispatch cheapest eligible imports/highest-paying exports with deterministic ties. Shared constraints must also govern forecast and invariants. Upgrades retain original cost escalation and timing but derive base size/upgrade count/cap from access size; retain maximum three upgrades. Avoid upgrade cost or cap being recomputed from full regional size. Export access never increases with upgrades.
4. Extend purchase outlook with portfolio metrics for a clearly labeled next-year/current-fleet assumption: shortfall-energy coverage in hours when the local fleet cannot serve demand, worst remaining MW gap, annual purchased-energy expense plus separately identified line opex and financing, and a labeled regional-stress example. Use the real reducer's forecast/current dispatch outputs and shared allocation math. Include existing imports when evaluating marginal candidate benefit; no double-counting neighboring supply. Do not claim purchase forecasts include assets not yet finished. Typical archetype curves remain averages; stress example is illustrative, not exact hidden-event foreknowledge. Memoization must refresh on fleet/dispatch/program/trading changes, not only year.
5. Add live detail text identifying binding constraint: own line rating, neighbor spare supply, local need/trading rule, or neighbor export demand. Explain ratings and available MW with text, not color alone. Upgrade details explicitly show when neighbor supply is the bottleneck.
6. Extend Mission 7 after existing import and export demonstration with warning, safe paused stress inspection, recovery action and verified supplied period. Use a deterministic authored tutorial-only neighbor-supply restriction through the same dispatch path. Keep gas backup available; prompt restoring gas, then verify restoration and no shortage. No irreversible surprise failure, no hidden random trap, and no mandatory new construction. Preserve exit/skip/restart behavior and prove stress affects actual dispatch and ends normally.

## Accepted access table

Units: MW, $M capex, $M/year opex. Each row: scenario, corridor, wire MW, supply MW, export MW, capex, opex. Neighbor supply is before archetype availability; export is a fixed neighbor budget. Prices, durations and regional profiles unchanged. These are authored gameplay allocations, not externally measured transmission rights.

| Scenario                    | Corridor                        | Wire |                 Supply | Export | Capex |  Opex |
| --------------------------- | ------------------------------- | ---: | ---------------------: | -----: | ----: | ----: |
| 100 Carbon Fee              | california-north                |  150 |                    180 |    150 |    54 |  1.08 |
| 100 Carbon Fee              | california-south                |  150 |                    120 |    150 |    84 |  1.44 |
| 101 Rise of Renewables      | california-north                |  150 |                    180 |    150 |    54 |  1.08 |
| 101 Rise of Renewables      | california-south                |  150 |                    120 |    150 |    84 |  1.44 |
| 102 End of an Era           | pjm-miso-upgrade                |  150 |                    150 |    150 |    60 |   1.2 |
| 102 End of an Era           | pjm-nyiso-new                   |  100 |                    100 |    100 |    80 |   1.2 |
| 103 Shale Boom              | pjm-miso-upgrade                |  150 |                    150 |    150 |    60 |   1.2 |
| 103 Shale Boom              | pjm-nyiso-new                   |  100 |                    100 |    100 |    80 |   1.2 |
| 106 Data Center Boom        | pjm-miso-upgrade                |   30 |                     25 |     30 |    12 |  0.24 |
| 106 Data Center Boom        | pjm-nyiso-new                   |   20 |                     15 |     20 |    16 |  0.24 |
| 107 Deep Freeze             | ercot-east-dc-upgrade           |  600 |                    300 |    400 |   360 |   7.2 |
| 107 Deep Freeze             | ercot-southern-spirit-new       | 1200 |                    450 |    600 |  1500 |  22.5 |
| 108 Heatwave + Drought      | spain-portugal-upgrade          |   65 |                     65 |     65 |    18 |  0.36 |
| 108 Heatwave + Drought      | spain-biscay                    |  100 |                    100 |    100 |    78 |   1.3 |
| 110 Sudden Nuclear Shutdown | france-core-upgrade             |  200 |                    200 |    200 |  57.5 |  1.15 |
| 110 Sudden Nuclear Shutdown | france-biscay                   |  100 |                    100 |    100 |    78 |   1.3 |
| 111 Wildfire                | california-north                |    5 |                      4 |      5 |   1.8 | 0.036 |
| 111 Wildfire                | california-south                |  7.5 |                      5 |    7.5 |   4.2 | 0.072 |
| 112 Mission 7               | california-north                |  500 | 500 normal /150 stress |    500 |   180 |   3.6 |
| 112 Mission 7               | california-south                |  750 |                    300 |    750 |   420 |   7.2 |
| 113 Load Shedding           | south-africa-mozambique-upgrade |  6.5 |                      6 |    6.5 |   2.6 | 0.052 |
| 113 Load Shedding           | south-africa-northwest-upgrade  |  4.5 |                    2.5 |    4.5 |   2.1 | 0.042 |
| 114 River Runs Dry          | zambia-drc-upgrade              |   70 |                     70 |     70 |    38 |  0.76 |
| 114 River Runs Dry          | zambia-zimbabwe-upgrade         |   90 |                     90 |     90 |    42 |  0.84 |
| 115 Delhi Summer            | india-himalaya-upgrade          |   70 |                     60 |     70 |    28 |  0.56 |
| 115 Delhi Summer            | india-bangladesh-upgrade        |   70 |                     25 |    100 |    30 |   0.6 |

104 Hurricane Season (SJU) and 105 Paradise (HNL): explicitly no interties; preserve NO_INTERTIE_LOCATION_IDS behavior. Other tutorials remain interties-disabled.

112 preserves the existing north build and initial demonstration. After acknowledged warning (not a calendar surprise), reduce the independent supply ceiling to 150 MW for one complete simulated month, require a supplied stressed month after the earlier import/export demonstrations, then restore 500 MW normal ceiling. Existing 500 MW gas is the easy recovery; success should verify service, not only a particular click. Coder must verify normal 500 MW neighbor ceiling still supports original demonstration under its seasonal factors; tune only with evidence. South cannot finish the 24-month tutorial.

110 intentionally supports an import-led mixed plan: 200 MW core corridor helps replace lost 500 MW nuclear unit, with local additions/renewables/storage covering the rest. Four-year Biscay misses the emergency and must be visibly labeled as such. A zero-benefit wire upgrade must show its marginal delivered benefit and neighbor constraint rather than imply it creates additional supply.

114 intentionally allows an import-led option: 20% allocation consistent with authored national model; 160 MW combined access plus residual hydro/diesel can carry meaningful demand. Two-year delivery just reaches 2016 if started immediately; preserve timing. $80M full cash capex leaves $10M opening cash, while $62–65/MWh import base prices exceed the $50/MWh tariff; finances and portfolio still matter. Preserve existing thermal Zimbabwe archetype for this pass and document shared-Kariba correlation as a limitation rather than inventing stronger drought effects.

Table rationale: 100/101 have identical 500 MW starting scale and geography, so preserve equal access; 102/103 likewise share 500 MW PIT scale. 106 uses much smaller municipal rights, totaling 40 MW supply before availability against 100 MW new data-center load. 107 keeps wire economics/size because Austin is multi-GW, but caps neighboring spare power; six-year new line must still miss the 2021 freeze. 111 explicit 1% LADWP scale yields 1% physical access; three-year south line must still miss the 2025 emergency. Imports may legitimately cover a small remaining deficit; do not force their failure merely because they are imports.

108 keeps Portugal useful at 65 MW while the four-year Biscay line cannot finish the 36-month mission; do not shorten timing. 113 uses explicit 1%-Eskom access scale: 8.5 MW spare neighbor power helps but cannot replace widespread coal losses. 115 uses 10%-Delhi wire scale, with asymmetric Bangladesh supply 25 MW/export 100 MW matching its net-buyer character; both neighbors together spare 85 MW before dry-season/thermal availability.

Custom-game clarification: a year or location override creates a custom game and uses unmodified regional profile defaults unless the custom scenario explicitly declares a matching access allocation. Do not silently inherit scenario-specific rights by source scenario ID. Document this design in the report. Simulation harness must retry the selected intertie at first affordable month; a rejected month 0 order is not an intertie strategy.

Implementation detail: use representative-time weighting (TICK_MINUTES or forecast step, month lengths/GAME_TO_REAL_YEARS as the simulation does) for annual energy/cost. Do not sum hourly forecast points as quarterly ticks. Replace duplicated old rating-times-fraction invariant in Invariants.tsx:543 and add independent per-market bounds. Tutorial restriction begins only after acknowledged warning/tutorial stage transition, never solely by calendar while the player reads.

## Required balance evidence and acceptance

Measure before and after using actual reducer: no discretionary change; each single earliest-affordable financed intertie; both/upgrade-heavy imports; comparable domestic addition; complementary import+domestic plan. Mandatory story responses must be consistent. Use Intern and CEO plus fixed seeds 12345, 1, 7; retain Deep Freeze authored seed 268107. Include every enabled non-tutorial scenario; explicitly record disabled 104/105. Run every difficulty for the final chosen mixed/local accepted plans if practical. Record served demand and objective-window service, minimum margin, retention, cash/debt, imported energy, and actual accepted decisions. Report physical/economic outcome separately from meaningful-decision gate; failed click quota is never balance success evidence.

Acceptance: no single universal import opening replaces scenario preparation across the matrix. Intertie-supported wins remain reachable where geography fits, and at least one explicitly identified scenario retains a competitive import-led plan. Each changed emergency scenario retains a measured winning plan; do not weaken reliability/customer objectives or pad meaningless actions merely to pass old tests. Preserve existing researched story-choice tradeoffs. Candidate parameters may be tuned only with recorded outcomes/rationale. Unit tests: neighbor supply stays constant across wire upgrade; multiple paths share one budget; export budget shared; quote/reducer/forecast/invariant agreement; costs/access do not change when customers change; deterministic seeded replay/import validation; custom/island fallback; tutorial actual stress/recovery.

## Implementation and review order

Coder: implement shared types/catalog/helpers, dispatch and invariant changes; quote and upgrade use; portfolio outlook/live explanations; tutorial flow. Add focused unit/reducer tests, revising playbooks only for actual viable behavior. PM owns independent balance harness/report in distinct testing files and communicates tuning evidence to coder. Root owns e2e spec updates, light/dark desktop/mobile checks, screenshots and PR. Coder must send stable tutorial labels/stages to root; existing tutorial-interties.spec.ts hardcodes 15 steps. Run focused suites, format, regenerate compatibility last, npm run check and build. Root runs relevant desktop/390 px tutorial/build Playwright coverage and captures 1–3 finished UI screenshots for PR.

QA: independent review against all four user-approved items and measured evidence; at most three feedback rounds. Coder fixes each round and reruns affected gates. Final reviewer verifies no unresolved high-priority issues, exact candidate/accepted values documented, checks green, screenshot evidence available. Root opens the PR against master, embeds temporary GitHub-hosted attachments and removes upload files afterward.
