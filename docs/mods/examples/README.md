# Scenario examples

Copy a package, give it your own `id`, `title`, `creator` and `description`, then
edit the rules it demonstrates. Keep `$schema` pointed at
[scenario.schema.json](../scenario.schema.json) and import your copy through **Mods**.
The [authoring guide](../authoring.md) covers editing and publishing; the
[format reference](../../mods.md) lists fields and limits.

Only **Funded or phased connection** uses a base scenario, imports official rules,
and pins a seed. The other three packages declare their own locations, starting
fleets, events and goals. Omitted fields use defaults.

| Package                                                                 | API features to adapt                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Funded or phased connection](funded-or-phased-connection.json)         | `officialArcs`: reuse a bundled challenge's choices and loads.                                           |
| [Two dry years](two-dry-years.json)                                     | `events`, `requiresChoice`: environmental effects, conservation and recurring expenses.                  |
| [Retire coal without a bill shock](retire-coal-without-bill-shock.json) | `facilities`, `objectives`: construction incentives, retirement deadlines and financial limits.          |
| [Bridge the maintenance gap](bridge-the-maintenance-gap.json)           | `startingAsset`, `byDifficulty`, `report`: targeted outages, difficulty-based prices and event feedback. |

## Import an official arc

**Funded or phased connection** imports Data Center Boom's connection choice and
load schedules through `officialArcs`. It replaces the goals with reliability and
customer-retention requirements and adds a `dataCenter` debrief.

Use the [arc reference](../arc-reference.md#106--data-center-boom) for the choice
and load IDs when adding conditions or replacing a future load.

## Write environmental events and responses

**Two dry years** declares two twelve-month droughts with `hydroInflowMultiplier`.
Each year's choice offers conservation or fuel funding. `requiresChoice` enables
the corresponding demand reduction and monthly expense only for conservation.
Reliability and emissions goals cover the response period.

Adapt the effect values, durations and conditions to build a crisis with several
stages. Each year has its own decision, so the player can change course.

## Shape construction and transition goals

**Retire coal without a bill shock** uses `facilities` multipliers to make
replacement plants cheaper and faster to build. `buildCost: 0.8` means 20% cheaper;
`yearsToBuild: 0.5` halves construction time.

Player dates use `{{start+24 months}}` instead of “month 25.” Its goals combine coal retirement, billed-rate and debt limits, and reliable
service. Adapt the incentives and deadlines together to create a transition with
financial tradeoffs. `fuelMix` and `profitLoss` debriefs review the result.

## Target an asset and vary the price

**Bridge the maintenance gap** uses `startingAsset` to take the original gas
peaker offline while leaving new generators available. A choice selects a short
paid overhaul or a longer funded one. `costDollars.byDifficulty` sets a different
price for each difficulty without duplicating the choice.

Messages use `{{event+3 months}}` to show the actual return date. An `affectedFacilities` report names the targeted plant. Use this pattern for
maintenance or plant-specific disruptions, keeping goal and report windows aligned
with the outage.

For smaller examples of individual features, see the
[mechanism recipes](../authoring.md#executable-recipes).
