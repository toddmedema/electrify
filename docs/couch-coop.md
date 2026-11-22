# Local couch co-op preview

The first vertical slice of issue [#703](https://github.com/toddmedema/electrify/issues/703)
is an opt-in two-company preview. It is hidden during ordinary desktop play. Set
`ELECTRIFY_COUCH_PREVIEW=1` when launching the desktop application to offer
**Play with friends → On this TV**. Steam Input and installed controller bindings
are required, including in Steam Offline Mode. The offline edition does not add
another controller backend.

Each controller explicitly joins a company. P1 chooses an existing co-op scenario
or custom game; both players confirm that selection. The campaign roster then
stays fixed. An assigned controller controls only its company's document. The
shared bar shows the calendar and year progress, with the upcoming event and
months left on the right. Each player selects a speed in their pane, and the
slowest selection sets the pace. Each seat has a fixed color for the company
name, cash, and speed selection outline. The blue fill marks the running speed.
To see the shared speed, seat selections and
full pause reasons, press Start/Menu or Select/View and choose **Clock status**
in the Game menu. The shared menu pauses the match. Either
controller can navigate the shared menu and Settings. Save & Quit confirmation
belongs to the named requesting company. The active controller's bindings
appear under Controls while the menu, Settings or Manual is open.
Player panes keep cash and grid state, with icon-only navigation. The shared
screen-edge padding surrounds the status band and both panes. The center
separator stays the same size as padding changes.
The daily supply/demand plot is 20% shorter in split-screen to leave more room
for the fleet.
Cash and monthly profit share a row in each company pane. The shared date and
event name and months-left text follow the grid-status type size, including native
zoom and text scaling.

Prompts prefer Steam's controller glyphs. When Steam supplies only a physical
control label, recognized labels use a small CC0 SVG subset from
[Kenney Input Prompts](https://kenney.nl/assets/input-prompts). Unknown bindings
keep their text labels; icons are never guessed from an action's default binding.

The native model and save format support two to four companies, but the UI rejects
three and four until their release gates pass. It also refuses a layout below
360 CSS pixels per company instead of shrinking text or dropping a company.

## Runtime boundaries

Electron main owns one sandboxed `WebContentsView` per company. Each view has an
ephemeral partition with the bundled protocol and request restrictions, isolated
zoom, a separate Redux store and a narrow preload. Seat bootstrap does not start
save recovery, save writer leases, account services or an independent simulation.
Keyboard and pointer events target the focused native document; controller events
use explicit device bindings rather than enumeration order.

The shell owns one real multiplayer world worker. Main authenticates the exact
top-level seat document and binds its message port to a company and generation.
Seat messages cannot create, restore or checkpoint a world, impersonate another
sender, or invoke account IPC. The coordinator preserves independent command
sequences, authoritative receipts, coalesced view delivery and a full recovery
baseline. Global dialogs gate gameplay input. Paused company screens remain visible
behind the shared menu, settings and manual as bounded native captures. The shell
decodes and paints them before acknowledging the native-view handoff; stale
capture generations cannot hide a newer session. Layout and presentation changes
refresh the backdrop while the real company views stay hidden. Controller
replacement or renderer reload revokes the old route and requires fresh readiness.

Application foreground, power and global dialogs are session blockers. Seat focus
changes do not background the match. A retired company retains its labelled pane
but does not hold the clock or require a controller. Sleep never accrues missed
ticks. Renderer recovery uses the surviving worker; a worker failure requires the
last complete saved checkpoint in a fresh epoch.

Account services observe only the shell's authoritative P1 projection, including
an inactive restore baseline before live telemetry. Guest companies never submit account achievements or timeline events. Music and
platform services stay in the shell. When Controller vibration is enabled, seat
confirmation and milestone cues go through Steam Input to that seat's current
controller handle. The SDK may ignore cues on hardware that does not support
vibration. Focus loss, overlays, invalid layouts and seat replacement stop or
suppress cues. The shared preference also applies to replacement controllers.

The flat Steam Input v006 vibration function is exported by all three pinned
desktop SDK binaries. Automated checks cover distinct 64-bit handles,
disconnection, replacement and stale renderer messages. Physical verification
remains open. [Steam Input vibration API](https://partner.steamgames.com/doc/api/isteaminput#TriggerVibration)

To record the physical check, launch a packaged Steam build with vibration
enabled and join with two different controller families, such as Xbox and
DualSense. Join in the opposite order from Steam's device list. Confirm a control
in each company pane and verify that only its controller vibrates. Disconnect
one controller, explicitly assign a third controller to that company, select
running speeds to recover and repeat the checks for both companies. Verify that
the original controller stays silent if it reconnects unassigned. Turn off
Controller vibration and repeat both confirmations. Record the build, OS, Steam
client, binding profiles, controller models and observed results.

## Local persistence

Local campaigns use `local-coop-library.json` in the existing native account or
offline profile. Logical IDs (`local-p1` through `local-p4`) are separate from the
account owner and never masquerade as Steam IDs. The online save store's Steam
membership checks are unchanged. Local/online conversion and Cloud replication of
the local library are outside this release.

One write contains all grids, edges, outcomes, command sequences and receipts.
Periodic checkpoints and explicit saves share a serialized atomic-write queue and
previous-copy recovery. Save & Quit stops new commands, rejects unsent actions
explicitly and waits for the worker's checkpoint barrier and successful local
write. A receipt means applied; a successful save acknowledgment means durably written.
Unreadable files are preserved. Loading requires explicit controller assignment
and fresh readiness; hardware handles are never persisted.

## Verification and release gates

`src/couch/Coordinator.test.ts` uses the real world/reducer to exercise command
ownership, duplicate application, pauses, recovery, retirement, bounded delivery
and save barriers. Native unit suites cover geometry, exact sender authorization,
ports, controller identity, overlay context restoration and storage failures.

`e2e/couch.spec.ts` runs through the normal Steam-input headless runner with only
the native transport replaced. It uses the production shell, shared worker, seat
bootstrap, clients and controls. The journeys cover two owners approving the same intertie,
controller replacement and renderer recovery, an absent retired controller,
match results, global dialog routing and a failed Save & Quit followed by a retry.
They also exercise padded 1080p and 4K layouts at larger interface scale,
controller navigation to full clock reasons and resize recovery with the same
company documents.

`e2e/desktop-couch.spec.ts` runs against packaged Electron in the existing
desktop CI job. It checks actual native views, partitions, protocol loading,
ports, input gating, padded bounds, resize recovery, isolated zoom and disposal.
The Steam Input fixture supplies device frames and storage failures in the
headless journeys. Native focus, overlay and compositor behavior still require
the packaged fixture or a physical playthrough.

The preview flag must remain opt-in until the issue's physical acceptance gates
are recorded: a 55-inch TV at about nine feet, 1080p and 4K, both palettes, larger
text, mixed/remapped controllers, Steam Offline Mode, global text entry,
background/sleep/wake, and the complete no-mouse journey. Windows, Linux, macOS
and Deck require their own packaged evidence. Three/four players additionally
need their layout, controller and low-tier performance gates.

No physical-TV readability or shipping performance budget is claimed by this PR.
Record at least three repeatable production runs on the intended lowest hardware
tier, including input latency, compositor frames, rollovers, CPU/RSS/GPU cost,
save writes and memory after repeated entry/exit, before enabling a player count.
