# Major scenario choice balance QA

Run `npm test -- --watchAll=false --runInBand ScenarioChoiceBalance`.
Set `SCENARIO_CHOICE_REPORT=1` to print the matrix's measured cash and failure reasons.

The 16 tests run 36 real-reducer simulations: twelve scenario/difficulty/response cells,
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
| Deep Freeze | Intern     | Winterize         |          $7,085.3M | Fired month 84: February demand served 90.39%, needs 100%  |
| Deep Freeze | Intern     | Keep budget       |          $7,335.0M | Fired month 84: February demand served 69.65%              |
| Deep Freeze | CEO        | Winterize         |          $6,163.2M | Fired month 84: February demand served 85.59%              |
| Deep Freeze | CEO        | Keep budget       |          $6,421.6M | Fired month 84: February demand served 65.34%              |
| Wildfire    | Intern     | Prepare           |             $93.1M | Fired month 36: emergency demand served 97.07%, needs 100% |
| Wildfire    | Intern     | Keep cash         |             $95.0M | Fired month 36: emergency demand served 95.75%             |
| Wildfire    | CEO        | Prepare           |             $34.1M | Fired month 36: emergency demand served 98.14%             |
| Wildfire    | CEO        | Keep cash         |             $40.9M | Fired month 36: emergency demand served 95.48%             |

## Why these amounts and branches

**Winterization costs a fixed $250M.** An initial $40M quote was affordable but very small
beside roughly $3B of cash in successful plans at the prompt. QA compared actual alternative
fleets before the coder raised it to $250M. The final standard winning plans record $3,228.9M
Intern / $2,844.3M CEO in the choice month; winterization leaves $2,978.9M / $2,594.3M.
The fee is meaningful and affordable. Charging the same nominal amount reflects the same
service: difficulty already changes construction costs, lead times, operating expenses and
outage penalties. An extra easy-mode discount was unnecessary.

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

Wildfire's existing difficulty-based $2M Intern / $7M CEO preparation prices remain unchanged.
Its winning choice-month cash remains positive after paying: $57.1M / $20.9M. The new QA
found no required wildfire balance adjustment; preparation can be enough on Intern, while
mothballing needed gas still fails its physical reliability objective.
