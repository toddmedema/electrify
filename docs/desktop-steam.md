# Desktop and Steam distribution

The Electron build packages the production game and its assets together. It does not need a web
server, a browser installation, or a first online launch. Steam provides the desktop identity,
Cloud storage and leaderboards; the web edition continues to use Firebase.

## Build and test

Use Node 24 and the committed lockfile. Fetch Git LFS assets before building; the packaging
verification refuses pointer files and missing public assets.

```sh
npm ci
npm run check
npm run test:e2e
npm run test:desktop:native
```

These checks are windowless. Use headless Chromium for routine local UI validation, including
shared game UI changes. The Electron UI suite needs real native windows for focus, fullscreen,
and keyboard coverage, so run it in CI. To deliberately exercise native windows locally:

```sh
npm run desktop:build
npm run test:desktop -- --headed
```

By default, the desktop suite stops before launching Electron and points to the headless
browser command. The same opt-in is required in CI. For a manual game session, use
`npm run desktop:start` after building.

For a complete package on the current operating system that can be tested without a Steam
account or App ID:

```sh
npm run desktop:pack:offline
```

Build on the target OS using its native Node 24 installation and `npm ci`. Windows and Linux
packaging rejects cross-host or cross-architecture builds: Koffi installs a native package for
the host, and each depot must contain the correct Steam SDK and Electron binaries. On macOS,
either an Apple Silicon or an Intel Mac builds one universal app containing both architectures.
Packaging installs the other architecture's locked Koffi package before it merges the two
builds, and checks that the signed executable contains both `arm64` and `x86_64` slices.

| Target            | Depot under `dist/desktop/` | Executable inside the depot              | CI runner        |
| ----------------- | --------------------------- | ---------------------------------------- | ---------------- |
| Windows x64       | `win-unpacked/`             | `Electrify.exe`                          | `windows-latest` |
| Linux x64         | `linux-unpacked/`           | `Electrify`                              | `ubuntu-22.04`   |
| macOS (universal) | `mac-universal/`            | `Electrify.app/Contents/MacOS/Electrify` | `macos-15`       |

On macOS, open `Electrify.app`; on Linux, run `./Electrify` from the depot. Ship the **entire
directory or app bundle**, including native libraries and Chromium resources. Copying only the
executable does not produce a working game. Steam installs the unpacked depot; players do not
run npm, download dependencies, or install Electron themselves. Linux ARM and Windows ARM are
not supported by the pinned Steam binding.

The Mac app requires macOS 13 Ventura or later, matching the
[Electron 44 minimum](https://www.electronjs.org/blog/electron-44-0). The package's
`LSMinimumSystemVersion` is set to `13.0`; Steam store requirements must use that same minimum.

Run the packaged-app tests in PowerShell:

```powershell
$env:ELECTRIFY_EXECUTABLE = "$PWD/dist/desktop/win-unpacked/Electrify.exe"
npm run test:desktop -- --headed
Remove-Item Env:ELECTRIFY_EXECUTABLE
```

Use the matching path on Linux or macOS:

```sh
# Linux; for macOS replace the path with the matching executable from the table.
ELECTRIFY_EXECUTABLE="$PWD/dist/desktop/linux-unpacked/Electrify" npm run test:desktop -- --headed
```

The desktop suite launches Electron with a fresh, isolated profile. It exercises the production
renderer through the local protocol rather than a development server. The regular `npm run
check` also runs native desktop unit tests. The CI matrix builds and launches the complete
packaged executable on all three native targets, verifies every asset hash, resolves the actual
Steam SDK exports, and exercises offline gameplay, display changes, save recovery and keyboard
controls. Linux tests run under Xvfb and Openbox with the Electron renderer sandbox enabled.
Existing web browser and simulation gates remain required.

Successful jobs upload `electrify-offline-qa-<target>` artifacts for 14 days. Each contains
a `.tar.gz` of the entire depot, preserving executable permissions and macOS bundle structure.
Download it from the workflow's Artifacts list, extract the artifact ZIP, then extract the tar
archive with `tar -xzf electrify-offline-qa-<target>.tar.gz`. These are QA builds without
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
separate Windows, Linux and macOS depots with matching launch settings. Steam has one macOS
platform and does not choose depots by CPU architecture, so the single universal app serves
both Intel and Apple Silicon Macs. Set Windows to `Electrify.exe`, Linux to `Electrify`, and
macOS to `Electrify.app`. Publish the Steamworks changes and assign the build to a private
testing branch. This repository does not publish a Steam depot or configure your partner account.

macOS Steam releases require Developer ID signing and Apple notarization. Supply your signing
certificate through electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` configuration (or an
installed signing identity), and notarization credentials such as `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Use protected release credentials; the PR
workflow does not receive them. The hardened-runtime entitlements allow V8 JIT and the Steam
SDK/overlay injection required by Valve, and omit Apple's app-sandbox entitlement. Electron's
renderer sandbox remains enabled. Packaging checks native bytes before signing, then verifies
the signed app with `codesign --verify --deep --strict` and checks every game asset again. Before
uploading, confirm notarization and its offline ticket with `xcrun stapler validate Electrify.app`,
and test a fresh Steam install on both an Apple Silicon and an Intel Mac. Windows signing uses
the configured release certificate or signing provider; offline CI does not sign the executable.

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

**Settings → Credits and licenses** opens the bundled game, asset and dependency notices,
including desktop privacy information. These remain available offline. The website's privacy
page also distinguishes Steam services from the browser edition's optional Firebase services.

## Steamworks configuration and acceptance

### Achievements

Both editions implement the 34 achievements specified in
[issue #532](https://github.com/toddmedema/electrify/issues/532#issuecomment-6160701564)
plus Out of Juice for going bankrupt.
[`src/achievements/AchievementCatalog.json`](../src/achievements/AchievementCatalog.json) is the
authoritative list of stable API names, English display names, descriptions and SVG icons under
`public/images/`. Define all 35 achievements in Steamworks with those exact API names, Client
unlocks, and reviewed unlocked/locked raster versions of the listed artwork; publish the
configuration. Re-upload both rasters whenever a catalog icon changes.
The [achievement artwork package](../steamworks/achievement-artwork/README.md) contains all 70
locked/unlocked 256 × 256 PNGs and an upload map. Regenerate it with `npm run achievements:artwork`.
When Steam is available, its achievement interface and notifications are used. Without Steam,
the game provides bottom-right unlock notifications and an Achievements page from the main and
game menus. See [shared achievements](achievements.md) for device storage and Firebase sync.

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

Shared per-run telemetry persists evening customer energy and player-built storage
discharge, imports after commissioning a player-built intertie, exports, modeled efficiency
savings and output after an actual combined-cycle conversion. It uses the simulation's
representative-day weights and gross-source customer allocation. Evening ticks use the local
simulation clock from 18:00 up to, but excluding, midnight. Charging, exports, cancelled
retrofits, inherited storage and new combined-cycle purchases cannot count toward
storage/retrofit achievements. Saves preserve these counters under `game.desktopAchievements`.
Browser imports validate the optional telemetry. Missing or invalid telemetry resets on resume;
unknown past facility provenance and a partially observed month are not reconstructed or awarded.

The renderer's shared `achievements` chunk installs simulation hooks before loading saves;
`achievements-ui` holds the non-Steam gallery and notifications. The named `electron` chunk owns
Steam submission, presence and menu feedback. Literal build-time guards omit the native services
from the browser build. Both build commands inspect every compiled JavaScript
asset, including lazy chunks, to enforce the edition boundary. The native bridge accepts only
catalog IDs and bounded official completion records; native pointers and paths stay in main.

Earned intents are atomically journaled in the existing account-specific local save directory
before touching Steam. The pinned v012 SDK loads stats through RequestCurrentStats and receives
stats callbacks through the existing sole manual dispatcher. SetAchievement and StoreStats also
run in Steam Offline Mode, using Steam's offline cache. Pending intents remain on disk until a
successful, matching UserStatsStored callback acknowledges that submitted batch. Boolean API
returns, unrelated callbacks, failed writes and later awards cannot acknowledge it. Already
cached achievements are imported as earned and are not set again; a cache read alone cannot
confirm storage. Retries never reset achievements or completed flags. Native-interface failures
leave local earning usable. Failed journal writes retry synchronization later; cache imports
and receipts update the in-memory journal only after an atomic write succeeds. Missing receipts
retry the same frozen batch at most once a minute. Because StoreStats receipts have no request
ID, confirmation counts conservatively account for every older accepted request; late receipts
cannot acknowledge a newer batch. Fully received requests reset that accounting.

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

### Semantic Steam Input

The desktop edition uses native Steam Input actions rather than mapping controller buttons to
keyboard shortcuts. [`steamworks/input/actions.vdf`](../steamworks/input/actions.vdf) defines the
`Menu` and `Gameplay` action sets. Menu navigation, selection and Back are shared; gameplay adds
pause/resume, speed, pane switching, Build and chart switching. Build opens the catalog, and
purchases still require an explicit review and confirmation. The existing controls also handle
rate and capacity adjustments, chart inspection and Save & Quit.

On Windows and Linux, the packaged manifest lives at `resources/steam-input/actions.vdf`; on
macOS it lives at `Electrify.app/Contents/Resources/steam-input/actions.vdf`. The native process
registers its absolute path with Steam Input. Button hints use Steam's current action origins and labels,
so they follow the controller and the player's bindings. The hints appear after controller
input and yield to keyboard or pointer input. Directional actions repeat while held; selection,
Back and gameplay shortcuts require a new press. Returning from an overlay, changing action sets
or reconnecting requires held buttons to be released first. A disconnected controller pauses
the game; reconnecting does not resume it automatically.

In the actual App ID's Steamworks **Steam Input** settings, enable **Custom Configuration
(Bundled with game)** and set the manifest path to the packaged location for that platform.
Publish the changes before accepting a Steam build. The adjacent `controller_*.vdf` files supply
defaults for Xbox 360/One, Steam Deck (`neptune`), PlayStation 4/5 and Switch Pro. Keep the action
names stable when updating bindings: configurations refer to the action-set-prefixed API names
such as `Menu_confirm` and `Gameplay_confirm`. The repository files alone do not publish a
Steamworks configuration. See Valve's [action manifest setup](https://partner.steamgames.com/doc/features/steam_controller/action_manifest_file).

The default Xbox layout uses the D-pad or left stick to navigate, A to select, B to go back,
X to open Build, Y or Start to pause/resume, bumpers for panes, triggers for charts and the right
stick's up/down directions for speed. Steam's displayed origins describe the equivalent inputs
on other controllers and follow player customization.

Confirming an editable text field opens Steam's gamepad text editor. Submitted text follows the
field's normal validation and React change handling; cancelling preserves the original value.
Controller actions are suspended while the editor is open and require release before continuing.
Read-only fields do not open the editor. When Steam's editor is unavailable, physical keyboard
input remains available.

Windowless browser coverage uses a replacement native bridge while retaining the production
desktop renderer, real controls, reducers and save repository:

```sh
# Choose an unused task-specific port and keep it for this task's browser checks.
export E2E_PORT=3217
npm run desktop:build
STEAM_INPUT_BUILD_DIR=build npm run test:steam-input
```

`npm run check:ci` runs this production-renderer suite as its controller gate. The native CI
matrix also runs it once on the full-dependency macOS browser worker. It is headless and uses
semantic controller actions through a replacement native bridge, retaining the real controls,
reducers, and save repository. Its matrix covers 1280×800 and 1280×720 in light and dark themes,
a docked 1920×1080 view, and 390/360 px touch layouts. Coverage includes gameplay, construction,
rate changes, charts, reordering, custom-city selection, text size, Workshop navigation, and
multiplayer invite entry. These checks do not establish physical controller compatibility,
Steam configuration delivery, or Deck Gaming Mode acceptance.

Before release, launch a private Steam build with the real App ID and test:

- Steam Deck's built-in controls and supported Xbox, PlayStation and Switch controllers. Check
  that displayed origins match each device and a player-edited binding.
- Start a new game, inspect and buy a facility, adjust its size and the electricity rate, inspect
  chart points, change game speed, pause/resume and Save & Quit without a mouse or touchscreen.
  Confirm that visible focus and hints remain readable in light and dark themes.
- Hold Select while opening a purchase review or another dialog: it must require a fresh press
  to confirm. Check Back through chart details, nested decisions, tool panels and the game menu.
- Open/close the Steam overlay, change action sets, disconnect/reconnect and hot-swap controllers
  while holding controls. There must be no unintended action on return, and disconnect must
  leave the game paused until the player resumes it.
- Reload the saved game and verify its purchases and rate. Repeat offline, where locally
  installed configurations and local saves must remain usable.
- Enter a lobby code, rename a save and search the manual using the controller text editor.
  Check Unicode text, cancellation, returning focus and holding Confirm while closing the editor.

### Handheld readability and system sleep

Settings offers Standard (100%), Large (112.5%) and Larger (125%) text. This preference stays on
the device. It scales interface typography, chart labels and controller hints together without
changing the OS resolution or zooming the viewport. Controller navigation suppresses keyboard-only
shortcut prompts; a physical keyboard restores them. Native mod import/template dialogs and the
save-failure close warning temporarily request Steam's controller-to-mouse/keyboard navigation.
Returning from a native dialog restores semantic controls and requires held buttons to be released.
This integration still needs an actual SteamOS file-portal acceptance pass.

Electron handles system suspend separately from losing focus. Sleep gates native input and
pauses simulation/audio even when the window remains focused. Solo and shared-game checkpoints
are best effort: the OS can freeze the process before a write completes. Periodic checkpoints
remain the recovery boundary after a process kill or battery loss.

Wake renews the existing save writer and attempts another checkpoint before releasing the input
gate. Old wake acknowledgements cannot unlock a later sleep. The game stays paused until the
player resumes it; closing a purchase, help, or other blocking screen cannot restore an earlier
running speed. Multiplayer sleep also preserves the shared save and requires consent to continue.
A wake checkpoint failure uses the existing visible save error and retry path.

### Steam Deck release acceptance

Use a private Steam branch with the real App ID and the intended Linux runtime. For each release,
record the build/commit, SteamOS version, device model, runtime, controller configuration, and
pass/fail evidence. Run on an LCD and OLED Deck when available; repeat dock/undock with an
external controller and display. A browser viewport or Linux Xvfb run is not a substitute.

- **Launch and defaults:** install and start in Gaming Mode without a keyboard, launch arguments,
  compatibility overrides, or a community configuration. Verify the Linux executable and all
  bundled assets, audio, overlay and text entry. Confirm the published default bindings arrive.
- **Every player flow:** complete the tutorial path and a challenge; create a custom game and
  choose a city; buy/resize/upgrade facilities; reorder plants and interties; change pricing and
  programs; inspect charts; answer event/policy decisions; rename/load/delete a save; navigate
  installed mods and Workshop; host, join, reconnect and resume co-op. No flow may require touch
  or a physical keyboard. Check mod import/template dialogs with Steam's automatic native-dialog
  navigation, including cancellation, save-failure recovery and a sleep while a chooser is open.
  External authoring tools need their own usability check when advertised as supported.
- **Prompts and focus:** verify Deck glyphs and a player-edited binding; inspect tooltips, manual
  help, settings and charts for stray keyboard prompts. Test nested Back, modal focus restoration,
  held Confirm across dialogs, and controller replacement/disconnection.
- **Readability:** inspect default and Larger text at 1280×800 and 1280×720, both themes, at normal
  handheld distance. Check charts, numeric controls, selected focus, tool panels and the controller
  footer for clipping, overlap and unexpected page scrolling. Repeat docked and after undocking.
- **Sleep and recovery:** sleep during FAST play, construction review, text entry and an active
  save; wait beyond the save lease duration; wake while holding a button. Expect a paused game,
  correct saved progress, usable focus and audio, and no catch-up or unintended purchase. Repeat
  sleep/wake, go offline while asleep, and test a sleeping co-op host and guest with separate
  Steam accounts. Confirm save failures are recoverable without discarding local progress.
- **Offline and cross-device saves:** start with Steam Offline Mode, play/save/relaunch, and move
  saves between Deck and PC after clean exits. Preserve conflicts and device display/text settings.
  Dynamic Cloud Sync is not enabled by this implementation; seamless transfer while a game
  remains suspended requires a separate integration and acceptance pass.
- **Valve review:** submit the tested shipping build for Steam Deck compatibility review and
  resolve reported issues before advertising Verified support. Automated checks cannot award
  Valve's compatibility rating.

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
  simulation rules separate. Every native request must include the current compatibility ID.
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

## Store and library artwork

The [Steam artwork package](../steamworks/artwork/README.md) contains the required store and
library artwork, client icons (including macOS ICNS) and six real 1920 × 1080 gameplay
screenshots. Its upload map identifies every slot; the store and library headers share one
image. Five illustration masters, the wordmark and one export script support future updates.

Use the marketing exports directly in Steamworks. They stay outside `public/` and the desktop
depot. Position the separate library logo in Steamworks' preview, then submit the store page
through Valve's normal review process.

## Realtime Steam co-op

**Play with friends** on the desktop title screen offers **Host a game** or joining with an
invite code. Hosting opens a friends-only Steam lobby and goes straight to the normal selection
screens, where the top bar's **Invite friends** opens Steam's invitation overlay and **Copy invite
code** copies the full numeric lobby code. Two to four players can join or leave at any time before
the start. The host picks any authored scenario or a custom game. Guests follow the host's screen,
scenario, difficulty and custom settings read-only, and mark **Ready** for exactly what is shown;
any change by the host clears it. **Start for everyone** launches that scenario for the lobby once
a friend has joined and everyone is connected. Everyone
selects a running speed to begin. Tutorials, challenge links, replays and Data Center setup are
single-player only. The host chooses a scenario in the normal selection screens; guests follow that selection.

Every company plays the scenario as authored: its location, opening fleet, cash, customers,
difficulty, seed, story events and term are identical, so trade comes from different decisions.
The only change is the intertie setup below. Each company answers its own scenario choices, and
the shared clock waits until everyone has. Co-op is unranked. A company that goes bankrupt, is
fired or misses its objective retires: its grid freezes, its links stop, and it no longer holds
the shared clock, while the others play on. The match ends at the scenario's term or once every
company has retired, with a results table and **Back to lobby** for the host.

The host's worker runs every grid on one clock. Multiplayer uses the normal game view, including
the full build catalog, storage, policies, forecasts, rate controls and facility management.
Each player selects their own speed; the shared clock runs at the slowest selection. Your own
selection is the filled segment, and the game's active speed carries a slowly pulsing ring.
Other players' person markers sit along the bottom of the speed they chose, filling each button
from the left. Names, selections and pause reasons remain in accessible descriptions and hover
text.
Opening the build screen, reading a notification, opening settings, or putting the game
in the background pauses everyone without changing anyone's selection. Closing the interruption
restores the slowest remaining speed. Manual pause stays selected until that player changes it.
Starting, reconnecting, and restoring a save require everyone to select a running speed. Construction
controls keep working while paused. Save & Quit uses the normal top-left menu; guests request
a fresh whole-match checkpoint from the host before leaving.

Every company starts with an operating tier 1 intertie to every other player, including islands.
The normal intertie list and upgrade dialogs show these players. NPC market connections and
NPC fallback supply are removed for the match. Four companies have three human connections
each and six shared physical edges overall.
Starting connection budgets are 25% of opening peak demand, divided across the fixed roster.
Upgrades use the normal tier progression and construction accounting, require both owners'
approval, and charge each owner their half using cash or financing. Initial connections are
free and their combined annual O&M is $0.005 per installed watt. These starting multiplayer
calibrations need human balance testing.

The common market serves customers first, protects a 2% reserve, then helps neighbors before
optional storage charging. Running thermal plants can increase output within their original
tick's ramp limit when the posted fuel-indexed price covers incremental running costs. Plants
do not start solely to export. One global allocation maximizes served shortage, then shares it
by shortage coverage; both ends use one weather-adjusted line rating. Fuel, emissions and cash
settle through the existing simulation once. Paused purchases preserve the last shared tick's
recorded trade rather than overwriting it with a forecast of unknown future human supply.

Steam NetworkingSockets provides authenticated connections and reliable bounded messages through
the existing single callback dispatcher. Changed, complete revision-tagged views are coalesced
before cloning and sent at up to five times per second. Commands and their receipts use a separate
100 ms publication bound; unchanged paused views are suppressed. A small authenticated host
keepalive arrives once per second without replacing game state or acknowledging commands.
Commands have a match, epoch and monotonically increasing player sequence; retries retain the same
identity and last receipt. Reconnects receive a complete baseline immediately. A disconnect pauses every grid and
prevents resume until everyone reconnects. Lobby ownership transfer does not migrate the host. Client and host-controller heartbeats expire
after five seconds; an unresponsive player pauses the group. Desktop background timer throttling
is disabled only while a lobby is active.

See [network measurements](multiplayer-network.md) for reproducible payload sizes, scheduler-specific
traffic estimates and remaining opportunities. Complete ten-second checkpoints retain their existing
durability and retry behavior.

The host writes an atomic complete checkpoint about every ten seconds, then sends a chunked,
compressed, checksummed copy to each connected guest. A shared-save confirmation requires another
computer's persisted acknowledgement. The bundle includes all grids, canonical edges, dispatch
commitment metadata and command receipts. Normal host exit joins the existing desktop quit save
handshake. Local persistence does not wait for an absent player's acknowledgement. Manual resume
uses one complete bundle, the original roster and a fresh epoch; pending old commands are dropped.
Co-op checkpoint schema 3 records the solo save schema for its grids. Resume accepts only the
current bundle and solo save schemas with matching game code and data, and validates every grid
and shared connection before play. Unsupported checkpoints are rejected.

When the host has multiplayer saves, the scenario list shows **Load multiplayer save** across the
top. It lists each save with its players and save time, and its menu offers deletion with
confirmation. Loading a save gathers the lobby to pick companies: each row is labelled with the
Steam name that saved it. A returning player takes back their own company by default, and anyone
in the lobby can take an open one; the host resumes once every company still playing has a
connected player. A company handed to a new player is saved under that player's Steam ID and name.
New and resumed games start with every player
paused, using the same speed controls as ordinary play.
The account-specific `co-op-library.json` holds up to 32 campaigns and 64 MiB; a checkpoint is
limited to 16 MiB. The rotating `.previous` file protects interrupted writes.

Steam Cloud uses separate `electrify/co-op-device-<32-hex-device-id>.json` libraries. Different
checkpoints are retained as separate Cloud copies, with deletion history to suppress a deleted
copy's return. Budget Cloud quota for both solo and co-op libraries on each computer. Local
saving remains available while Steam or Cloud is offline.

Run `npm run test:multiplayer` for windowless two- and four-player browser sessions with the real
worker and an in-memory Steam bridge. CI serves the verified production desktop renderer. To
exercise that path locally, run `npm run desktop:build`, then set `MULTIPLAYER_BUILD_DIR=build`
when running the multiplayer tests. The default local path uses the development server.
Native unit tests resolve the actual SDK exports and cover
framing, membership checks and invite IDs. `src/multiplayer/World.sim.test.ts` runs four grids for
five years, checking trade conservation and checkpoint size. A local uninstrumented run measured
0.8 ms mean world-step time and a 249 KB maximum compressed checkpoint; month rollovers reached
67 ms and slow the shared clock instead of skipping economic ticks. These are development-machine
measurements, not a Steam Deck or network acceptance result.

Before release, use the real App ID on a private Steam branch with separate accounts: test two,
three and four players; relay-only connectivity; running-game and launch-time invites; Windows,
Linux and macOS peers; disconnect/reconnect; a sleeping host; clean host exit; and resume from a
guest's saved copy in a new lobby. No live Steam account acceptance is claimed by the mocked
headless tests. No Firebase relay or developer-operated game server is required for this mode.

Design background: [V2 proposal](multiplayer-realtime-proposal.md). Native API references:
[NetworkingSockets](https://partner.steamgames.com/doc/api/ISteamNetworkingSockets),
[lobbies](https://partner.steamgames.com/doc/features/multiplayer/matchmaking), and
[lobby join requests](https://partner.steamgames.com/doc/api/ISteamFriends#GameLobbyJoinRequested_t).
