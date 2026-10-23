# Create a scenario

## Start from a template or example

In **Mods**, choose **Save authoring template**. Keep `scenario.json` beside the
exported `scenario.schema.json` for offline editor validation and autocomplete.
You can also copy a [complete scenario example](examples/README.md).

Set your own `id`, `title`, `creator`, `version` and `description`. Keep
`schemaVersion: 1` and `gameApi: 1`. Set your starting conditions in `scenario`,
then add events, choices and goals using the [format reference](../mods.md).

## Executable recipes

These six-month packages demonstrate individual features. They start with ample
cash so you can explore each feature before balancing a full challenge. Keep the
relative `$schema` path correct when copying them.

| Recipe                                     | Demonstrates                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [effects.json](recipes/effects.json)       | Timed effects, charges, grants and a targeted output loss.                                            |
| [choices.json](recipes/choices.json)       | Paid and funded options, a conditional event, and load replacement or cancellation.                   |
| [objectives.json](recipes/objectives.json) | All eight goal metrics, with required and optional goals.                                             |
| [selectors.json](recipes/selectors.json)   | Targeting generators by size, age or seeded capacity share, and selecting an original starting asset. |

When adapting a recipe:

- Months start at `1`. An event starting in month `2` for `2` months is active in
  months 2–3 and expires at the opening of month 4. `"untilEnd"` includes the final
  month. Permanent loads remain connected after an event ends.
- Multipliers use `1` for unchanged: `0.9` means 10% less. Overlapping factors
  multiply, including static and timed cost modifiers. See the
  [units and bounds](../mods.md#units-and-numeric-bounds).
- A choice resolves before its due month runs. Every choice needs a free option;
  omit payment fields for a free option, or use `costDollars` / `grantDollars`.
- Use `requiresChoice` to enable an event for named options. Add `arc` when
  referring to an imported choice. Replace or cancel a load before it starts;
  `with: []` cancels it.
- Match goal and report windows to the event. Monthly reliability goals must pass
  in every month of their window. The [goal reference](../mods.md#goals)
  explains each metric.
- Transmission caps affect an operating connection; they do not build a line or
  grant access to imports.

## Validate and inspect

From a source checkout, run:

```sh
npm run mods:validate -- path/to/scenario.json --explain
```

Fix errors before importing or publishing. Warnings allow both, but may identify
an unintended rule. Validation checks every difficulty. `--explain` shows the
resolved setup, dates, effects, inherited goals and imported IDs; add `--json` for
machine-readable output.

Import the file and open **Author report** to inspect the same details in the game.
The report includes surprise events that player previews and Workshop Rules hide.
Use the validator even if your editor accepts the file: it also checks references,
timing, combined effects, starting assets and byte limits.

## Keep player text brief

Lead with the change or choice: “Hydro inflow is down to 50%.” Write “dollars,”
not “starting-year dollars.” Use dates instead of asking players to count months:
`{{start+12 months}}` refers to the scenario start; `{{event+3 months}}` refers to
an event opening (or a choice's decision date). `{{event}}` gives that date itself.
See [date substitutions](../mods.md#dates-in-player-text) for scope and examples.

Omit fields that use defaults: `baseScenarioId`, `seed`, `officialArcs`,
`objectives`, `visibility`, `includeChoices`, `preview`, and free-option payment
fields. See the [format reference](../mods.md#package-contract) for their defaults.
Use a plain `objectives` list only when changing the goals. An empty list clears
base goals; omission keeps them.

## Try each branch

Play through each decision and goal window. To simulate a package from a source
checkout:

```sh
npm run sim -- --mod docs/mods/recipes/effects.json
npm run sim -- --mod docs/mods/recipes/choices.json --responses responses.json
```

For the choices recipe, `responses.json` can contain:

```json
{ "responses": [{ "choiceId": "funding", "optionId": "accept" }] }
```

Use `choiceId` and `optionId` from your package; add `arc` for an imported choice.
A reached choice without an answer is an error. To select free options
automatically, pass `--free-fallback` instead of a responses file.

Use `--seeds` and `--difficulties` to try up to 20 combinations:

```sh
npm run sim -- --mod docs/mods/recipes/choices.json --free-fallback --seeds 1,2 --difficulties Intern,CEO
```

Review the outcome, goal results and any reported violations. A shortened
`--months` run does not establish that the full challenge can be completed. See
the [simulator guide](../../src/testing/README.md#validate-and-simulate-a-json-mod)
for CLI restrictions and output details.

After editing, reimport the package and start a new run. Existing saves keep the
rules they started with.

## Publish and update

Connect to Steam, import your package, then choose **Publish** and confirm the
upload. Complete Steam's Workshop agreement if prompted. To update an item, change
its `version`, reimport it with the same `id`, then choose **Upload update**.
You can also share the JSON file directly.

Write only your scenario's introduction in `description`. Each upload appends a
generated **Rules** section with the setup, goals and announced events and choices.
Surprise events stay hidden. The combined description must fit Steam's 7,999-byte
UTF-8 limit; shorten your introduction if the upload reports that it is too long.
