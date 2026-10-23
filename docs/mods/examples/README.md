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

For choice and load IDs when importing an official arc, see the
[arc reference](../arc-reference.md#106--data-center-boom). Smaller examples of
individual features are in the [mechanism recipes](../authoring.md#executable-recipes).
