# Headless simulation

Customer program balance coverage lives in `PolicyBalance.test.tsx`. The simulator accepts
`initialPrograms: { efficiency: "Small", solar: "Large" }` and schedules each through the real
reducer for month two. The matrix compares Off, Small, Large, solar-only, and combined funding
in Paradise, Data Center Boom, and Deep Freeze, including every cash/energy invariant.
Program costs are authored game assumptions, scaled by initial customer market and demand
scale, then inflated from the starting year. Adoption is allocated once at the month boundary;
its actual cost is spread across that month's ticks. Installed upgrades persist within the run.
These automated tradeoff checks do not replace the issue's proposed first-time-player playtest.

Plays the game without a browser, then checks that the economy behaved lawfully. A 20 year
scenario runs in about half a second, so a change to the simulation can be sanity checked in
seconds instead of by clicking through the UI in real time.

```sh
npm run sim -- --all
```

```
  SCENARIO                  MONTHS   OUTCOME              CASH      UNSERVED  INVARIANTS
  ------------------------- -------- -------------------- --------- --------- ----------
  Carbon Fee                144      bankrupt @ month 54  $-1M      0.3%      ok
  The Shale Boom            240      bankrupt @ month 104 $-1M      0.7%      ok
  Paradise                  144      bankrupt @ month 43  $-3M      0.1%      ok
  ...
  All scenarios hold every invariant.
```

Every scenario in one sweep, one line each. Then drill into one:

```sh
npm run sim -- --scenario 103 --strategy keepUp
```

which prints a month by month table (customers, demand, supplied, unserved, cash, net worth,
profit, emissions), the number of recorded player actions, totals for the run, the fleet it
finished with, and any invariant violations. Outcomes match the real game: completed, bankrupt,
or fired after three consecutive months below 90% supplied.
`npm run sim -- --help` lists the flags; `--list` shows the scenario ids.
One explicit storage decision can be replayed with, for example,
`--build Battery --build-mwh 800 --finance`; generator builds use `--build-mw`.
Pass `--without-stories` to run the same playthrough as an authored-effects control.

Story balance uses the checked-in seeds 1–20 across all six scored scenarios and five
difficulties, running the same UI-legal playbooks as the CEO economics tests with authored effects
disabled and enabled:

```sh
npm run sim -- --matrix
```

Each cell records outcome month, unserved share, ending cash, generation mix, phase keys,
onset-selected facility IDs, and resolved effects (`--full` prints the records). A failure-rate
gate is only calculated when at least 12 baseline seeds complete; otherwise the cell reports
`INSUFFICIENT COVERAGE` instead of a misleading percentage. The story run may fail no more than
25% of those otherwise-successful seeds.

The forecast performance gate is independently reproducible:

```sh
npm run sim -- --benchmark-stories
```

It compares median warmed 20-year hourly Shale forecasts with scheduled story resolution disabled
and enabled across a ten-facility fleet, a reasonable worst case for normal play. It fails above a
15% regression.

`--year` and `--location` play an authored scenario somewhere or somewhen else, which is the
only way to exercise a start past the recorded weather from the command line:

```sh
npm run sim -- --scenario 103 --year 2080 --months 240 --strategy keepUp
```

Both come back as a custom game rather than the scenario they started from, because that is what
they are: `initGame` resolves an authored id straight back out of `SCENARIOS`, so an edited copy
handed over under its original id would have its edits silently dropped.

## What it checks

The point is not the numbers, it's the **invariants** -- rules the economy must obey no matter
what the balance looks like. They run on every tick of every simulated month, and each violation
reports the game time it happened and the values involved, so a broken run points at a line of
code rather than a vibe.

|                     |                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finite values       | No `NaN` or `Infinity` reaches any tick or monthly field. `NaN` propagates silently through the whole economy, so this is the one that catches the most                                           |
| Signs               | Supply, demand, customers, stored energy, revenue and every expense stay non-negative; demand stays positive. Cash and net worth may go negative, by design                                       |
| Cash continuity     | Within a month, cash moves by exactly the tick's own revenue minus its recorded expenses, allowing for loan principal, which is spent but not recorded on the tick                                |
| Energy conservation | Stored energy moves by exactly what the storage fleet charged or discharged. Storage cannot invent electricity                                                                                    |
| Fleet bounds        | Generators output between 0 and their rated power, storage stays within its rated power and capacity, construction time never goes negative, loan balances stay between 0 and the original amount |
| Supply accounting   | Gross generation plus storage discharge and imports, minus grid-side charging and exports, equals `supplyW`                                                                                       |
| Monthly totals      | Billed supply never exceeds demand, and every total is finite                                                                                                                                     |

`Simulation.test.tsx` asserts all of this as part of `npm test`, across every scenario, both ends
of the difficulty range, customer price competition, and a run that builds on credit. It also pins down
determinism and a few economic identities (revenue really is rate times kilowatt hours, the carbon
fee really is proportional to emissions).

`createGame` is exported for tests that want a realistic mid-game state without running a whole
simulation -- `reducers/BuildFacility.test.tsx` uses it to check what building actually does.

To confirm the checks still bite, break something on purpose -- halve the energy storage
discharges, or drop a term from the cash calculation -- and watch the suite name the tick it
first went wrong.

## How it works

`Simulator.tsx` drives the game's real reducer. It sets a game up the way a real playthrough does
(`start`, then `delta` for difficulty, then `initGame`), then calls `tickState` in a loop instead
of the `tick` action, which paces itself off `performance.now()` and `setTimeout`. Nothing is
reimplemented: if the reducer is wrong, the simulation is wrong in the same way, which is the
entire point.

It runs under CRA's jest because the reducer needs TypeScript, JSX and a DOM. `npm run sim` shells
out to jest pointed at `SimCli.tsx`, which is named so CRA's default `testMatch` ignores it and
`npm test` stays free of simulation output.

## Things worth knowing before you change this

- **`Simulator` imports `Store` even though it drives the reducer directly.** The game reducer
  dispatches follow-up actions of its own -- the tick timer, the construction complete snackbar,
  the end of game dialogs -- and reaches them through `StoreRegistry`, which needs a store to have
  been created. `ImportOrder.test.tsx` guards the module graph that makes this safe from any entry
  point; it used to be that loading `Game` before `Store` crashed on startup.
- **The first month is recorded on the first tick.** `previousMonth` starts empty, so a rollover
  fires immediately and a 144 month run reports 145 months. That is the real game's behavior, and
  the extra entry summarizes a full generated day, not a single tick.
- **The seed only matters past the recorded data.** Weather runs 1980-2025 (fuel prices have a
  shorter record); inside the weather window every seed agrees. Weather in scenarios starting in
  2026 diverges immediately.
- **A month rollover is not one simulation step.** It regenerates the timeline and pre-rolls four
  more frames against the same tick. Anything measured by diffing consecutive ticks has to skip
  rollovers, which is why the cash and energy checks only run within a month.
- **`getFuelPricesPerMBTU` loops forever if no prices are loaded**, and `getWeather` throws. Any
  non-browser entry point has to call `loadSimData` first.

## Time-triggered scenario choices

Add a definition to `src/data/ScenarioChoices.ts`: a unique persisted `id`, scenario ID,
zero-based trigger month, prompt, and options with stable IDs, outcome copy and difficulty-based
upfront costs. Include a free option so a player with no cash can still choose. Definitions are
presented in array order when several are due. No UI or reducer wiring is needed.

Use `description` for consequences shown before commitment, `upfrontGrant` for a one-time
company contribution, and `loadAdditions` to replace an authored connection schedule. Grants
are booked as company revenue, never as a plant's electricity sales. Multiple load additions
with the same demand type should share a label because Insights groups them into one series.

The shared modal blocks navigation and dismissal; the reducer blocks the clock until an explicit
response is accepted. Selecting closes the prompt and leaves play paused so the player can inspect
the result before resuming. Saves retain unanswered prompts and replay actions retain answers.

Accepted choices are story occurrences with the definition ID as their key and
`attributes.choice` as the option ID. Future `WorldEvents` phase descriptions and previews can
read these through `context.occurrences` (see `wildfirePrepared`) to branch narrative and effects.
The forecast cache includes occurrence attributes, so an answer refreshes future effects.
Costs are charged once and retained as operating expenses through reforecasting.

The headless baseline bot explicitly selects the first free option. Add focused reducer tests
for each consequential branch, including future effects, save and replay parity.
Pass `scenarioResponses: { [decisionId]: optionId }` to select a specific branch in a simulation;
an invalid or unaffordable response throws instead of leaving the bot stuck at the prompt.
See [the scenario choice balance report](SCENARIO_CHOICE_BALANCE.md) for the reproducible
Data Center, Deep Freeze and Wildfire win/loss matrix and price rationale.
