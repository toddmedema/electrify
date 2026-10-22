# Electrify

Build power plants, keep the lights on, and make your grid cleaner. Electrify is a
mobile-friendly tycoon game about electricity markets, where weather, fuel prices,
and unexpected events put your plans to the test.

**[Play Electrify](https://electrifygame.com)** in your browser, on desktop or mobile.

![Electrify gameplay: a fleet of power plants, supply and demand forecasts, and upcoming events](public/images/gameplay-preview.png)

## Run locally

Install **Node.js 24** and **[Git LFS](https://git-lfs.com/)**, then:

```sh
git clone https://github.com/toddmedema/electrify.git
cd electrify
git lfs install
git lfs pull
npm ci
npm run check:assets
npm start
```

Open [localhost:3000](http://localhost:3000). The app reloads as you edit.
Online accounts and leaderboards need a Firebase API key from a maintainer; see
[setup notes](CONTRIBUTING.md#setup-notes).

## Start contributing

There are plenty of ways to help: tune game balance, write a scenario, improve a
tutorial, fix a bug, or make the interface easier to use.

- [Browse issues](https://github.com/toddmedema/electrify/issues) to find work or
  share a bug report or idea.
- Read the [contributor guide](CONTRIBUTING.md) for a map of the code and how to
  check your changes. The app uses React 18, Redux Toolkit, and TypeScript.
- Keep your pull request focused and explain what changed and how you checked it.

For a quick feedback loop, run `npm run test:once -- <name>` for one test suite or
`npm run sim -- --scenario 103` to try a scenario without a browser.
Use `npm run check` during development and `npm run check:ci` before pushing code
changes. For prose-only Markdown changes, review the text and run `git diff --check`.

## Explore further

- [Simulation guide](src/testing/README.md): run scenarios and check game economics.
- [Mods and Steam Workshop](docs/mods.md): create and share community scenarios for
  the desktop edition.
- [Desktop and Steam](docs/desktop-steam.md): build an offline app or prepare a Steam release.
- [Weather and assets](docs/weather-and-assets.md): add cities, update weather, and
  work with icons and manual figures.
- [Releases](docs/releases.md): web deployment, version metadata, and account storage.

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
