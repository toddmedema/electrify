# Scenarios, mods and Steam Workshop

Community scenarios work in the Steam/desktop edition, in solo play and co-op.
Open **Mods** in the main menu, **Mods** on Choose a game, or **Community scenarios**
when hosting. A player reads the resolved rules before starting: the author's
claim is separate from the actual setup, goals and announced consequences.
Modded companies are **Modded · Unranked** and earn no official scores or achievements.
Browser builds do not expose the desktop mod library.

## Install, inspect and keep playing

Choose **Import mod** for a local JSON file, or **Browse Workshop** and subscribe
on Steam. Returning from the Steam overlay and **Check for updates** refresh finished
subscriptions. Each download is validated independently; a malformed or unfinished
update cannot replace its last good installation. Local packages and already
installed Workshop copies work offline. The profile holds at most 32 installed mods.

**Play** opens the common solo/co-op details. Choose a difficulty, review the
computed objectives and announced timeline, then **Start**. The explicit **Author
report** includes hidden surprises and complete resolved facts for every difficulty;
its inspection control does not change the launch difficulty. Validation warnings
permit play and publishing. Errors must be corrected. Public diagnostics do not
reveal private event IDs or mechanics.

Importing the same local package ID offers **Update**, **Keep both**, or **Cancel**.
An update preserves its enabled state; keeping both assigns a fresh package ID.
Disabled mods remain installed. **Remove** deletes a local installation;
**Unsubscribe** requires Steam, so offline players can disable a Workshop copy.
A damaged library offers recovery rather than overwriting the original files.

A running game, replay or co-op campaign owns a detached, validated snapshot. An
update, removal, disabled library or unavailable Workshop cannot change that run's
rules, choices, targets, payments or objective progress. Start a new game to use an
updated package.

## Authoring workflow

1. Choose **Save authoring template**. Keep `scenario.json` beside its generated
   `scenario.schema.json`; the template's `$schema` points to that local file for
   offline editor validation and autocomplete.
2. Edit plain JSON, using the [balanced examples](mods/examples/README.md) or
   [mechanism recipes](mods/authoring.md#executable-recipes). Set an original ID,
   title, creator, version and description. Keep `schemaVersion: 1` and `gameApi: 1`.
3. Validate and inspect every difficulty, then simulate explicit branches:

   ```sh
   npm run mods:validate -- path/to/scenario.json --explain
   npm run mods:validate -- path/to/scenario.json --json --explain
   npm run sim -- --mod path/to/scenario.json --responses responses.json
   npm run sim -- --mod path/to/scenario.json --free-fallback --seeds 1,2 --difficulties Employee,Manager
   ```

4. Import the file and inspect the same computed facts in **Author report**. Play
   the decisions and the complete objective windows. Reimport edited content to
   update the local package, then start a new run.
5. Connect to Steam and choose **Publish** or **Upload update**. Confirm the upload.
   The item's description is regenerated from the authored description and public
   Rules on every upload. Complete Steam's legal agreement if the result asks for it.

The validator uses the production parser and compiler. It reports independent
errors and warnings; `--json` emits one JSON report, and errors alone make the
command exit nonzero. `--explain` includes real starting peak MW, all possible
seeded openings and calendar dates, composed monthly effects, load MW, inherited
objectives as replacement JSON, stable imported IDs, dependencies, selectors,
carbon-fee windows, and report observations. The app exposes the same facts.

The mod simulator uses the real reducer and invariants. It prints the seed,
difficulty, package/runtime digests, reached responses, objective measurements,
outcome and violations. A shortened `--months` run is `inProgress`, not a victory.
A choice package requires a responses file or deliberate `--free-fallback`:

```json
{
  "responses": [
    { "choiceId": "grid-bond", "optionId": "accept" },
    { "arc": 106, "choiceId": "connection", "optionId": "phased" }
  ]
}
```

These are reference-shape examples: use the actual IDs in your package's report.
A reached choice without an answer fails unless fallback was requested. Fallback
uses the compiler's zero-cost option and prints that decision. A valid answer that
the run never reaches produces a warning; unknown or duplicate references fail.
`--seeds` and `--difficulties` allow at most 20 combinations. `--mod` cannot be mixed
with `--scenario`, `--year`, `--location`, `--all`, or the ordinary story matrix.

## Package contract

The package is one UTF-8 JSON file, at most **256 KiB**, with no extra upload files,
code, expressions, archives or custom media. Visible author text rejects URLs and
HTML. All assets, technologies,
locations and fleets come from the bundled catalog. The normalized snapshot,
including imported content and metadata, must fit **512 KiB**.

Required fields are `schemaVersion`, `gameApi`, `id`, `title`, `creator`, `version`,
`description`, `seed`, `baseScenarioId` and `objectives`. IDs contain 1–64 lowercase
ASCII letters, digits or hyphens, starting and ending alphanumeric. Text is plain:
no control characters, zero-width characters, bidi overrides or markup. The title
has at most 100 UTF-16 code units and 128 UTF-8 bytes; creator 100 code units,
version 40, description 2,000. `$schema` is an optional editor hint, at most 2,048
safe code units. It can name a local file or remote URI; the game ignores it,
never fetches it and excludes it from package identity. Computed digests and
runtime fields cannot be authored.

A base ID is one of the 14 challenges in the [generated arc reference](mods/arc-reference.md),
or `999` for the bundled custom grid. It selects the initial fleet, location,
resources, ownership and demand model. Optional `scenario` overrides are only
those in the units table below. Every inherited starting asset must be available
in the resolved era/location at every difficulty; unavailable assets are never
silently dropped. Changing the era carries unset money and tariffs forward with
the same owners as Custom Game; explicitly authored amounts are already in the
chosen starting year's dollars.

The River Runs Dry (`114`) also carries its researched Kariba starting Hydro
asset and scenario-specific physical site inventory into a mod. This preserves
the inherited fleet and commissioned-site claims through saves and replays; it
does not let an author choose an inventory key, location or additional sites.
Ordinary custom Lusaka grids continue to use the local public inventory.

Optional top-level fields are `scenario`, `facilities`, `programs`, `officialArcs`,
`events`, `choices` and `debriefReports`. Unknown fields are errors, including nested
fields. The [offline schema](mods/scenario.schema.json) describes structural shapes;
the production compiler also checks references, windows, reachability, composed
values, asset availability and byte bounds. Editor character counting can differ
from the parser's UTF-16 counting, so run the validator before publishing.

### Goals are explicit

- `objectives: { "mode": "inherit" }` keeps the base goals; optional `add` appends goals.
- `objectives: { "mode": "replace", "items": [...] }` uses only the listed goals.
- `objectives: { "mode": "none" }` declares no scenario goals. The player must still
  reach the final month and avoid ordinary game failures.

An empty replacement remains distinct from empty inheritance. The author report
supplies inherited goals as replacement-ready JSON with resolved month offsets.
A shortened term cannot silently discard an inherited goal. Required goals decide
success/failure; optional goals report their result without ending the company.
The common evaluator drives Mission Status, debriefs, saves, co-op and headless runs.
Missing, duplicate, edited or incomplete observations cannot become a false pass.

| Metric                     | Measurement and boundary                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monthlyReliability`       | Customer electricity delivered / customer demand in **every** completed month of the inclusive window; target `minDemandServedShare`.                             |
| `customerRetention`        | Customers / recorded starting customers at `deadlineMonth`; target `minRetainedShare`. Earlier recoverable losses do not prematurely fail it.                     |
| `emissionsBudget`          | Cumulative electricity and construction tonnes CO₂e in the window, including imports and exports; target `budgetTonnesCO2e`.                                      |
| `emissionsPerDeliveredMWh` | Total kg CO₂e / delivered customer MWh over the entire window; target `maxKgCO2ePerMWh`.                                                                          |
| `localFuelShare`           | Selected fuels' delivered Wh / all local fuel-delivered Wh over the window; target `minShare`. Imports and storage have no fuel provenance.                       |
| `fuelRetirement`           | Own no asset of `fuel`, including paused and unfinished assets, at the deadline and every later month close. Selling an unrelated asset is insufficient.          |
| `monthlyBilledRate`        | Actual billed customer revenue / delivered kWh, excluding grants and exports, deflated to starting-year dollars, each month; target `maxDollarsPerKWh`.           |
| `monthEndDebt`             | Owned outstanding facility and transmission loan principal at each month close, deflated to starting-year dollars; target `maxDebtDollars`. Interest is excluded. |

All goals have `id`, `label`, `metric`, and optional `required` (default `true`).
Retention and retirement use a deadline; other metrics use inclusive
`fromMonth`/`throughMonth`. Zero energy denominators are unavailable, not perfect
service or a zero-intensity success. Monthly goals never average a bad month away.
The [generated definition sentences](mods/objective-definitions.md) are shared with
the evaluator, UI and schema.

### Units and numeric bounds

| Fields                                                                                                         | Units and accepted bounds                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `seed`                                                                                                         | Integer 0–4,294,967,295. It deterministically resolves authored ranges, catalog selectors and future simulation.                                       |
| `scenario.startingYear`                                                                                        | Calendar year, integer 1980–2100, including the resolved base year.                                                                                    |
| `scenario.durationMonths`                                                                                      | Playable months, integer 6–1,200.                                                                                                                      |
| `scenario.startingCustomers`                                                                                   | Customer count, integer 1–100,000,000.                                                                                                                 |
| `scenario.startingDemandScale`                                                                                 | Dimensionless demand calibration, 0.01–100.                                                                                                            |
| `scenario.cash`                                                                                                | Starting-year dollars, 0–1e12.                                                                                                                         |
| `scenario.dollarsPerkWh`                                                                                       | Starting-year dollars/customer kWh, 0–100.                                                                                                             |
| `scenario.feePerKgCO2e`                                                                                        | Starting-year dollars/kg CO₂e, 0–100. This setup field uses kg; the timed fee field below uses tonnes.                                                 |
| Event `startMonth`, range `from`/`to`, choice `dueMonth`, load `startMonth`, report/goal windows and deadlines | One-based playable month, integer 1–1,200 and inside the resolved term. Windows include both endpoints.                                                |
| Event `durationMonths`                                                                                         | Integer 1–1,200, a complete difficulty table, or `"untilEnd"`. The onset month counts; effect-only durations are required.                             |
| `load.peakMW`                                                                                                  | Peak MW, 0.001–100,000, converted once to watts.                                                                                                       |
| `load.peakShareOfStartingPeak`                                                                                 | Share of the real first-year baseline peak, 0.000001–1; excludes future authored rules/loads from sizing itself. Choose exactly one load sizing field. |
| `load.loadFactor`                                                                                              | Annual average / peak, 0.01–1.                                                                                                                         |
| Static facility `buildCost`, `annualOperatingCost`, `yearsToBuild`; `programs.efficiency`/`solar`              | Dimensionless multipliers, 0.1–10.                                                                                                                     |
| Timed fuel/construction/operating price factors; `demandMultiplier`                                            | Dimensionless multipliers, 0.1–10, including composed reachable values.                                                                                |
| `outputMultipliersByFuel`, selector `outputMultiplier`                                                         | Remaining output share, 0–1. `0` disables output, `1` leaves it unchanged.                                                                             |
| `hydroInflowMultiplier`                                                                                        | Inflow factor, 0–10; composed positive values must be 0.1–10, while `0` permits no inflow.                                                             |
| `temperatureOffsetC`                                                                                           | Additive °C, −30–30 per event.                                                                                                                         |
| `operatingExpenseDollarsPerMonth`                                                                              | Starting-year dollars per active month, 0–1e12.                                                                                                        |
| Event transaction `amountDollars`, option `costDollars`/`grantDollars`                                         | One-time starting-year dollars per company, 0–1e12.                                                                                                    |
| `carbonFeeDollarsPerTonneCO2e`                                                                                 | Absolute starting-year dollars/tonne CO₂e, 0–100,000. The engine converts tonnes to kg once.                                                           |
| Selector `count` / `minAgeYears` / `targetCapacityShare`                                                       | Whole generator count 1–10 / age in years 0–200 / operating capacity share 0–1.                                                                        |
| Goal `minDemandServedShare`, `minRetainedShare`, `minShare`; report `minDemandServedShare`                     | Dimensionless share, 0–1.                                                                                                                              |
| `budgetTonnesCO2e` / `maxKgCO2ePerMWh`                                                                         | Tonnes CO₂e 0–1e12 / kg CO₂e per delivered MWh 0–1e6.                                                                                                  |
| `maxDollarsPerKWh` / `maxDebtDollars`                                                                          | Starting-year dollars/kWh 0–100 / starting-year dollars 0–1e12.                                                                                        |

For a baseline whose real starting peak is **500 MW**, `peakMW: 100` and
`peakShareOfStartingPeak: 0.2` both resolve to **100 MW**. The absolute form stays
100 MW if the base changes; the share form follows its resolved baseline. Read
resolved MW in the author report instead of estimating from customer count.

`scenario.ownership` is `Investor` or `Public`; `endTitle`/`endMessage` are plain
text up to 500 code units. Facility names are the schema's catalog names; effect
maps use fuels (`Sun`, `Uranium`, `Natural Gas`, etc.), not facility display names.
Fuel-price factors accept only priced fuels: Coal, Uranium, Natural Gas, Oil, Biomass.

## Events, choices and composition

A package permits 100 authored events, 32 authored choices with 2–8 options each, 16 goals,
16 debrief reports, 4 loads per event, 10 selector operations and 2 transactions
per event. The compiled contract has separate bounds of 200 imported arc events
and 200 imported arc choices. Authored and imported content together must fit the
512 KiB compiled snapshot and satisfy the same composition and dependency checks;
an arc import cannot bypass them. IDs for events, choices,
loads, reports and goals share a package namespace. Option IDs are local to their
choice. Use stable IDs rather than array positions.

An event has `id`, `title`, `message`, one onset month or inclusive seeded range,
and optional duration, preview, condition, effects, loads and reports. Mechanical
forecast events require a short future-tense `preview` (at most 200 code units).
`visibility: "surprise"` hides its future schedule and mechanics from player
previews and Workshop Rules; it remains visible to the author. Messages and end
messages have at most 500 code units. At onset the live message states the actual
change. A message-only event needs no duration.

| Timed effect                        | Scope and composition                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fuelPriceMultipliers`              | Multiplies current fuel prices by fuel. Simultaneous factors multiply.                                                                                                                              |
| `outputMultipliersByFuel`           | Multiplies output of all generators using the named fuel while active. It does not reduce nameplate capacity or transfer fuel provenance.                                                           |
| `outputMultipliersBySelector`       | Binds original generators once at onset; simultaneous output factors multiply for each original. Selling a target never retargets a replacement.                                                    |
| `demandMultiplier`                  | Multiplies customer demand while active. A timed multiplier expiring removes that multiplier.                                                                                                       |
| `temperatureOffsetC`                | Adds to the weather temperature used by the simulation; simultaneous offsets add.                                                                                                                   |
| `hydroInflowMultiplier`             | Multiplies reservoir inflow while active; it does not directly multiply stored water or nameplate power.                                                                                            |
| `constructionCostMultipliersByFuel` | Multiplies new generator construction quotes while active. Existing assets, debt and committed purchases retain their original prices.                                                              |
| `operatingCostMultipliersByFuel`    | Multiplies live operating expense of matching generators once while active. Purchase snapshots keep base O&M, preventing a second timed multiplication.                                             |
| `operatingExpenseDollarsPerMonth`   | Adds a monthly company expense; simultaneous expenses add. Expiry removes future expense, not recorded payments.                                                                                    |
| `transactions`                      | Books a charge or grant once at onset. Forecasts show known future transfers without creating a receipt or paying twice.                                                                            |
| `carbonFeeDollarsPerTonneCO2e`      | Replaces the current carbon fee while active; it does not add to the initial fee. `0` explicitly waives the fee. Co-reachable overlapping absolute overrides are rejected, including seeded ranges. |

Static facility modifiers are applied when the catalog quotes initialized or newly
purchased assets. They remain in that asset's snapshot. Timed construction factors
multiply those static quotes for new purchases; static `5` with simultaneous timed
`2` reaches the maximum `10`, while `5.01 × 2` is rejected. Timed operating factors
multiply the stored operating cost during active months. Later library edits cannot
rewrite either snapshot. Program modifiers change the cost of the two bundled
programs; they add no new policy types.

A `RuleNumber` effect, duration, capacity-share target or option amount may be a
scalar or `{"byDifficulty":{"Intern":1,"Employee":1,"Manager":1,"VP":1,"CEO":1}}`.
Supply every difficulty, using that field's own unit and bounds. Tables cannot
nest or contain expressions. The compiler validates all five difficulties and
reachable branch combinations, rather than multiplying mutually exclusive events
together. Impossible simultaneous required fuel-share goals are rejected.

### Target selectors

| Selector                       | Exact selection                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `largestOperating`             | Largest eligible operating generator at onset, optionally restricted by `fuel`; equal capacity ties use stable facility ID.                                                                                       |
| `oldestOperating`              | The `count` oldest operating generators of `fuel` at onset; equal ages use stable facility ID.                                                                                                                    |
| `seededOperatingCapacityShare` | Seeded eligible generators, optionally of `fuel`, until their cumulative nameplate capacity reaches the declared share of eligible operating capacity. The addressed draw and chosen original identities persist. |
| `operatingAtLeastAge`          | Every operating generator of `fuel` aged at least `minAgeYears` at onset.                                                                                                                                         |
| `startingAsset`                | The original bundled `assetId` from the resolved starting fleet. Selling it never assigns that identity to a later purchase.                                                                                      |

Operating selectors exclude unfinished or paused generators at selection time.
Once bound, pausing or selling an original does not choose another target. A sold
original's reused numeric ID is insufficient to inherit damage: the persisted
identity also binds its original asset/birth facts. Storage is never an eligible
generator. An empty eligible selection records a warning once and affects no
substitute. The author report lists available starting-asset IDs and each selector's
semantics. Community authors cannot supply RNG addresses or force selected IDs.

### Decisions and conditional branches

A choice resolves before simulation of its `dueMonth`, including month 1. The clock
stops until every reached simultaneous decision is answered. Each company pays its
own cost or receives its own grant; a response commits once and stays paused.
A paid option needs enough current cash; a zero-cost option remains usable with
negative cash. Reforecasting, loading and duplicate commands never repeat payment.

Each option has exactly one `costDollars` or `grantDollars`, including zero. At least
one zero-cost option must exist at every difficulty. The compiler names its stable
fallback. Options may replace a named future load, with at most four new loads;
`with: []` cancels it. Replacement is valid only before the original load starts.
Event loads are permanent additions: event expiry never disconnects them.

`requiresChoice` uses `{ "choiceId": "plan", "optionIds": ["a", "b"] }`; add
`"arc": 106` for an imported choice. The listed options mean **A or B**. For
**anything but A**, enumerate every other current option, such as `["b", "c"]`
when the choice has A, B and C. There is no negation expression: update the set if
new options are added. Naming every option is unnecessary and rejected; remove
the condition instead. Dependencies form an acyclic forest; same-month dependencies
are permitted only when their prerequisite can resolve first. A condition cannot
refer to a later decision or an absent option.

## Worked timeline: months 12–25

The complete [worked package](mods/worked-timeline.json) is executable through the
same validator and simulator as the balanced examples. It starts in January 2020,
runs 25 months, and defines:

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

The authored month is always one-based. An effect beginning in month 13 for two
months is active in 13 and 14, and expires at the opening of 15. `untilEnd` instead
covers the final month even after a goal's observation window has finished.

## Import official arcs

`officialArcs` is an array of `{ "scenarioId": 106, "includeChoices": true }`.
Omitting it imports the challenge base's own arc; base `999` defaults to none.
`[]` explicitly imports none. The base and arc list are independent: removing an
arc does not remove an inherited objective or an initial industrial load.

The [generated arc reference](mods/arc-reference.md) lists each importable phase's
relocated offset/range, choice/option IDs, load IDs and automatic free answer.
Preparation months are included in relocated phase/choice offsets. Source load
dates already include their preparation lead; they are not shifted twice. The
receiving starting year supplies calendar dates. Imported fixed money follows the
receiving grid's customer/demand scale and is converted to its era once; load MW
follows that grid scale. Percentage shocks are not rescaled as money.

With `includeChoices: false`, the imported choice resolves automatically to its
listed free response before due-month simulation. It does not disappear in a way
that accidentally enables paid protection or a different load. Authored conditions
can refer to the stable imported choice/option IDs, and authored replacement loads
can refer to the listed arc-scoped load ID.

## Reports and recorded observations

An event may request one onset `report` and one expiry `endReport`; the package may
also declare 16 `debriefReports`. Each has a unique ID, a whitelisted `kind`, optional
plain label (100 code units), and an inclusive completed-month window. The
`affectedFacilities` kind instead names `eventId`. Reports present facts; they never
change effects, money or goal verdicts.

| Kind                 | Required recorded facts and parameters                                                                                           | Typical feedback                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `reliability`        | Completed customer supply/demand Wh for every window month; optional `minDemandServedShare` 0–1 (default 0.999).                 | Demand served and unserved Wh, with severity based on the target.                          |
| `affectedFacilities` | Persisted activation of `eventId`, its original target names and identities.                                                     | Which owned originals were affected; a sold/replacement unit is not retargeted.            |
| `fuelMix`            | Completed delivered Wh by `fuels`, plus `basis`: `localGeneration` (default) or `customerDemand`.                                | Selected fuel share with an explicit denominator; imports/storage have no fuel provenance. |
| `firmCoverage`       | Completed peak demand W and a recorded fleet snapshot at window close, including firm generator W and storage W.                 | Firm generation plus storage power / recorded peak demand.                                 |
| `storageCoverage`    | The same closing snapshot, storage W/Wh and completed peak demand W.                                                             | Power share and storage hours at that demand, without claiming fuel provenance.            |
| `profitLoss`         | Complete finite recorded revenue and fuel, O&M, carbon, interest, policy and import expenses.                                    | Profit, loss or break-even in dollars using the accounting owner.                          |
| `dataCenter`         | Completed energy/customer observations and recorded starting/ending tariffs.                                                     | Blackout-month count after connection and the tariff change.                               |
| `deepFreeze`         | Exactly three consecutive completed months: before, impact and recovery; energy, minimum supply margin, realized bills and cash. | Unserved Wh, largest shortage W, rate change and whether cash stayed positive.             |

At an opening, the current month has not completed. An onset recovery report must
observe already closed months; an expiry/debrief report can then include the full
impact window. Missing months, duplicates, nonfinite facts, zero denominators,
unreached events or absent closing snapshots produce **unavailable** observations
with a reason. They never report invented 100% reliability or zero damage.

For example, an expiry reliability report for the two completed drought years
shows the recorded served share; its label does not promise recovery if shortages
remain. A freeze debrief compares the actual before/impact/recovery months and
cash, rather than congratulating every response. Reports preserve labels, units
and severity independently from required goal pass/fail.

## Write for co-op

A host selects an enabled local or installed Workshop package and difficulty.
Guests receive a bounded safe summary followed by the host's validated frozen
scenario separately; **Ready** stays unavailable while receiving. Ready binds the
scenario digest, seed and difficulty. A changed selection requires fresh consent.
Guests need no file, Workshop subscription or matching local installation.
**Keep a copy** is explicit and does not silently alter a guest's library.

The world shares its simulation clock, but each company has its own customers,
facilities, cash, load response, original targets, decisions and goal results.
Write **your company receives $X**, not **the lobby receives $X**. Do not assume
one player's answer, sale, debt or failure changes another's. Every live company
must answer a reached decision before the shared clock advances; the waiting view
names deciding companies. A failed company retires while the others can continue.

Campaign saves include the frozen scenario. Resume, late join and reconnect resend
and validate that snapshot without consulting guest libraries. Ordinary peer views
carry its identity rather than repeatedly embedding rules. All modded companies
remain unranked before and after resume.

## Publishing and compatibility

The Workshop description is the author's `description` followed by a regenerated
**Rules** section: base, term, objective definitions, forecast events and decisions.
Surprises and private author-report details are omitted. Authors edit only the
first part. Upload updates rewrite the generated portion from the currently
validated package and digest. Steam permits **7,999 UTF-8 bytes** after reserving its
C terminator; excess descriptions fail with guidance to shorten public copy.
Rules are never silently truncated, and an otherwise valid package can still be
played locally. The upload contains `scenario.json` only.

Ordinary game updates do not require changing `gameApi`; incompatible packages
remain visible with a request to obtain a creator update. Saves carry their frozen
runtime contract and validated progress. Packages cannot author compatibility
fingerprints, claim official identity or enable rankings. Internal deterministic
mod replays carry the snapshot; community runs cannot enter official replay/score
submission paths.

Known limits: loads are permanent; conditions only select finite choice option
sets; no scripts, general condition language, community location or starting-fleet
authoring, tutorial migration, import-share goals or clean-energy goals. Storage
and imports do not acquire invented fuel provenance. The common compiler rejects
unsupported requests rather than approximating them silently.

Maintainers regenerate schema/recipes and arc reference from their owners, and use
the [coverage matrix](mods/coverage-matrix.md) for behavior evidence. Performance
measurements follow [the performance plan](perf-plan.md); a baseline bot losing is
not proof that an example is impossible.

For the maximum-content workload, run `npm run perf:bench -- --mods --runs 1 --json`.
It reports permitted authored content, 1200-month observations, plain/Immer ticks
and rollovers, actual worker transport, co-op and save bytes. The normal
`npm run perf:bench` ratio gates and `npm run perf:bundle` production byte ceilings
remain separate checks.
