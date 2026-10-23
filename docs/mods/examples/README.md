# Scenario examples

Copy one of these packages to start your own scenario. Each combines a starting
grid, events or imported challenge arcs, choices, goals and a final report. For
smaller examples of individual features, use the
[mechanism recipes](../authoring.md#executable-recipes).

Give your copy a new `id`, `title`, `creator` and `description`. Keep its `$schema`
path pointed at [scenario.schema.json](../scenario.schema.json), then import the
file through **Mods** to try it. The [authoring guide](../authoring.md) covers
editing, simulation and publishing; the [format reference](../../mods.md) lists
fields and limits.

| Package                                                                 | Use it to learn                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Funded or phased connection](funded-or-phased-connection.json)         | Import a challenge's choices and loads, then set your own goals.                    |
| [Prepare before the freeze](prepare-before-freeze.json)                 | Keep a challenge's goals and add a report around its main event.                    |
| [Two dry years](two-dry-years.json)                                     | Write timed effects and choices that enable conditional events.                     |
| [Retire coal without a bill shock](retire-coal-without-bill-shock.json) | Change construction costs and combine retirement, bill, debt and reliability goals. |

## Funded or phased connection

`baseScenarioId: 106` supplies the Data Center Boom starting grid.
`officialArcs` imports its connection choice: accept funding and connect the full
100 MW load, or connect two 50 MW phases.

The package uses `objectives.mode: "replace"` to require reliable service after
connection and customer retention at the end. Its `dataCenter` debrief reports
blackouts and the change in electricity tariffs.

Adapt the goal windows and thresholds to change the challenge. Use the
[arc reference](../arc-reference.md#106--data-center-boom) for imported choice and
load IDs if you want to add conditions or replace a future load.

## Prepare before the freeze

`baseScenarioId: 107` and `officialArcs` bring in Deep Freeze's starting grid,
winterization choice and freeze. `objectives.mode: "inherit"` keeps its reliability
goal.

The `deepFreeze` debrief covers three consecutive months: before, during and after
the freeze. This is a starting point for adding feedback to an existing challenge.
Keep the report window aligned with the event if you change its timing.

## Two dry years

`baseScenarioId: 114` keeps The River Runs Dry's starting grid. `officialArcs: []`
removes its original event arc so the package can define two droughts of its own.

Each drought uses `hydroInflowMultiplier` for twelve months. Separate conservation
events use `requiresChoice` to apply a demand reduction and monthly expense only
when the company chooses conservation. The other option grants fuel funding.
The second year's choice is independent of the first.

Use this pattern for repeated crises with a fresh decision each time. Keep each
choice due before or at the start of its conditional event, and align the
reliability and emissions goals with the period you want players to manage.

## Retire coal without a bill shock

`baseScenarioId: 102` supplies the inherited coal fleet. The package moves its
starting year to 2020, omits the original arc with `officialArcs: []`, and reduces
replacement construction costs through `facilities` multipliers. `buildCost: 0.8`
means 20% cheaper; `yearsToBuild: 0.5` halves construction time.

Four goals require the player to retire coal while limiting bills and debt and
maintaining reliable service. `fuelMix` and `profitLoss` debriefs cover the period
after retirement.

Use this pattern to make a transition involve several tradeoffs. Leave enough
time to build replacements before the retirement deadline; paused and unfinished
coal plants still count as owned.
