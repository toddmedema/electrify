# Achievements

The same 35 achievements, including bankruptcy's **Out of Juice**, work on web and Electron.
`src/achievements/AchievementCatalog.json` supplies stable IDs, requirements and existing artwork.
The shared evaluator observes committed simulation evidence. Official scenarios qualify on any
difficulty unless a requirement specifies CEO; tutorials require their final challenge. Custom
games, replay playback, forecasts and modified simulation harnesses do not earn achievements.

The `achievements` lazy chunk installs the evaluator before game saves are parsed or restored.
The existing optional `game.desktopAchievements` save key is retained for compatibility; its
shape and schema have not changed. Older saves begin observing new counters on resume and cannot
invent missing history. `achievements-ui` contains the gallery and popup components. Steam-only
submission, presence and SDK code remain behind the Electron build guard and named `electron`
chunk. Both production builds inspect all compiled JavaScript, including lazy chunks, for this
boundary.

## Local history and accounts

`electrify-achievements-v1` in localStorage holds one guest record and records keyed by account
UID. Each version-1 record contains earned catalog IDs, seven distinct tutorial completion flags,
and up to 70 distinct official scenario/difficulty wins. Unions derive aggregate achievements
such as Grid Graduate and Master of the Grid. Ordering is stable and unknown/duplicate IDs are
rejected. The history is independent of deleting or replacing a game save.

Signing in atomically moves guest evidence into that account's local record and empties the
guest record. A later account cannot claim it again. Account changes clear pending notifications
and exclude the prior account's active-run evidence from subsequent submissions. A stale cloud
response cannot change the active account's history. Sequential tabs refresh storage before
writes and react to storage events; simultaneous guest claims are limited by localStorage's lack
of cross-tab transactions. Firebase's authenticated transaction remains the authority for cloud
merges.

If storage access or a write fails, live achievements remain in memory and the gallery explains
the session-only state. Sync can still save them to an authenticated account. Writes retry on
focus, online events and a 30-second interval. Corrupt or oversized local records are rejected.

## Firebase sync

Signed-in web users merge the local record with the private Firestore document
`users/{uid}/achievementProgress/current` in a transaction. A retried transaction reads the newest
remote history and unions both records, so different devices cannot overwrite one another's
completions. Local awards earned during an upload trigger a subsequent upload. Cloud downloads
are silent. Failures retain local progress, expose Retry sync, and retry on connectivity/focus
or the timer; unchanged accounts refresh remote history every five minutes.

The generated rules permit owner-only gets and bounded, grow-only creates/updates. Listing,
deleting, another user's access, unknown IDs, duplicate flags and removals are denied. These
client-earned achievements are not a server-verified competitive score. Existing production
deployment publishes Firestore rules before the web client.

`node scripts/generate-achievements.js` regenerates the native catalog, Steam completion-stat
CSV and the marked Firestore rules from the shared catalog. Keep generated rules in source.
`npm run test:rules` uses the Firestore emulator under the demo project
`demo-electrify-achievements`, never production. It requires Java 21; CI installs Temurin 21.

## Non-Steam interface

The main menu and game overflow menu expose Achievements when Steam is unavailable. The gallery
shows all requirements, earned/locked text and count filters, plus accurate device/account sync
status and the existing Google sign-in flow. Opening the gallery pauses gameplay like other
standalone screens. Keyboard entry focuses Back; Escape returns to the opener.

Live local unlocks queue one popup at the bottom right. On phones the popup sits above game
navigation. It never pauses gameplay or steals focus, waits behind dialogs/menus and ordinary
snackbars, pauses its eight-second timer while hovered or focused, and offers View achievements
and an always-visible 44 px close button. At 320 px the popup omits the visible requirement
sentence to cover less gameplay; the gallery and polite announcement retain it.
Reloads, cloud downloads and restored native history
do not replay notifications. Steam availability clears/suppresses the web popup queue; Steam
Offline Mode continues using Steam's notification interface.

The renderer can read the current native player's existing achievement history through a bounded
IPC response, so upgrading an offline Electron profile preserves its prior awards in the gallery.
Native paths, SDK pointers and acknowledgement metadata never enter the renderer.

Tests cover evaluator thresholds, merges, local reloads, guest claims, account switches, late
responses, writes during sync, storage failures and rules enforcement. Browser tests exercise
real mission completion, popup placement, gallery filters, focus return, light/dark palettes and
390/320 px layouts. Live Steam partner acceptance is documented in `desktop-steam.md`.
