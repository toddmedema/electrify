# Major scenario choice balance QA

See the [cost research report](SCENARIO_CHOICE_RESEARCH.md) for sources, monetary
normalization, and uncertainty behind the final amounts.

Run `npm test -- --watchAll=false --runInBand ScenarioChoiceBalance`.
Set `SCENARIO_CHOICE_REPORT=1` to print the matrix's measured cash and failure reasons.

The 18 tests run 40 real-reducer simulations: twelve scenario/difficulty/response cells,
a winning and losing plan in each, plus paired strategy comparisons. They use the simulator's
default seed **12345** for Data Center and Wildfire, and Deep Freeze's authored seed **268107**.
This proves reachable outcomes for reproducible seeds; it is not
a claim that every strategy or weather seed wins. Both answers must actually be accepted before
the outcome, all tick/month invariants must pass, and winning runs must clear the scenario's
real duration, reliability/customer-retention objectives, and meaningful-decision requirements.
Losses must remain losses without the meaningful-decision gate.

## Plans and results

Winning plans are `INTERN_ONE_BUILD_PLAYS` and `STANDARD_BALANCE_PLAYS` in
`BalancePlaybooks.ts`. Intern finances 50 MW gas in Data Center, 1,800 MW in Deep Freeze,
and 20 MW in Wildfire at the start. CEO uses the existing full, persistent operating plans,
including their rate, dispatch, intertie, program and retirement decisions. No test grants
cash or changes starting state outside normal player actions.

The losing Data Center plan answers the prompt but never expands. The losing Deep Freeze
plan answers, then mothballs coal in month 37 and leaves it off. The losing Wildfire plan
answers, then mothballs gas in month 12 and leaves it off. These latter plans overestimate
how much emergency preparation can replace dependable backup. All month numbers below are
elapsed game months; they include the scenario's normal end-of-mission objective evaluation.

| Scenario    | Difficulty | Answer            | Winning final cash | Losing outcome                                             |
| ----------- | ---------- | ----------------- | -----------------: | ---------------------------------------------------------- |
| Data Center | Intern     | Fast connection   |          $1,031.3M | Fired month 75: chronic blackouts                          |
| Data Center | Intern     | Phased connection |          $1,013.2M | Fired month 99: chronic blackouts                          |
| Data Center | CEO        | Fast connection   |            $641.4M | Fired month 192: 65% resident retention, needs 90%         |
| Data Center | CEO        | Phased connection |            $623.2M | Fired month 192: 65% resident retention, needs 90%         |
| Deep Freeze | Intern     | Winterize         |          $7,245.3M | Fired month 84: February demand served 90.39%, needs 100%  |
| Deep Freeze | Intern     | Keep budget       |          $7,335.0M | Fired month 84: February demand served 69.65%              |
| Deep Freeze | CEO        | Winterize         |          $6,323.2M | Fired month 84: February demand served 85.59%              |
| Deep Freeze | CEO        | Keep budget       |          $6,421.6M | Fired month 84: February demand served 65.34%              |
| Wildfire    | Intern     | Prepare           |             $96.2M | Fired month 36: emergency demand served 97.07%, needs 100% |
| Wildfire    | Intern     | Keep cash         |             $96.4M | Fired month 36: emergency demand served 95.75%             |
| Wildfire    | CEO        | Prepare           |             $44.6M | Fired month 36: emergency demand served 98.14%             |
| Wildfire    | CEO        | Keep cash         |             $44.6M | Fired month 36: emergency demand served 95.48%             |

## Why these amounts and branches

**Winterization costs a fixed $90M in 2020 dollars.** Real-world research supersedes the
previous $250M balance-only estimate. A normalized thermal-retrofit benchmark plus a conservative
allowance for wind protection gives $82.33M for the starting portfolio and $5.37M for a
representative 1.8 GW gas expansion, rounded from $87.70M to $90M. This is a transferred
budget estimate, not an Austin Energy quote. The research memo documents scope and uncertainty.
The same nominal fee applies to all difficulties; physical supplier costs do not rise with
player skill. Existing construction, operations and outage penalties already vary.
The standard winning plans record $3,228.9M Intern / $2,844.3M CEO in the choice month;
paying leaves $3,138.9M / $2,754.3M. The fee is affordable and may be attractive. It should
not be inflated merely to consume surplus cash or equalize final wealth.
Winterization supports 100 MW of new gas on Intern or 300 MW on CEO; both protected plans
win, while those same fleets without winterization lose the February objective (92.36% and
90.06% served respectively). Building 900 MW instead wins without winterization on both
settings. Paying for winterization on that already sufficient fleet leaves less cash at the
end. Thus preparation can substitute for capacity, while retaining the budget is valuable
when the player has already prepared through construction. Winterization does not remove
the cold-weather demand surge or gas-price spike. Intern can also win by winterizing its
intact starting fleet; it remains losable when the player mothballs needed capacity.

**The fast-connection contribution is a fixed $15M.** Successful plans have approximately
$142M CEO / $151M Intern before that contribution in the choice-month history, making it a
roughly 10% addition. A prepared grid earns more with the fast connection. Phasing still has
real value: on Intern, delaying the 50 MW gas build until month 72 loses under fast connection
(fired month 75), but wins under phasing. On CEO, moving that build to month 60, keeping the
other operating-plan actions, loses under fast connection (12,473 residents at the end) and
wins under phasing (17,653 residents; $853.8M cash). Phasing gives time rather than a free
cash reward, and does not protect a player who never expands.

**Wildfire preparedness now costs a fixed $200k**, decoupled from restoration charges.
Customer-scaled 2024 SCE operational preparedness and aerial standby costs give a broad
$191k annual proxy, rounded to $200k for advance inspections, staged backup equipment and
response resources. This is a conservative transferred benchmark rather than a direct
LADWP invoice. The exact 50% reduction in physical effects remains an authored game assumption.

Both adequate-grid plans still win under either response. Keeping cash ends $143,587 ahead
on Intern and $5,603 ahead on CEO, so the free choice is neither unwinnable nor mechanically
dominated in these examples. The narrow CEO difference should not be presented as universal
parity: spending on preparation is often economically sensible. Poor dispatch still fails
the physical reliability objective after either answer. Choice-month cash after payment is
$58.9M Intern / $27.7M CEO.

**Restoration is separately calibrated to observed event costs.** LADWP's $78M January 2025
temporary-rebuild/response estimate becomes approximately $760k in 2024 dollars at 1% scale.
The report's 35,800 affected accounts divided by 1.6M gives 2.2375% disconnection. Scaling
the two-month $760k baseline by the scenario's 2%, 4%, 6%, 8% and 10% disconnections and
rounding gives monthly restoration budgets of **$350k / $700k / $1M / $1.35M / $1.7M**
from Intern through CEO. Their quoted two-month budgets are $700k / $1.4M / $2M / $2.7M / $3.4M.
These are inferred severity proxies, not five observed invoices or a validated repair-cost
curve. Generation losses, damage mix, restoration timing and fixed costs do not scale
perfectly with disconnected accounts. Preparation still leaves this baseline restoration
charge in place: its physical-loss reduction is not a separately validated repair saving.
Research provenance: [Vistra's 2021-reporting-year CDP response](https://vistracorp.com/documents/sustainability/reporting-year/2021/2022%20VST%20CDP%20Response%20Final.pdf),
[2021 winterization-cost preprint, Appendix A.8](https://arxiv.org/pdf/2105.05148),
[SCE's recorded 2024 wildfire costs, pp. 65–75](https://docs.cpuc.ca.gov/PublishedDocs/SupDoc/A2512002/8780/590427263.pdf),
and [LADWP's March 20, 2025 rebuild report, pp. 1–2](https://cityclerk.lacity.org/onlinedocs/2025/25-0006-S23_rpt_dwp_3-20-25.pdf).
