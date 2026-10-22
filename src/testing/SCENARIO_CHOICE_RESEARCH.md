# Scenario choice cost research

Research date: September 10, 2026. Applies to scenarios 106 (Data Center Boom),
107 (Deep Freeze), and 111 (California Wildfires) in PR #347.

**Wildfire model update (October 21, 2026):** the current mission uses a finite
local backup package and observed account-interruption estimates. The historical
$2M readiness fee, generic plant losses and severity-scaled repairs are retired.
See the updated wildfire section below.

## Findings

Keep the **$15M data-center contribution**, reduce **winterization from $250M to
$90M**, and reduce **wildfire preparedness from $2M–$7M to $200k**. Use the same
price at every difficulty: the offered package has the same scope, while the
simulation already varies the operating challenge. These are calibrated game
allowances, not claims that the historical utilities signed these contracts.
The current wildfire repair envelope is $780k in 2025 dollars, allocated across
January–March; it no longer scales with an invented disconnection severity.

| Decision                  |            Previous amount | Reference in decision-year dollars                                                             | Assessment and revised amount                                                           |
| ------------------------- | -------------------------: | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Data Center, January 2024 |              $15M received | $15.3M local transmission/substation project; different ultimate capacity                      | No demonstrated >50% error in magnitude; retain $15M as a contribution toward expansion |
| Deep Freeze, January 2020 |                 $250M paid | Approximately $88M constructed estimate; round to $90M, with $40M–$150M analytical sensitivity | 178% above $90M; reduce to $90M                                                         |
| Wildfires, December 2024  | $2M/$3M/$4M/$5.5M/$7M paid | Approximately $191k transferred readiness proxy; $100k–$250k analytical sensitivity            | Even $2M is 700% above the $250k upper proxy; reduce to $200k                           |

The free responses remain free. That means no incremental package purchased, or
no special upfront developer contribution accepted; it does **not** mean that
ordinary power supply, construction, maintenance, or disaster response costs
disappear. Quantitative win/loss evidence and strategy comparisons are maintained
in [SCENARIO_CHOICE_BALANCE.md](SCENARIO_CHOICE_BALANCE.md).

## Method and confidence

The user's threshold is evaluated as `abs(game amount - reference) / reference`.
An amount above 1.5 times the reference or below half the reference triggers the
test. The denominator is the real-world reference, not the game amount. A range
here describes uncertainty in scope and assumptions, not a statistical confidence
interval or a set of contractor bids.

Research prioritized the actual locality, utility reports, regulatory filings,
published tariffs, and original research. We distinguished one-time capital
contributions from revenue, readiness from restoration, targeted protection from
rebuilding plants, and annual programs from individual events. Later reporting
about historical spending is useful evidence; current tariffs and guidance are
not retroactively treated as January 2024 contracts.

Dollar comparisons use nominal US dollars near each decision's year. Where
necessary, annual CPI-U provides a transparent approximate conversion. BLS gives
2020/2021 indexes of 258.811/270.970 and 2024/2025 indexes of 313.689/321.943.
Consequently, the factors used are 0.95513 and 0.97436. CPI is not an electrical
construction index, and annual averages are not exact January or December prices;
scope uncertainty is much larger than this rounding.
[BLS 2021 methodology](https://www.bls.gov/news.release/archives/cesan_09082022.htm),
[BLS annual indexes](https://www.bls.gov/regions/mid-atlantic/data/ConsumerPriceIndexAnnualandSemiAnnual_Table.htm).

Confidence is moderate in the order of magnitude of the revised packages, lower
in their exact dollar value or benefit. There is no retrieved contract pricing
the game's precise 50% reduction in losses. The effects remain explicit gameplay
assumptions, not measured engineering guarantees.

## Data Center: credible contribution, not a verified signing bonus

The game adds 100 MW to a Manassas-inspired municipal system. A January 2024
choice exchanges $15M of immediate funding for the whole load arriving in January 2026. The alternative delays half the load until January 2028 without that
contribution. The municipal customer count does not make the explicitly modeled
100 MW load a 1%-scale development.

The strongest local comparator is Dominion's February 21, 2024 Foster Drive
submission. Its estimate is **$15.3M**, comprising $0.3M transmission and $15M
substation work. The requested service date was March 31, 2025. The need describes
a Manassas data-center complex initially exceeding 100 MW, with a projected
260 MW load in 2028. The design connects an existing 230 kV line through a new
ring arrangement. These are estimated project costs, not a final invoice or
developer payment. [PJM/Dominion 2024 local plan, pp. 113–114](https://www.pjm.com/-/media/DotCom/committees-groups/committees/srrtep-s/postings/dominion-local-plan-submission-of-the-supplemental-projects-for-2024.pdf).

The game's $15M is 2% below that **project total**, which supports its monetary
scale. It does not establish that connecting exactly 100 MW costs $15.3M. The
comparator's ultimate capacity is larger, substations have fixed costs, and its
listed scope does not include every campus, city, generation, or upstream network
expense. Dividing by 2.6 to invent a linear 100 MW quote would be equally weak.
There is insufficient evidence to identify a >50% error in a negotiated $15M
**contribution**; this is a bounded judgment, not validation of an exact price.

The payment's meaning matters more than a small numerical adjustment. Manassas's
July 2024 large transmission-voltage tariff passes through attributable wholesale
costs, substation O&M, and direct costs/debt service. It adds $8,000 monthly for
administration and indirect costs. Thus the tariff is not evidence for a $15M
unrestricted incentive payment or equivalent profit.
[Manassas LPSTV tariff, pp. 1–2](https://cms9files.revize.com/manassasva/Utilities/utility%20rates/July%201%202024%20rates/Large%20Power%20Service%20Transmission%20Voltage%20FY25.pdf).

An upfront infrastructure contribution is nevertheless a recognizable contract
structure. E3's December 2024 study for Virginia's JLARC distinguishes utility
cost recovery over time from public-power/cooperative arrangements that assign
interconnection investment upfront. Its NOVEC example uses deposits and
installments. This supports the concept, not the exact fictional Manassas bargain.
[E3/JLARC study, slides 76–77](https://jlarc.virginia.gov/pdfs/presentations/JLARC%20Virginia%20Data%20Center%20Study_FINAL_12-09-2024.pdf).

Dominion's current guidance also describes staged service during construction,
with loads below 50 MW often using existing distribution and larger loads likely
requiring transmission extensions and a substation. That supports the choice's
physical premise; the particular 50/100 MW dates remain authored gameplay.
[Dominion data-center guidance](https://www.dominionenergy.com/virginia/large-business-services/data-center-requests).

**Implementation:** retain $15M, describe it as developers contributing toward
expansion, and keep construction and operating decisions with the player. The
simulation does not separately model a restricted construction escrow or the
city's complete wholesale tariff. Neither option purports to reproduce an actual
development agreement.

## Deep Freeze: targeted protection is cheaper than reconstruction

The modeled Austin portfolio totals 3,827 MW: 1,497 gas, 700 coal, 430 nuclear,
and 1,200 wind. Those are aggregated resource entitlements, including purchased
power, not four directly owned plants. Austin Energy distinguishes operated,
co-owned, and contracted resources. The package therefore includes coordination
and contributions to suppliers, rather than asserting ownership of every turbine.
[Austin Energy ownership explanation](https://austinenergy.com/about/company-profile/electric-system/power-plants).

Vistra reported about $50M–$60M of enhanced fleet winterization, using $55M in
its 2022 CDP risk response. Its 2020 Form 10-K lists 17,623 MW in Texas. Assigning
all $55M to that Texas fleet is conservative compared with dividing by its larger
national portfolio; the disclosure does not provide a precise regional or
technology allocation. These are observed corporate expenditures, not an Austin
quote. [Vistra CDP, PDF p. 10](https://vistracorp.com/documents/sustainability/reporting-year/2021/2022%20VST%20CDP%20Response%20Final.pdf),
[Vistra 2020 10-K, printed p. 5](https://investor.vistracorp.com/image/2020-10-K.pdf).

CPS Energy reported $2M of additional protection in December 2021, including
temporary structures, heaters and barriers, after nearly $20M since 2011. The
Dallas Fed separately summarized FERC/NERC estimates for gas-plant equipment and
much larger, differently scoped gas-well and wind measures. Neither statewide
annual well spending nor the economic damage avoided by preventing blackouts is
the correct one-time fee for this utility.
[CPS Energy, December 3, 2021](https://newsroom.cpsenergy.com/update-on-planned-outages-to-prepare-for-winter-weather/),
[Dallas Fed, April 15, 2021](https://www.dallasfed.org/research/economics/2021/0415?lv=true).

Wind introduces the largest uncertainty. Gruber et al.'s 2021 preprint acknowledges
limited cost evidence. Appendix A.8 uses a 5% wind investment adder, $65M/GW,
based on an industry/media estimate. It also assumes much costlier thermal
protection: $112M/GW gas and $224M/GW coal, each 10% of plant investment; the
coal percentage is an assumption. Those are modeled comprehensive allowances,
not observed retrofit invoices. The final paper appeared in Nature Energy in
2022; unseen final supplementary values were not substituted for the inspected
preprint. [Original preprint, Appendix A.8](https://arxiv.org/pdf/2105.05148),
[final publication](https://www.nature.com/articles/s41560-022-00994-y).

Our calibration combines the observed thermal anchor with the generous wind
allowance, retaining the full contracted wind scope:

| Component                       | Calculation                           | 2020 dollars |
| ------------------------------- | ------------------------------------- | -----------: |
| Existing thermal                | $55M / 17.623 GW × 2.627 GW × 0.95513 |       $7.83M |
| Existing wind                   | $65M/GW × 1.2 GW × 0.95513            |      $74.50M |
| Representative new gas capacity | $55M / 17.623 GW × 1.8 GW × 0.95513   |       $5.37M |
| Total, then rounded             | $87.70M                               |     **$90M** |

This is an inferred allowance for the existing portfolio and ordinary pre-freeze
expansion. Per-MW scaling misses site-specific fixed costs. It is not a literal
quote covering unlimited future construction. The $40M–$150M sensitivity allows
partial versus fuller wind treatment and higher execution/thermal costs. The
old $250M is 178% above $90M and 67% above that sensitivity's upper endpoint.

There is meaningful contrary evidence: applying the preprint's comprehensive
thermal assumptions as well yields approximately **$384M in 2020 dollars before
nuclear**. Against that scope, $250M would be only 35% low. Therefore the correct
claim is that $250M is excessive for the **targeted loss-reduction package being
offered**, not that every possible winterization project must cost under $150M.

**Implementation:** charge $90M at every difficulty for plant protection and
supplier coordination ahead of February 2021. Keep the demand spike, gas-price
spike, and residual output losses. Preparation can be economically attractive;
that is consistent with its purpose. Do not inflate its price solely to equalize
end-game wealth. The exact halving of losses remains a transparent simulation
abstraction.

## Wildfires: a finite local response package

**October 21, 2026 update:** the former random plant derates, two-month blanket
customer reductions, difficulty-dependent physical damage and 50% preparedness
protection have been removed. Historical balance tables using those assumptions
do not describe the current model.

The mission represents 1% of LADWP, about 16,000 accounts. The cost comparator
remains SCE's recorded 2024 spending: $27.233M for PSPS execution O&M plus $36.059M
for aerial standby. Transferring those broad annual costs at
16,000 / 5,300,000 accounts gives approximately $191,070 in 2024 dollars. The
round $200k allowance is a transferred readiness and logistics assumption, not a
LADWP quotation or the price of buying a generator. Different geography,
exposure and fixed costs limit linear account scaling.
[SCE testimony, printed pp. 63–83](https://docs.cpuc.ca.gov/PublishedDocs/SupDoc/A2512002/8780/590427263.pdf),
[Edison account denominator](https://www.sec.gov/Archives/edgar/data/92103/000082705224000017/eix-20240223xex99d1.htm).

The authored mission offers a one-time $200k deployment package at every
difficulty. Custom games selecting that historical scenario can instead reserve
the same package using a $200k annualized budget, prorated monthly while enabled
and ending after the incident month. Availability is immediate; this is an
explicit reservation design, not an empirically measured preparation lead time.
Neither mode promises to recoup its expense through electricity sales.
The $200k readiness allowance is an explicit fixed game budget. Imported repair
costs instead retain their sourced 2025 monetary basis and convert to the receiving
incident year, preserving the mission's lead time before applying grid-size scaling.

The finite package reserves one 200 kW mobile diesel, with service limited to
150 kW and 24 hours of initial fuel: **3.6 MWh total** for eligible local critical
sites during the January incident. PG&E's July 20–21, 2024 report lists 0.2 MW
reserve units with a 24-hour estimated runtime at 75% load. Allocating one such
unit to this mission is a game procurement choice, not a claim LADWP deployed
that particular unit. Refueling is not assumed. Backup cannot reconnect a
damaged utility feeder or reduce the fire footprint.
[PG&E report, Table 14](https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/7-20-2024-psps-post-event-report-08-02-2024.pdf).

### Customer isolation and restoration

The simulation uses only the observed January 14–28 reporting window. LADWP
reported 17,962 fire-related interrupted accounts on January 14, approximately
9,500 on January 20, approximately 8,500 on January 21 and approximately 8,410
on January 28. Linear interpolation at day precision yields **3,613,704 estimated
account-hours**. Dividing by the scenario's 1.6M-account reference and the
engine's 730-hour month gives a **0.3094% monthly grid-service estimate**.
[January 14](https://ladwpnews.com/8pm-update-january-14-2025-ladwp-windstorm-and-fire-response-continues/),
[January 20](https://ladwpnews.com/january-20-2025-morning-update-ladwps-windstorm-and-wildfire-response/),
[January 21](https://ladwpnews.com/january-21-2025-evening-update-ladwps-windstorm-and-wildfire-response/),
[January 28](https://ladwpnews.com/remarks-by-ladwp-executives-about-wind-and-wildfire-response-january-2025-presented-at-board-of-water-and-power-commission-meeting-jan-28/).

This assumes an interrupted account carries average system load, solely as a
service and billing proxy. The sources do not report measured outage energy.
Earlier snapshots combine windstorm and fire effects; later counts include
destroyed premises whose continuing demand is unknown. Neither is extrapolated
into the quantified window. The representative-day engine uses a monthly energy
equivalent and does not reproduce chronological outage or backup endurance.

Repair costs use **$780k in 2025 dollars**, exactly 1% of LADWP's $78M estimate.
The source includes windstorm, wildfire, rainstorm, immediate response labor and
repair/rehabilitation, rather than wildfire-only damage. Three equal $260k
January–March installments are a billing convention, not an observed spending
curve. There is no severity-to-cost interpolation or difficulty multiplier.
[LADWP March 20 report](https://cityclerk.lacity.org/onlinedocs/2025/25-0006-S23_rpt_dwp_3-20-25.pdf).

The April report describes service restored to standing structures by March 21
while rebuilding continues. It does not claim every damaged asset was repaired
at that point; temporary rebuilding continued through July.
[LADWP rebuilding progress](https://webprod.ladwp.com/community/restoration-and-rebuilding-efforts/power-rebuilding).

The owning data and mechanism details are in
[`CaliforniaWildfire.ts`](../data/CaliforniaWildfire.ts) and the
[wildfire model research](../../docs/wildfire-model-research.md).

## Validation and update policy

The coder applies the research-derived amounts and descriptions. An independent
QA agent runs both options in all three scenarios at Intern and CEO: twelve
scenario/choice/difficulty combinations, each with a successful strategy and a
plausible failure. Additional comparisons test the value of phased connections
and protection versus construction. Any identified balancing change goes back to
the coder and through QA again; unsupported prices must not be reinstated merely
to absorb surplus cash.

The separate balance report records the final empirical results. Required
repository checks, production build, and browser checks of both palettes and
desktop/mobile choices cover mechanics and presentation. Passing this matrix
establishes tested paths to victory and defeat, not a proof for every possible
strategy or seed. The PR already changes save/replay versions relative to its
base, so these additional unmerged price revisions stay within that compatibility
boundary.
