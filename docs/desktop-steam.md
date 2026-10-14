# Desktop and Steam distribution

The Electron build packages the production game and its assets together. It does not need a web
server, a browser installation, or a first online launch. Steam provides the desktop identity,
Cloud storage and leaderboards; the web edition continues to use Firebase.

## Build and test

Use Node 24 and the committed lockfile. Fetch Git LFS assets before building; the packaging
verification refuses pointer files and missing public assets.

```sh
npm ci
npm run desktop:build
npm run desktop:start
npm run test:desktop:native
npm run test:desktop
```

For a complete package on the current operating system that can be tested without a Steam
account or App ID:

```sh
npm run desktop:pack:offline
```

Build on the target OS and architecture using its native Node 24 installation and `npm ci`.
The packaging command rejects cross-host or cross-architecture builds: Koffi installs a native
package for the host, and each depot must contain the correct Steam SDK and Electron binaries.

| Target | Depot under `dist/desktop/` | Executable inside the depot | CI runner |
| --- | --- | --- | --- |
| Windows x64 | `win-unpacked/` | `Electrify.exe` | `windows-latest` |
| Linux x64 | `linux-unpacked/` | `Electrify` | `ubuntu-22.04` |
| macOS Intel | `mac/` | `Electrify.app/Contents/MacOS/Electrify` | `macos-15-intel` |
| macOS Apple Silicon | `mac-arm64/` | `Electrify.app/Contents/MacOS/Electrify` | `macos-15` |

On macOS, open `Electrify.app`; on Linux, run `./Electrify` from the depot. Ship the **entire
directory or app bundle**, including native libraries and Chromium resources. Copying only the
executable does not produce a working game. Steam installs the unpacked depot; players do not
run npm, download dependencies, or install Electron themselves. Linux ARM and Windows ARM are
not supported by the pinned Steam binding.

Both Mac builds require macOS 13 Ventura or later, matching the
[Electron 44 minimum](https://www.electronjs.org/blog/electron-44-0). The package's
`LSMinimumSystemVersion` is set to `13.0`; Steam store requirements must use that same minimum.

Run the packaged-app tests in PowerShell:

```powershell
$env:ELECTRIFY_EXECUTABLE = "$PWD/dist/desktop/win-unpacked/Electrify.exe"
npm run test:desktop
Remove-Item Env:ELECTRIFY_EXECUTABLE
```

Use the matching path on Linux or macOS:

```sh
# Linux; for macOS replace the path with the matching executable from the table.
ELECTRIFY_EXECUTABLE="$PWD/dist/desktop/linux-unpacked/Electrify" npm run test:desktop
```

The desktop suite launches Electron with a fresh, isolated profile. It exercises the production
renderer through the local protocol rather than a development server. The regular `npm run
check` also runs native desktop unit tests. The CI matrix builds and launches the complete
packaged executable on all four native targets, verifies every asset hash, resolves the actual
Steam SDK exports, and exercises offline gameplay, display changes, save recovery and keyboard
controls. Linux tests run under Xvfb and Openbox with the Electron renderer sandbox enabled.
Existing web browser and simulation gates remain required.

Successful jobs upload `electrify-offline-qa-<platform>-<arch>` artifacts for 14 days. Each contains
a `.tar.gz` of the entire depot, preserving executable permissions and macOS bundle structure.
Download it from the workflow's Artifacts list, extract the artifact ZIP, then extract the tar
archive with `tar -xzf electrify-offline-qa-<platform>-<arch>.tar.gz`. These are QA builds without
a Steam App ID, Developer ID signing or notarization; they do not enable Steam services and are
not release depots. Mac QA bundles use local ad hoc signatures for valid native code on Apple
Silicon; these are not a trusted Developer ID signature. Windows QA executables are unsigned.
Offline Mac packaging enables only that local signature on pull requests, temporarily removes
release signing/notarization credentials, and forces the ad hoc identity. Steam release signing
retains electron-builder's normal pull-request credential protection.
macOS Gatekeeper may reject these downloads on another computer; use a signed, notarized release
for player distribution.

## Prepare a Steam build

Use the App ID allocated to Electrify in your Steamworks account. Do not ship Spacewar's test
App ID or a development `steam_appid.txt` file.

```powershell
$env:STEAM_APP_ID = "YOUR_ELECTRIFY_APP_ID"
npm run desktop:pack
Remove-Item Env:STEAM_APP_ID
```

The same command works on each native host; in POSIX shells use
`STEAM_APP_ID=YOUR_ELECTRIFY_APP_ID npm run desktop:pack`. It refuses a missing App ID. Create
separate Windows, Linux and macOS depots, with distinct Intel and Apple Silicon Mac builds and
matching launch settings. Set Windows to `Electrify.exe`, Linux to `Electrify`, and macOS to
`Electrify.app`. Test how Steam selects the two Mac architecture depots on both kinds of Mac
before release. Publish the Steamworks changes and assign the build to a private testing branch.
This repository does not publish a Steam depot or configure your partner account.

macOS Steam releases require Developer ID signing and Apple notarization. Supply your signing
certificate through electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` configuration (or an
installed signing identity), and notarization credentials such as `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Use protected release credentials; the PR
workflow does not receive them. The hardened-runtime entitlements allow V8 JIT and the Steam
SDK/overlay injection required by Valve, and omit Apple's app-sandbox entitlement. Electron's
renderer sandbox remains enabled. Packaging checks native bytes before signing, then verifies
the signed app with `codesign --verify --deep --strict` and checks every game asset again. Before
uploading, confirm notarization and its offline ticket with `xcrun stapler validate Electrify.app`,
and test a fresh Steam install on each architecture. Windows signing uses the configured release
certificate or signing provider; offline CI does not sign the executable.

Steam has to be installed and logged in at least once to establish a player's ownership and
offline account. The game itself has all of its content available on the first launch without
a network connection. Native Steam functionality is optional to offline gameplay; friend
leaderboards and remote synchronization become available through the Steam client when it can
connect.

## Desktop behavior

The first launch opens fullscreen. Settings includes fullscreen, window resolution and an exit
action. F11 and Alt+Enter toggle fullscreen. Display preferences persist locally and are kept
out of Cloud storage; they are specific to the monitor and computer.

Saves remain local when Steam or Cloud is unavailable. A normal window close or in-game exit
waits for a save checkpoint before closing. A process kill or power loss can still lose work
since the last completed checkpoint, as with other games.

The renderer runs without Node integration, with context isolation and a sandboxed preload.
The preload exposes a small, validated bridge instead of arbitrary filesystem or IPC access.
Bundled pages, simulation data, fonts, audio, images and worker chunks load from a secure local
protocol. Desktop gameplay does not use Firebase login, Firebase Cloud backup, analytics or a
web service worker. Native Steam calls run outside the renderer.

## Steamworks configuration and acceptance

### Achievements

The Electron edition implements the 34 achievements specified in
[issue #532](https://github.com/toddmedema/electrify/issues/532#issuecomment-6160701564)
plus Out of Juice for going bankrupt.
[`src/desktop/AchievementCatalog.json`](../src/desktop/AchievementCatalog.json) is the
authoritative list of stable API names, English display names, descriptions and existing SVG
icons. Define all 35 achievements in Steamworks with those exact API names, Client unlocks, and
reviewed unlocked/locked raster versions of the listed artwork; publish the configuration.
There is no new artwork or browser achievement UI.

Configure the 77 INT completion flags listed in
[`steamworks/achievement-stats.csv`](../steamworks/achievement-stats.csv): seven tutorial
completions and one flag for every official scenario/difficulty pair. Each defaults to 0, has
minimum 0 and maximum 1, is increment-only, and is set by Client. This CSV is a configuration
reference. Independent flags let Steam merge different completions earned offline on different
computers without overwriting another win. The generated native catalog and CSV are refreshed
by `node scripts/generate-achievements.js` and `desktop:build`.

First Spark and Grid Graduate use actual walkthrough completion, including the final challenge;
exiting a tutorial or merely reaching its time limit does not count. Other achievements require
an official non-tutorial run. Custom runs, replay playback, forecast calculations and modified
simulation harnesses are excluded. Scenario achievements require the committed `completed`
outcome at full duration, including normal objectives. Every difficulty qualifies; a CEO win
also contributes one distinct scenario to Master of the Grid. A score dialog alone is never
evidence of a win. Out of Juice requires the committed `bankrupt` outcome on any difficulty;
it does not record a successful completion or contribute to Master of the Grid. Being fired
does not qualify.

Reliability requires positive demand and customer energy served/demanded of at least 99.9% in
each measured month. Four Nines uses lifetime 99.99%. Final-year criteria require 12 completed,
individually reliable months. Emissions intensity includes local, imported and construction
emissions divided by customer MWh served. Fuel shares use the existing customer-delivered fuel
history; storage and imports never become local renewable generation. Public utility rates use
the existing starting-dollar customer-revenue helper, excluding exports and grants.

Electron-only per-run telemetry persists evening customer energy and player-built storage
discharge, imports after commissioning a player-built intertie, exports, modeled efficiency
savings and output after an actual combined-cycle conversion. It uses the simulation's
representative-day weights and gross-source customer allocation. Evening ticks use the local
simulation clock from 18:00 up to, but excluding, midnight. Charging, exports, cancelled
retrofits, inherited storage and new combined-cycle purchases cannot count toward
storage/retrofit achievements. Saves preserve these
counters. Older saves receive empty telemetry when resumed: unknown past facility provenance
and a partially observed month are not reconstructed or awarded. Browser imports discard this
optional Electron telemetry.

The renderer's named `electron` chunk installs simulation hooks before loading saves and owns
achievement observation, presence and menu feedback. Literal build-time guards omit it and its
catalog/counters from the browser build. Both build commands inspect every compiled JavaScript
asset, including lazy chunks, to enforce the edition boundary. The native bridge accepts only
catalog IDs and bounded official completion records; native pointers and paths stay in main.

Earned intents are atomically journaled in the existing account-specific local save directory
before touching Steam. The pinned v012 SDK loads stats through RequestCurrentStats and receives
stats callbacks through the existing sole manual dispatcher. SetAchievement and StoreStats also
run in Steam Offline Mode, using Steam's offline cache. Pending intents remain on disk until a
successful, matching UserStatsStored callback acknowledges that submitted batch. Boolean API
returns, unrelated callbacks, failed writes and later awards cannot acknowledge it. Already
cached achievements are not set again; retries never reset achievements or completed flags.
Steam outages leave local play available.

Automated tests cover threshold boundaries, all scenario/difficulty completions, save/resume,
forecast/replay exclusion, offline earning/reconnect/relaunch, callback packing for all supported
OSes, overlapping batches and corrupt-journal recovery. Before advertising Steam Achievements,
test the published configuration on the real App ID/private build: earn a tutorial and scenario
award, inspect their overlay notifications/icons, earn offline, reconnect, relaunch, check a
second computer, and verify no duplicate or missing awards. Automated mocks do not establish
that the partner configuration or Steam overlay works.

References: [Steam Stats and Achievements](https://partner.steamgames.com/doc/features/achievements)
and [ISteamUserStats](https://partner.steamgames.com/doc/api/ISteamUserStats).

### Rich Presence and recording highlights

Steam friends see the authored scenario and year progress, with separate menu, loading, pause,
replay and completion states. The adapter sets `steam_display` localization tokens rather than
accepting arbitrary status text. It never publishes custom save names, run identifiers, account
details or imported titles. Unknown scenario IDs use "Custom grid". Identical updates are skipped;
reconnection publishes the current state, and exit clears all presence keys.

`desktop:build` generates `electron/steam-localization.cjs` and
[`steamworks/rich-presence.vdf`](../steamworks/rich-presence.vdf) from the authored scenario
array without running browser/reducer code. Upload the VDF under **Edit Steamworks Settings →
Community → Rich Presence**, then publish those settings. English is the game's current supported
language and Steam's fallback. Add reviewed language tokens to the catalog when supporting more
languages. Verify the real App ID with [Steam's Rich Presence tester](https://steamcommunity.com/dev/testrichpresence),
including menu → scenario/year → pause/replay → completion → exit and a second Steam account.

Recording highlights are off by default. Enabling them adds instantaneous major-construction,
blackout/recovery and victory markers to Steam Timeline; it does not start video recording.
The player controls Game Recording in Steam. Replay/restored history is not backfilled, offline
markers are not queued, and one occurrence is emitted once per run during the process lifetime.
Native dedupe stores at most 64 runs and 4096 occurrences per run, and stops adding markers at
those limits. These identifiers stay local and are never sent to Steam.

The pinned Steam SDK provides Timeline **v001**, using the icon-first, void-returning
`AddTimelineEvent` API. Optional symbol and null-interface checks keep older clients/SDKs
playable. Native tests resolve the bundled exports and exercise exact arguments, including
zero real-time offset/duration; simulation years are descriptive text. These synchronous calls
do not add another callback pump. Live acceptance still requires Steam Game Recording enabled on the
private build, actual marker/clip inspection, default-off/on/off behavior, repeated milestones,
replay exclusion, offline/reconnect and quit. SDK capability tests do not verify recorded video.

References: [Rich Presence localization](https://partner.steamgames.com/doc/api/ISteamFriends#richpresencelocalization),
[Steam Timeline guidance](https://partner.steamgames.com/doc/features/timeline), and the
[Valve v001 SDK header](https://github.com/rlabrecque/Steamworks.NET/blob/7e5ab1859e30dab8162de2327d7fcfd176ce1064/CodeGen/steam/isteamtimeline.h).

### Partner setup and release acceptance

Steam services need configuration and a live test against the actual App ID. Automated offline
and mocked API tests cannot establish that a partner configuration works or that Valve will
approve the product.

- Enable Steam Cloud for the app, set a suitable byte quota and file count, save and publish
  those settings. Check local saves with Cloud disabled, a disconnected client, two computers,
  and a conflicting save. Do not configure Auto-Cloud to synchronize Chromium profiles or
  display settings.
- Cloud uses `ISteamRemoteStorage` through `steamworks.js`, with one
  `electrify/device-<32-hex-device-id>.json` library per computer. Set an initial quota of at least
  256 MiB and 128 files per player, then measure representative long-game libraries before
  release. Each library is limited to 64 MiB. Separate device files retain conflicting progress
  rather than allowing a last-writer replacement to discard another computer's saves.
- The adapter creates leaderboards named
  `electrify-v1-s<scenarioId>-<lowercase-difficulty>-<digest>`, where `digest` is the first 24 hex
  characters of SHA256 of the generated run-compatibility ID. This keeps scores under different
  simulation rules separate. Native calls with no compatibility ID use SHA256 of `legacy`.
  The boards use descending numeric scores and KeepBest. Confirm client writes and global reads
  are enabled in Steamworks so that both global and friends views work; set Community Names
  there if boards should appear in the Community Hub. Check with two accounts that own the
  private build and are Steam friends.
- Test Shift+Tab and the in-game friends action on the shipping build. Overlay initialization
  must occur before the game's graphics context exists. Confirm the game remains usable after
  repeated overlay opens, Alt+Tab, fullscreen changes and a Steam client reconnection.
- Test Steam Offline Mode after installation with a new game profile: play a mission, create a
  custom game in another weather location, use charts and sounds, save, exit, and resume.
- Confirm every operating system and feature advertised on the store page has been exercised
  on its real shipping build. Native CI validates packaged offline gameplay on its runner OS;
  it does not validate live Steam accounts, the Steam Linux Runtime, Steam Deck gaming mode,
  controller support, release code signing or notarization. Test Linux through the intended
  Steam runtime before choosing store system requirements.
- Submit the store page and build for Valve review. Only advertise features that are available
  and tested at release; a repository design review is not Steam certification.

Primary references: [Steam Cloud](https://partner.steamgames.com/doc/features/cloud),
[leaderboard setup](https://partner.steamgames.com/doc/features/leaderboards/guide),
[Steam Overlay](https://partner.steamgames.com/doc/features/overlay),
[build review](https://partner.steamgames.com/doc/store/review_process), and
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security). Platform references:
[GitHub runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[Electron headless testing](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci),
[Steam platform release requirements](https://partner.steamgames.com/doc/store/application/platforms),
and [Electron signing and notarization](https://www.electronjs.org/docs/latest/tutorial/code-signing).
