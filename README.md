# Electrify

A mobile-friendly tycoon game about electricity markets. Play it at
[electrifygame.com](https://electrifygame.com).

## License

Electrify is source available under the [MIT License with Commons Clause](LICENSE.md).
The Commons Clause is a condition on the MIT License, not an alternative license.

You can use, study, modify, and share Electrify subject to these terms. The license
does not permit selling the software as defined by the Commons Clause: providing
a product or service for a fee or other consideration whose value derives entirely
or substantially from Electrify, including paid hosting and related consulting or
support services. See the [full license](LICENSE.md) and
[Commons Clause FAQ](https://commonsclause.com/) for the scope of this restriction.

Versions containing this license notice use the combined license. Versions
previously distributed under MIT retain their MIT permissions. Third-party
components and assets with separate license notices retain their own licenses.

## Getting started

### Setup

Requires Node.js 24. Check your version with `node --version`.

Using a version manager such as [nvm](https://github.com/nvm-sh/nvm) makes it easier to switch
between Node versions.

Development commands work in standard Windows, macOS, and Linux shells. The deployment script
requires a POSIX-compatible shell such as Git Bash.

With Node.js installed, run the following from the root of the repository:

```sh
npm ci
```

To use the online high score capabilities, you will need to contact an admin to get a Firebase api key.

### Serve and watch

```sh
npm start
```

This runs the app at [http://localhost:3000](http://localhost:3000).

### Desktop and Steam

`npm run desktop:pack:offline` builds a self-contained Electron package on Windows x64, Linux
x64, or macOS (one universal app for Intel and Apple Silicon). Native CI publishes downloadable
offline QA bundles. Use `npm run desktop:pack` with Electrify's `STEAM_APP_ID` to prepare a Steam
depot. See [desktop build and Steam setup](docs/desktop-steam.md) for fullscreen controls,
offline packaging, Cloud saves, friends leaderboards, testing and the remaining Steamworks release
steps.

### Run tests

```sh
npm test
```

This starts Jest in watch mode. Test files use the `.test.ts` or `.test.tsx` suffix. Use
`npm run test:once -- <name>` to run matching suites once and exit.

### Check everything

```sh
npm run check
```

Checks assets, types, lint, formatting, native unit tests, CI tooling, covered Jest tests,
simulation suites and a simulation CLI smoke run. Results appear as each gate finishes.
The check's Jest suites use at most four workers; set `ELECTRIFY_CHECK_WORKERS` to override
that limit. This default limits contention on shared machines; it is not a measured speedup.
The simulation CLI runs its single suite in process. These gates keep their caches inside `.tmp/`.

Before pushing a pull request, run `npm run check:ci` once on the integrated code instead.
It includes those eight gates plus tick performance, the production web build, bundle-size
ceilings, the production browser smoke/layout matrix and the desktop renderer's multiplayer
suite: fourteen gates in total. The packaged Electron UI suite remains CI-only.

Run `npm run check:assets` in a fresh worktree before building or testing. If it reports
Git LFS pointers, restore cached files with `git lfs checkout`, or fetch them with `git lfs pull`.
Missing files are reported separately: stage intentional asset deletions or renames before
retrying, or restore files that should still exist.
The full check runs this preflight automatically before starting any gates.

After repairing a failed gate, use the printed retry command, for example
`npm run check -- --steps lint,tests`. This reports a partial check; retain earlier passing
results only when their inputs have not changed. The runner does not track invalidated results;
rerun the full check if unsure (`check:ci` when retaining evidence from its extra gates).
`npm run check:ci -- --steps browser` is also a partial retry; it rebuilds the web renderer
first. A `multiplayer` retry rebuilds the desktop renderer, since both write to `build/`.
Use `npm run check -- --help` for gate IDs. Individually:

| Command                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `npm run typecheck`    | `tsc --noEmit` for the app, then `tsc -p e2e`             |
| `npm run lint`         | ESLint for app and data scripts; warnings are errors      |
| `npm run format`       | Rewrite app and script files with Prettier                |
| `npm run format:check` | Report unformatted app or script files                    |
| `npm run test:ci`      | Run Jest once with the same coverage checks used by CI    |
| `npm run test:sim`     | Run the long simulation suites (`*.sim.test.tsx`)         |
| `npm run test:e2e`     | Run browser UI tests in headless Chromium                 |
| `npm run sim -- --all` | Run every scenario through the headless invariant checker |

Local checks run without opening application windows. The Electron UI suite requires an
explicit `npm run test:desktop -- --headed` because it opens native windows and takes keyboard
focus. CI runs that suite on dedicated runners; see [desktop testing](docs/desktop-steam.md).

For changed UI flows or layouts, run the affected specs even when they are outside CI's list:

```sh
npm run test:e2e -- <spec> --project=desktop-chromium --project=mobile-390px
```

Add `--project=mobile-360px` for minimum-width layout changes. Reuse the navigation helpers
in `e2e/layout.ts` and make sure the run reaches the changed assertions. `test:e2e:ci` only
selects the smoke/layout specs in `e2e/ci.playwright.config.ts`, even when passed another spec.
To run an arbitrary spec against production, use `test:e2e` with `E2E_BASE_URL` pointing to
your hosted web build. Rebuild web first if `check:ci` last wrote the desktop renderer.

Use an unused task-specific `E2E_PORT` for browser checks and keep it in the same shell
through the final check: `$env:E2E_PORT = "3189"` in PowerShell or `export E2E_PORT=3189`
in Bash. If occupied, choose another port without stopping another task's server.

`npm run test:ci` reports coverage and skips the `*.sim.test.tsx` suites, which CI runs without
coverage through `npm run test:sim`. `src/helpers` and `src/reducers` have floors set in
`package.json` just under where they stand today, so a change that guts them fails rather than
landing quietly; raise the floors as coverage grows.

### Simulate the game headlessly

```sh
npm run sim -- --all
```

Plays every scenario through the real game reducer without a browser -- a 20 year run takes about
half a second -- and checks that the economy obeyed its invariants (no NaNs, cash only moves by
recorded revenue and expenses, storage can't invent electricity, and so on). Use it to sanity
check a change to the simulation in seconds rather than by playing through the UI.

`npm run sim -- --scenario 103` reports one scenario month by month, and `npm run sim -- --help`
lists the flags. See [the simulation guide](src/testing/README.md) for what it checks and how it
works.

### Add a city to play in

Every location is a single file in `public/data/weather`: hourly readings from 1980 through 2025
for the twelve days a year the game actually simulates, packed into about 66KB, or 80KB with
offshore wind. Whichever cities have been downloaded are exactly the ones the custom game screen
offers - `public/data/weather/index.json` is written by the same script and is what the picker reads.

```sh
npm run fetch-weather -- --list
```

lists the 285 cities in `scripts/cities.json` and marks the ones already downloaded; naming some
of them fetches them, and naming none fetches everything still missing:

```sh
npm run fetch-weather -- Tokyo Nairobi Reykjavik
```

The data is ERA5 reanalysis from the [Open-Meteo archive
API](https://open-meteo.com/en/docs/historical-weather-api), which is free and needs no key but
rate limits by location-day. A 1980-2025 city costs 552 location-days, or 1,104 when its offshore
point is fetched too, which works out to roughly nine onshore cities or four offshore cities an
hour. The script paces itself against that, writes each city out as it finishes and skips whatever
is already on disk - so filling in the rest of the catalogue is a matter of running it again
tomorrow rather than leaving it running.

To extend every existing file after another calendar year has completed, run:

```sh
npm run update-weather
```

This preserves the existing packed readings and fetches only the missing years through the last
fully completed year. Use `npm run update-weather -- --through 2030` to choose an explicit cutoff;
city ids and `--limit` work here too, and completed files are skipped when a rate-limited run is
resumed.

To add somewhere that isn't listed, add it to `scripts/cities.json` and fetch it. The `id` must match
the generated weather filename and the location references in the game data.

To enable offshore wind for a location, add a representative sea coordinate in its `offshore`
field. Fetching a location that has no weather file downloads both points. If its onshore weather
already exists, the fetcher downloads only the offshore history and adds it to the existing binary,
preserving every established onshore reading.

### Offline icon cache

`public/icons.json` lists every image under `public/images/`. It is generated by
`npm run icons:generate` (run automatically before start, build and test) and is git-ignored like
`src/data/RunCompatibility.json`. After launch, the service worker downloads the listed icons in
the background for every user -- not just installed apps -- so all screens' artwork is available
offline before a game starts. Add an image to `public/images/` and the next build picks it up
automatically; no service-worker change is needed. Images the app never displays, such as the
1024 px link-preview icon, are listed in `EXCLUDED` in `scripts/generate-icon-manifest.js` so
players don't download them.

### Manual figures

Every player downloads the manual's figures, so they ship as WebP. The originals live in
`docs/manual-images/`, which is not deployed. To add or change a figure, put the original there,
run `node scripts/compress-manual-images.js` (requires `cwebp`: `brew install webp`), and
reference the `.webp` from `src/components/base/ManualEntries.tsx` with its real `width` and
`height`. JPEG charts are re-encoded at WebP quality 88 (about 60-70% smaller, SSIM ≥ 0.993 and
indistinguishable at 3x zoom); PNGs are re-encoded losslessly. Always encode from the originals
so losses never compound. `src/ManualFigures.test.ts` checks the two stay in step. A diagram
drawn for the game keeps its SVG source beside it; render that to a PNG at its own size (for
example with a headless browser) and compress the PNG like any other original.

### Release checklist

To release, install and authenticate the AWS CLI.

Merging to `master` deploys prod through GitHub Actions (`.github/workflows/deploy-prod.yml`).
To preview a change first, run `npm run deploy beta` and check that:

- basic functionality works (app loads, game starts, music plays)

Web and desktop builds use their build-start timestamp as the version, for example
`v26sept26-1507` in Settings and `26sept26-1507` in metadata. The timestamp uses fixed PST
(UTC−8, including summer), a two-digit day/year, and 24-hour time. Settings and the deployed
`/package.json` report the same version.
Game analytics events include it as `app_version`; new scores, personal bests, replays, and saves
use `appVersion`. Steam scores store the ASCII version in zero-padded int32 score-detail slots.
Existing records keep their original metadata. The development server stamps its start time;
unbuilt test/CLI entry points use `dev`. Electron's required semver package field stays separate
from its `appVersion` metadata and is not used by the game UI or logging. Build timestamps do not
change the simulation compatibility hash.

### Troubleshooting

The app supports the [Redux DevTools browser
extension](https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd)
for inspecting application state.

### Display-name storage

Player names live in `users/{uid}.displayName`. Display names are not unique;
Firebase Auth UIDs identify accounts. Scores retain a display-name copy for efficient
leaderboard reads, with best-effort backfilling when a player renames themselves.

Legacy `usernames` documents and `displayNameLower` profile fields are unused and may be
deleted with admin tooling; deploying rules does not delete stored data.

## Modding

Mods are community scenarios for the Steam/desktop edition. Open **Mods** above
**Settings** in the main menu, or choose **Mods** on the Choose a game screen.
Modded games are single-player, unranked, and do not earn achievements.

### Install and play

- Choose **Browse Workshop**, subscribe to a scenario on Steam, then reopen the Mods
  screen after Steam finishes downloading it. Opening Mods while connected to Steam
  checks your subscriptions; **Check for updates** refreshes installed Workshop mods.
- To install a file someone shared with you, choose **Import mod** and select its
  JSON file. Local mods work offline. The library holds up to 32 mods.
- Choose **Play** beside an installed mod, pick a difficulty, then choose **Start**.
  The **Enabled** switch controls whether that mod can be played. **Remove** deletes
  a local installation; **Unsubscribe** removes a Workshop subscription and requires
  a Steam connection.

Updates apply to new games. Each save keeps the mod version it started with, so
updating, disabling, removing, or unsubscribing does not change an existing run.

### Create a scenario

1. Under **Create a mod**, choose **Save authoring template**.
2. Open the saved JSON file in a text editor. Set `id` to a unique name using
   lowercase letters, digits, and hyphens, and fill in `title`, `creator`, and
   `version`. Keep the template's `schemaVersion` and `gameApi` values.
3. Edit the scenario and modifiers, save the file, then choose **Import mod**.
   Validation errors appear in a toast and identify the field to fix.
4. Play the imported scenario to check its balance and events. After editing it
   again, reimport the file with the same `id` to replace the local version, then
   start a new game to try the changes.

A mod is a UTF-8 JSON file of at most 256 KiB. It contains data only: scripts,
custom artwork, and extra package files are not supported. This example makes
solar construction and efficiency rebates 20% cheaper:

```json
{
  "schemaVersion": 1,
  "gameApi": 1,
  "id": "my-grid",
  "title": "My Grid",
  "creator": "Your name",
  "version": "1.0.0",
  "seed": 42,
  "baseScenarioId": 999,
  "scenario": { "durationMonths": 240, "eventScenarioIds": [100] },
  "facilities": { "Solar": { "buildCost": 0.8 } },
  "programs": { "efficiency": 0.8 },
  "notifications": [
    {
      "month": 12,
      "title": "First year",
      "message": "Review your grid before the next year."
    }
  ]
}
```

| Field                       | What it controls                                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed`                      | A whole number from 0 to 4294967295 for repeatable simulation outcomes.                                                                                                                                           |
| `baseScenarioId`            | `999` starts from the custom-game defaults; a supported challenge ID inherits that challenge's starting grid and objectives. Tutorial IDs are not supported.                                                      |
| `scenario`                  | Optional overrides for `cash`, `startingYear`, `startingCustomers`, `startingDemandScale`, `dollarsPerkWh`, `durationMonths`, `feePerKgCO2e`, `ownership` (`Investor` or `Public`), `endTitle`, and `endMessage`. |
| `scenario.eventScenarioIds` | Challenge IDs whose event arcs run in your scenario. Use `[]` for no imported events. If omitted, a challenge base uses its own arc and `999` uses none.                                                          |
| `facilities`                | Multipliers for each named facility's `buildCost`, `annualOperatingCost`, or `yearsToBuild`. Use `0.8` for 20% less, `1` for unchanged, or `1.5` for 50% more. Allowed multipliers range from `0.1` to `10`.      |
| `programs`                  | Cost multipliers from `0.1` to `10` for `efficiency` (efficiency rebates) and `solar` (rooftop solar rebates).                                                                                                    |
| `notifications`             | Up to 100 messages, each with `month`, `title`, and `message`. Months start at 1 and must fall within the scenario's duration. These messages do not change the simulation.                                       |

Use the exact facility names, supported challenge IDs, and field limits in
[the mod schema](src/mods/ModSchema.js). The
[scenario catalog](src/data/Scenarios.tsx) maps challenge IDs to names. Omit optional
fields to keep their defaults. JSON does not allow comments or trailing commas.
An incompatible mod stays installed with an explanation beside it; ask its creator
for an update. Ordinary game releases do not require changing `gameApi`.

### Share on Steam Workshop

Connect to Steam, import your file, then choose **Publish [title]** under
**Create a mod**. Confirm **Publish publicly** to upload the scenario and your
creator name. Only publish content you have the right to share. If Steam requires
you to accept its Workshop agreement, choose **Open on Steam** in the result toast
and complete that step before others can see the item.

To update your item, edit the file, change its `version`, reimport it with the same
`id`, then choose **Update [title] on Workshop** and **Upload update**. This updates
the existing Workshop item. You can also share the JSON file directly for others
to import without Steam Workshop.
