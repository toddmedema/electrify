# Scenarios, mods and Steam Workshop

Community scenarios work in solo play and co-op in the Steam/desktop edition.
Modded games are unranked and earn no official scores or achievements.

## Install and play

Open **Mods** to import a local JSON file or browse Steam Workshop. Subscribe on
Steam, then use **Check for updates** once the download finishes. Installed copies
work offline; the library holds up to 32 mods.

Choose **Play**, select a difficulty, review the setup, goals and announced events,
then **Start**. **Author report** reveals all rules, including surprise events.

Importing the same local ID offers **Update**, **Keep both** or **Cancel**.
Disable a mod to keep it installed without making it playable. **Remove** deletes
a local copy; **Unsubscribe** requires Steam. Updates and removal do not change
existing runs, replays or co-op campaigns. Start a new run to use an updated package.

## Create a scenario

Follow the [authoring guide](mods/authoring.md) to export a template, edit, validate,
play and publish. The [scenario examples](mods/examples/README.md) show complete
challenges; the [recipes](mods/authoring.md#executable-recipes) demonstrate individual
features. The reference below describes the package format.

## Package contract

The package is one UTF-8 JSON file, at most **256 KiB**. Scripts, expressions,
archives, custom media and extra upload files are unsupported. Technologies come from the bundled catalog; locations and starting fleets can be authored. The resolved package,
including imported content, must fit **512 KiB**.

Required fields are `schemaVersion: 1`, `gameApi: 1`, `id`, `title`, `creator`,
`version` and `description`. Everything else is optional.

- IDs use 1–64 lowercase ASCII letters, digits or hyphens, starting and ending with
  a letter or digit.
- Text is plain, without URLs, HTML, control characters, zero-width characters or
  bidi overrides. Limits are 100 UTF-16 code units for `title` and `creator`, 40
  for `version` and 2,000 for `description`. Titles also have a 128-byte UTF-8 limit.
- Optional `$schema` points your editor to a schema. It allows up to 2,048 safe
  code units; the game ignores it and never fetches it.
- Optional content fields are `scenario`, `facilities`, `programs`, `officialArcs`,
  `events`, `choices` and `debriefReports`. Unknown fields are errors at any depth.
  Runtime versions and digests are computed; do not add them to the package.

Omit `baseScenarioId` to build a scenario from custom-game defaults: San Francisco,
2020, 20 years, one million customers, $200 million, $0.07/kWh and a 500 MW gas
peaker. Set the fields you want to change under `scenario`.

Use `scenario.location` for your own location: `id`, `name`, `lat` and `long`, plus
optional `timeZone`, `country`, `admin`, `region` and watershed/resource metadata.
Set `scenario.startingFleet` to a list of plants, or `[]` to start with none:

```json
"startingFleet": [
  { "id": "gas-peaker", "name": "Natural Gas Peaker", "peakMW": 75 },
  { "name": "Battery", "peakMWh": 20 }
]
```

Generators use `peakMW`; storage uses `peakMWh`. `ageYears` defaults to zero.
Only give a plant an `id` when you need to target it with `startingAsset`; otherwise
one is assigned. Hydro can also use `hydroSiteId` and `reservoirFraction`.
The ordinary site inventory and technology availability checks still apply.

To adapt a built-in challenge instead, set `baseScenarioId` to an ID from the
[arc reference](mods/arc-reference.md). Its setup, goals and events become the
defaults; use `officialArcs: []` to omit its events. Explicit `scenario` fields and
`objectives` replace those defaults. Existing saved runs keep their frozen setup.

`seed` is optional, with a default of `0`. It selects a repeatable weather and
random-event sequence for balancing or reproducing a report. Most packages should
omit it; the arc-import example shows a pinned sequence. Use the simulator's
`--seeds` option to test other sequences without editing the file.

All money is in dollars at the scenario's start. The game handles inflation;
amounts need no repeated qualifier in player text.

### Dates in player text

Use `{{start+2 months}}` for two months after the scenario starts, and
`{{event+7 months}}` for seven months after the current event opens. Offsets count
elapsed months: a January 2020 start makes `{{start+12 months}}` January 2021.
`{{start}}` and `{{event}}` show the anchors themselves; singular `month` also works.

Use these in descriptions, event text/previews, choice text, goal/report labels,
and closing messages. In a choice, `event` means its decision date. In an event's
closing message it still means that event's opening date. Seeded events use their
actual opening in that run. Scenario descriptions, goals, debrief labels and
closing messages have only `start`; `event` is rejected outside events/choices.
Offsets are whole months from 0 to 1,200. Unknown names or malformed tokens are
validation errors; these substitutions cannot execute expressions or scripts.

For example, an outage opening in January 2021 can say:

```json
"message": "The gas peaker is offline until {{event+3 months}}."
```

Players see “The gas peaker is offline until April 2021.” Dates remain correct
when the start year or event schedule changes, including in saved/co-op games.

The [editor schema](mods/scenario.schema.json) describes field shapes and limits.
Run the validator before publishing: it also checks references, timing, combined
effects, asset availability and byte limits.

### Goals

Omit `objectives` to keep the normal/base goals. Supply a plain list to use your
own goals; `[]` means survival only. No mode field is needed:

```json
"objectives": [
  {
    "id": "service",
    "label": "Keep customers supplied",
    "metric": "monthlyReliability",
    "fromMonth": 1,
    "throughMonth": 24,
    "minDemandServedShare": 0.995
  }
]
```

The author report supplies inherited goals as editable JSON. Copy the goals you
want to keep into your list, then add or change goals there. Keep their windows
within the run. Required goals determine success; optional goals report results
without ending the company.

| Metric                     | Measurement and boundary                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monthlyReliability`       | Customer electricity delivered / customer demand in **every** completed month of the inclusive window; target `minDemandServedShare`.               |
| `customerRetention`        | Customers / recorded starting customers at `deadlineMonth`; target `minRetainedShare`. Earlier losses can be recovered before the deadline.         |
| `emissionsBudget`          | Cumulative electricity and construction tonnes CO₂e in the window, including imports and exports; target `budgetTonnesCO2e`.                        |
| `emissionsPerDeliveredMWh` | Total kg CO₂e / delivered customer MWh over the entire window; target `maxKgCO2ePerMWh`.                                                            |
| `localFuelShare`           | Selected fuels' delivered Wh / all local fuel-delivered Wh over the window; target `minShare`. Imports and storage have no fuel provenance.         |
| `fuelRetirement`           | Own no asset of `fuel`, including paused and unfinished assets, at the deadline and every later month close.                                        |
| `monthlyBilledRate`        | Actual billed customer revenue / delivered kWh, excluding grants and exports, deflated to dollars, each month; target `maxDollarsPerKWh`.           |
| `monthEndDebt`             | Owned outstanding facility and transmission loan principal at each month close, deflated to dollars; target `maxDebtDollars`. Interest is excluded. |

All goals have `id`, `label`, `metric`, and optional `required` (default `true`).
Retention and retirement use a deadline; other metrics use inclusive
`fromMonth`/`throughMonth`. Zero energy denominators are unavailable, not perfect
service or a zero-intensity success. Monthly goals never average a bad month away.
See [objective definitions](mods/objective-definitions.md) for a compact summary.

### Units and numeric bounds

| Fields                                                                                                         | Units and accepted bounds                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `seed`                                                                                                         | Integer 0–4,294,967,295. Controls repeatable event timing, target selection and simulation outcomes.                                                   |
| `scenario.startingYear`                                                                                        | Calendar year, integer 1980–2100, including the resolved base year.                                                                                    |
| `scenario.durationMonths`                                                                                      | Playable months, integer 6–1,200.                                                                                                                      |
| `scenario.startingCustomers`                                                                                   | Customer count, integer 1–100,000,000.                                                                                                                 |
| `scenario.startingDemandScale`                                                                                 | Dimensionless demand calibration, 0.01–100.                                                                                                            |
| `scenario.cash`                                                                                                | Dollars, 0–1e12.                                                                                                                                       |
| `scenario.dollarsPerkWh`                                                                                       | Dollars/customer kWh, 0–100.                                                                                                                           |
| `scenario.feePerKgCO2e`                                                                                        | Dollars/kg CO₂e, 0–100. This setup field uses kg; the timed fee field below uses tonnes.                                                               |
| Event `startMonth`, range `from`/`to`, choice `dueMonth`, load `startMonth`, report/goal windows and deadlines | One-based playable month, integer 1–1,200 and inside the resolved term. Windows include both endpoints.                                                |
| Event `durationMonths`                                                                                         | Integer 1–1,200, a complete difficulty table, or `"untilEnd"`. The onset month counts; effect-only durations are required.                             |
| `load.peakMW`                                                                                                  | Peak MW, 0.001–100,000.                                                                                                                                |
| `load.peakShareOfStartingPeak`                                                                                 | Share of the real first-year baseline peak, 0.000001–1; excludes future authored rules/loads from sizing itself. Choose exactly one load sizing field. |
| `load.loadFactor`                                                                                              | Annual average / peak, 0.01–1.                                                                                                                         |
| Static facility `buildCost`, `annualOperatingCost`, `yearsToBuild`; `programs.efficiency`/`solar`              | Dimensionless multipliers, 0.1–10.                                                                                                                     |
| Timed fuel/construction/operating price factors; `demandMultiplier`                                            | Dimensionless multipliers, 0.1–10, including composed reachable values.                                                                                |
| `outputMultipliersByFuel`, selector `outputMultiplier`                                                         | Remaining output share, 0–1. `0` disables output, `1` leaves it unchanged.                                                                             |
| `hydroInflowMultiplier`                                                                                        | Inflow factor, 0–10; composed positive values must be 0.1–10, while `0` permits no inflow.                                                             |
| `transmissionCapacityLimitsMWByCorridor`                                                                       | Absolute capacity cap by corridor ID, 0–1,000,000 MW.                                                                                                  |
| `temperatureOffsetC`                                                                                           | Additive °C, −30–30 per event.                                                                                                                         |
| `operatingExpenseDollarsPerMonth`                                                                              | Dollars per active month, 0–1e12.                                                                                                                      |
| Event transaction `amountDollars`, option `costDollars`/`grantDollars`                                         | One-time dollars per company, 0–1e12.                                                                                                                  |
| `carbonFeeDollarsPerTonneCO2e`                                                                                 | Absolute dollars/tonne CO₂e, 0–100,000.                                                                                                                |
| Selector `count` / `minAgeYears` / `targetCapacityShare`                                                       | Whole generator count 1–10 / age in years 0–200 / operating capacity share 0–1.                                                                        |
| Goal `minDemandServedShare`, `minRetainedShare`, `minShare`; report `minDemandServedShare`                     | Dimensionless share, 0–1.                                                                                                                              |
| `budgetTonnesCO2e` / `maxKgCO2ePerMWh`                                                                         | Tonnes CO₂e 0–1e12 / kg CO₂e per delivered MWh 0–1e6.                                                                                                  |
| `maxDollarsPerKWh` / `maxDebtDollars`                                                                          | Dollars/kWh 0–100 / dollars 0–1e12.                                                                                                                    |

For a baseline whose real starting peak is **500 MW**, `peakMW: 100` and
`peakShareOfStartingPeak: 0.2` both resolve to **100 MW**. The absolute form stays
100 MW if the base changes; the share form follows its resolved baseline. Read
resolved MW in the author report instead of estimating from customer count.

`scenario.ownership` is `Investor` or `Public`; `endTitle`/`endMessage` are plain
text up to 500 code units. Facility names are the schema's catalog names; effect
maps use fuels (`Sun`, `Uranium`, `Natural Gas`, etc.), not facility display names.
Fuel-price factors accept only priced fuels: Coal, Uranium, Natural Gas, Oil, Biomass.

## Events, choices and composition

A package permits 100 events, 32 choices with 2–8 options each, 16 goals,
16 debrief reports, and up to 4 loads, 10 selector operations and 2 transactions
per event. Imported arcs may add up to 200 events and 200 choices; all content
must fit the 512 KiB resolved-package limit.

Event, choice, load, report and goal IDs share a package namespace. Option IDs
are local to their choice. Use stable IDs rather than array positions.

An event has `id`, `title`, `message`, one onset month or inclusive seeded range,
and optional duration, preview, condition, effects, loads and reports. `preview` is optional and defaults to `message`; use a short future-tense preview
when it helps players prepare (at most 200 code units).
`visibility: "surprise"` hides its future schedule and mechanics from player
previews and Workshop Rules; it remains visible to the author. Messages and end
messages have at most 500 code units. At onset the live message states the actual
change. A message-only event needs no duration.

| Timed effect                             | Scope and composition                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transmissionCapacityLimitsMWByCorridor` | Caps an operating corridor, including upgrades, before weather derating. `0` closes both directions; overlapping caps use the smallest value. It does not build a line or grant import access.      |
| `fuelPriceMultipliers`                   | Multiplies current fuel prices by fuel. Simultaneous factors multiply.                                                                                                                              |
| `outputMultipliersByFuel`                | Multiplies output of all generators using the named fuel while active. Nameplate capacity is unchanged.                                                                                             |
| `outputMultipliersBySelector`            | Binds original generators once at onset; simultaneous output factors multiply for each original. Selling a target never retargets a replacement.                                                    |
| `demandMultiplier`                       | Multiplies customer demand while active.                                                                                                                                                            |
| `temperatureOffsetC`                     | Adds to the weather temperature used by the simulation; simultaneous offsets add.                                                                                                                   |
| `hydroInflowMultiplier`                  | Multiplies reservoir inflow while active; it does not directly multiply stored water or nameplate power.                                                                                            |
| `constructionCostMultipliersByFuel`      | Multiplies new generator construction quotes while active. Existing assets, debt and committed purchases retain their original prices.                                                              |
| `operatingCostMultipliersByFuel`         | Multiplies live operating expense of matching generators once while active.                                                                                                                         |
| `operatingExpenseDollarsPerMonth`        | Adds a monthly company expense; simultaneous expenses add.                                                                                                                                          |
| `transactions`                           | Books a charge or grant once at onset.                                                                                                                                                              |
| `carbonFeeDollarsPerTonneCO2e`           | Replaces the current carbon fee while active; it does not add to the initial fee. `0` explicitly waives the fee. Co-reachable overlapping absolute overrides are rejected, including seeded ranges. |

Static facility modifiers set starting-asset and new-purchase costs. Timed
construction factors multiply new quotes, leaving committed purchases unchanged.
Static `5` with timed `2` reaches the maximum `10`; `5.01 × 2` is rejected.
Timed operating factors apply during active months. Program modifiers change the
cost of the bundled efficiency and rooftop-solar programs.

A timed effect value, duration, capacity-share target or option amount may be a
number or `{"byDifficulty":{"Intern":1,"Employee":1,"Manager":1,"VP":1,"CEO":1}}`.
Supply every difficulty using the field's units and bounds. Tables cannot nest
or contain expressions. Validation checks each difficulty and possible branch
combination, including whether required fuel-share goals can be met together.

### Target selectors

| Selector                       | Exact selection                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `largestOperating`             | Largest eligible operating generator at onset, optionally restricted by `fuel`; equal capacity ties use stable facility ID.                            |
| `oldestOperating`              | The `count` oldest operating generators of `fuel` at onset; equal ages use stable facility ID.                                                         |
| `seededOperatingCapacityShare` | Seeded eligible generators, optionally of `fuel`, until their cumulative nameplate capacity reaches the declared share of eligible operating capacity. |
| `operatingAtLeastAge`          | Every operating generator of `fuel` aged at least `minAgeYears` at onset.                                                                              |
| `startingAsset`                | The original bundled `assetId` from the resolved starting fleet. Selling it never assigns that identity to a later purchase.                           |

Operating selectors exclude unfinished or paused generators at selection time.
Pausing or selling a selected facility does not transfer its effect to another
facility. Empty selections produce a warning and affect nothing. **Author report**
lists starting-asset IDs. Operating selectors exclude storage; `startingAsset` can
also select an original storage asset, limiting discharge but leaving charging
power unchanged.

### Decisions and conditional branches

A choice resolves before simulation of its `dueMonth`, including month 1. The clock
stops until every reached simultaneous decision is answered. Each company pays its
own cost or receives its own grant, and the game stays paused after answering.
Paid options need enough current cash; a zero-cost option remains usable with
negative cash.

An option may have `costDollars` or `grantDollars`; omit both for a free option. At least
one zero-cost option must exist at every difficulty. Options may replace a named
future load with up to four new loads; `with: []` cancels it. Replacement is valid
only before the original load starts. Event loads are permanent additions: event expiry never disconnects them.

`requiresChoice` uses `{ "choiceId": "plan", "optionIds": ["a", "b"] }`; add
`"arc": 106` for an imported choice. The listed options mean **A or B**. To exclude
one option, list the others and update that list when adding options. Listing
every option is rejected; remove the condition instead. Dependencies cannot cycle
or refer to later decisions. A same-month prerequisite must resolve first.

## Worked timeline: months 12–25

The [worked package](mods/worked-timeline.json) starts in January 2020, runs
25 months, and defines:

- A forecast maintenance expense in month 12 (December 2020), active for one month.
- A three-option `grid-plan` decision due in month 13: maintain the grid, buy the
  upgrade, or accept a grant. The latter two options enable `new-demand` in that
  same opening.
- A conditional `demandMultiplier: 1.1` from month 13, with `durationMonths: "untilEnd"`.
- A required reliability goal observing months 13–24, inclusive.

| Playable month | Calendar               | Active rules and accounting                                                                                                                                                                         | Objective observation                                                                        |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 12             | December 2020          | Maintenance expense applies; the choice and conditional demand are still future.                                                                                                                    | Outside the goal window.                                                                     |
| 13, opening    | January 2021           | Maintenance has expired. `grid-plan` blocks before any tick. Upgrading or accepting support activates the 1.1× demand factor immediately; maintaining does not. The option transfer is booked once. | First goal month begins after the decision.                                                  |
| 13, close      | January 2021           | The chosen branch remains active.                                                                                                                                                                   | Judge completed month 13, never a forecast or a partial month.                               |
| 14–23          | February–November 2021 | The 1.1× factor continues on its two enabled branches; no new option payments.                                                                                                                      | Judge each completed month separately.                                                       |
| 24             | December 2021          | The factor still applies.                                                                                                                                                                           | Judge the twelfth and final observation at close; all months 13–24 must satisfy reliability. |
| 25             | January 2022           | `untilEnd` still applies through this final playable month.                                                                                                                                         | Month 25 is outside this goal window; ordinary game failures still apply until the run ends. |

Months are one-based. An effect starting in month 13 for two months expires at
the opening of month 15. `untilEnd` includes the final month, even if a goal's
window ends earlier.

## Import official arcs

`officialArcs` is an array of `{ "scenarioId": 106 }`. Choices are included by default; set `includeChoices: false` to choose the free responses automatically.
Omitting it imports the challenge base's own arc; base `999` defaults to none.
`[]` explicitly imports none. The base and arc list are independent: removing an
arc does not remove an inherited objective or an initial industrial load.

Importing an arc adds its events and choices, not its objectives. Set goals
through `objectives` independently.

The [generated arc reference](mods/arc-reference.md) lists each importable phase's
relocated offset/range, choice/option IDs, load IDs and automatic free answer.
Preparation months are included in relocated phase/choice offsets. Source load
dates already include their preparation lead; they are not shifted twice. The
receiving starting year supplies calendar dates. Imported fixed money follows the
receiving grid's customer/demand scale and is converted to its era once; load MW
follows that grid scale. Percentage shocks are not rescaled as money.

With `includeChoices: false`, each imported choice takes its listed free response
automatically. Its associated rules still apply. Use the arc's choice/option IDs
in conditions and its load IDs when replacing future loads.

## Reports and recorded observations

An event may request one onset `report` and one expiry `endReport`; the package may
also declare 16 `debriefReports`. Each has a unique ID, a supported `kind`, optional
plain label (100 code units), and an inclusive completed-month window.
`affectedFacilities` instead names `eventId`. Reports give feedback without
changing effects, money or goal results.

| Kind                 | Parameters and feedback                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reliability`        | Inclusive month window; demand served and unserved. Optional `minDemandServedShare` sets the feedback threshold (default `0.999`).                                             |
| `affectedFacilities` | `eventId`; names the facilities originally targeted by that event.                                                                                                             |
| `fuelMix`            | Inclusive month window and `fuels`; reports their delivered share. `basis` is `localGeneration` (default) or `customerDemand`. Imports and storage do not count toward a fuel. |
| `firmCoverage`       | Inclusive month window; firm generation plus storage power divided by peak demand, using the fleet at window close.                                                            |
| `storageCoverage`    | Inclusive month window; storage power share and hours at peak demand, using the fleet at window close.                                                                         |
| `profitLoss`         | Inclusive month window; revenue less fuel, operating, carbon, interest, policy and import expenses.                                                                            |
| `dataCenter`         | Inclusive month window; blackout-month count and change in electricity tariffs.                                                                                                |
| `deepFreeze`         | Exactly three consecutive months, before, during and after impact; shortages, billed-rate change and whether cash stayed positive.                                             |

Reports can observe only completed months. At an event opening, the current month
is still incomplete; use an expiry or debrief report to cover the full impact
window. Reports show **unavailable** when required observations are missing or a
ratio has a zero denominator. Match the report window and label to what it measures:
a recovery label alone does not establish that supply recovered.

## Write for co-op

Each company has its own customers, facilities, cash, loads, targets, choices and
goal results. Write **your company receives $X**. One company's response, sale,
debt or failure does not change another's. Every active company must answer a
reached choice before the shared clock advances; failed companies retire while
others can continue.

The host supplies the scenario to guests, who need no local copy or Workshop
subscription. Campaign saves keep its rules, including after updates or removal.
Guests can choose **Keep a copy** to install it.

## Publishing and compatibility

The Workshop description combines your `description` with a generated **Rules**
section covering setup, goals and announced events and choices. Surprise events
stay hidden. Edit only your introduction; uploads regenerate Rules. The combined
text must fit **7,999 UTF-8 bytes**. Oversized descriptions must be shortened before
uploading, but the package can still be played locally. Upload only `scenario.json`.

Keep `gameApi` unchanged for ordinary game updates. If the game reports an
incompatible package, its creator must update it. Existing saves retain their
original rules. Community runs remain unranked.

## Unsupported features

Loads are permanent. Conditions select from named choice options; there is no
general condition language or scripting. Custom locations, starting fleets,
tutorial bases, import-share goals and clean-energy goals are unsupported.
Imports and storage discharge do not count toward a fuel's local generation.
