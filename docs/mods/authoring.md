# Scenario authoring tools

Save an authoring template from **Mods → Save authoring template**. The game writes
the package and `scenario.schema.json` together. Keep them in the same folder: the
package's `$schema: "./scenario.schema.json"` works in an offline editor. `$schema`
does not affect package identity or a saved game's rules.

Validate before importing or publishing:

```sh
npm run mods:validate -- path/to/scenario.json
npm run mods:validate -- path/to/scenario.json --explain
npm run mods:validate -- path/to/scenario.json --json --explain
```

Errors exit nonzero; warnings alone do not. The compiler checks every difficulty,
not just the selected one. `--explain` includes inherited content, real engine
starting peak MW, month/calendar windows, all possible seeded openings, composed
monthly effect bounds, imported IDs, choice dependencies, selector semantics,
absolute carbon fees and the recorded facts behind each report. The app's
**Author validation report** uses the same report. It includes surprise events;
player previews and generated Workshop Rules include forecast events only.

The [editor schema](scenario.schema.json) provides field units, numeric bounds,
union shapes and unknown-field checks. Production validation additionally checks
references, term-relative windows, reachability, composed effects, starting assets
and UTF-8 byte limits. Text limits count UTF-16 code units in the parser; editors
can count Unicode code points instead. Always run the production validator.

## Executable recipes

Each recipe is a complete six-month package. Copy it next to the schema and keep
its relative `$schema` path correct. These are unit and boundary examples; the
large cash reserve makes each mechanism easy to exercise independently.

| Recipe                                     | Mechanisms                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [effects.json](recipes/effects.json)       | Every timed effect, both transaction kinds and a targeted generator loss.                  |
| [choices.json](recipes/choices.json)       | Cost/grant choices, a conditional event, replacement load and explicit cancellation.       |
| [objectives.json](recipes/objectives.json) | All eight objective metrics, including required and optional goals.                        |
| [selectors.json](recipes/selectors.json)   | Largest, oldest, seeded capacity share, minimum age and original starting-asset selection. |

Multipliers use `1` for unchanged: `0.9` means 10% less, not 90% less. Fuel price,
construction and operating cost factors are `0.1–10`; output is `0–1`. Demand is
`0.1–10`. Hydro inflow allows `0` (no inflow); positive composed inflow must stay
`0.1–10`. Static and simultaneous timed costs compose, so static `5` with timed `2`
is the valid upper boundary `10`; static `5.01` with timed `2` is rejected.

| Effect                                   | Unit and boundary example                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temperatureOffsetC`                     | Additive °C, `-30–30` per event. The recipe adds `1 °C`.                                                                                                                                                                                                                        |
| `operatingExpenseDollarsPerMonth`        | `0–1e12` starting-year dollars per active month; `1000` adds $1,000/month.                                                                                                                                                                                                      |
| `transactions`                           | One-time `grant` or `charge`, `0–1e12` starting-year dollars. `10000` grants $10,000 once at onset.                                                                                                                                                                             |
| `carbonFeeDollarsPerTonneCO2e`           | Absolute `0–100000` dollars/tonne CO₂e. `25` replaces the initial fee with $25/tonne while active; `0` explicitly waives it. Co-reachable overlapping overrides are rejected.                                                                                                   |
| `outputMultipliersBySelector`            | Bind original generators at onset, then apply `0–1` output. `0` disables output; `1` leaves it unchanged. A sold original never transfers its target identity to a replacement.                                                                                                 |
| `transmissionCapacityLimitsMWByCorridor` | Map registered corridor IDs to absolute `0–1e6` MW caps. `{"california-north":4}` limits the northern route to 4 MW, including upgrades, before weather derating. `0` closes it in both directions. Overlapping caps take the smallest value; independent routes are unchanged. |
| Permanent `loads`                        | `peakMW: 100` means 100 MW, converted once to watts. Alternatively, `peakShareOfStartingPeak: 0.2` means 100 MW on a 500 MW baseline. Choose exactly one sizing field. Load factor is `0.01–1`.                                                                                 |

Months are one-based: month `1` opens before the first tick. The six-month recipe
uses an event starting at month `2` for `2` months, active in months `2–3` and expired
at month `4`. A seeded `{ "from": 2, "to": 3 }` start can open in either month.
`"untilEnd"` lasts through the final playable month. A load's start is independent
of event duration; permanent loads survive event expiry.

A corridor cap changes an existing connection's physical rating; it does not build
a line or grant import access. The northern-route example has no physical effect
until that route is operating. Native Wildfire supplies an operating northern
intertie; a community scenario based on it freezes its researched access limits
with the starting connection. Older imported snapshots retain their original
access terms and compiled effects.

A choice resolves before its due month's simulation. Each option has exactly one
`costDollars` or `grantDollars`, including a free `costDollars: 0` response. The
choices recipe either grants $100,000 and replaces the future 0.1 MW campus, or
forgoes funding and cancels that load with `with: []`. Replacement must occur before
the original load starts. `requiresChoice` uses stable choice/option IDs; add `arc`
only when referring to an imported official choice.

## Objective units and windows

The schema, author report and game UI use the evaluator's shared
[definition sentences](objective-definitions.md). That table is generated from the
same owner; the recipe demonstrates all metrics:

| Metric                     | Target and observation boundary                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monthlyReliability`       | Minimum customer demand served share `0–1` in **every** completed month of the inclusive window. `1` requires full service; averaging good and bad months does not pass it.                  |
| `customerRetention`        | Minimum retained starting-customer share `0–1`, measured at the deadline. `1` means the initial customer count.                                                                              |
| `emissionsBudget`          | Total electricity and construction emissions in tonnes CO₂e, `0–1e12`, over the inclusive window, including imports and exports. `0` permits none.                                           |
| `emissionsPerDeliveredMWh` | Total kg CO₂e, including imports, exports and construction, per delivered customer MWh, `0–1e6`, over the inclusive window.                                                                  |
| `localFuelShare`           | Minimum declared fuel share `0–1` of the declared local-generation denominator. Imports and storage discharge have no fuel provenance.                                                       |
| `fuelRetirement`           | Own no asset of the named fuel, including paused and unfinished assets, at the deadline and every later month close. An absent starting fuel produces a warning, not an invented retirement. |
| `monthlyBilledRate`        | Maximum realized billed dollars/kWh, `0–100`, in every completed month of the inclusive window; tariff settings alone are not the measurement.                                               |
| `monthEndDebt`             | Maximum owned outstanding facility/transmission loan principal, `0–1e12` starting-year dollars, at each completed month close in the inclusive window. Interest is excluded.                 |

`inherit` retains base goals and accepts `add`; `replace` takes only `items`; `none`
declares no scenario goals. Empty `replace` and empty `inherit` retain those distinct
intentions. Ordinary game failures still apply. The author report supplies inherited
goals as replacement-ready JSON with their resolved window offsets.

## Simulate explicit decisions

```sh
npm run sim -- --mod docs/mods/recipes/effects.json
npm run sim -- --mod docs/mods/recipes/choices.json --responses responses.json
npm run sim -- --mod docs/mods/recipes/choices.json --free-fallback
npm run sim -- --mod docs/mods/recipes/choices.json --free-fallback --seeds 1,2 --difficulties Intern,CEO
```

For the choices recipe, `responses.json` can contain:

```json
{ "responses": [{ "choiceId": "funding", "optionId": "accept" }] }
```

The choice reference matches `requiresChoice`; `optionId` selects exactly one
option and `arc` optionally names its imported official arc. A reached decision without a response is an
error unless `--free-fallback` was explicit; each fallback is printed. Known
responses that the actual run never reaches produce warnings. Unknown choices or
options are errors. Use `--seeds` and `--difficulties` for at most 20 combinations.
`--mod` cannot be combined with `--scenario`, `--year`, `--location`, `--all` or the
ordinary scenario matrix. A shortened `--months` run reports incomplete progress.

Simulation uses the real reducer and prints seed, difficulty, package/runtime
digests, reached responses, objective results, outcome and invariants. Re-import an
edited package to begin a new run; existing saves retain their frozen rules.

## Publish

Edit only the authored `description`. Each upload regenerates the public Rules
from the validated package: base, duration, objective definitions and forecast
events/decisions. Surprise facts and private author-report sections are omitted.
Steam allows 7,999 UTF-8 bytes of description text after reserving its terminator;
an oversized description is rejected with an actionable message rather than
truncated. The uploaded package remains `scenario.json` only.

Maintainers regenerate checked-in artifacts with `npm run mods:schema` and
`npm run mods:recipes`; append `-- --check` to detect drift. Tests validate and
simulate all recipes and every consequential choice branch.
