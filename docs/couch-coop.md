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
shared bar reuses the single-player calendar and year progress, upcoming event
and months-left display. Each player has an independent speed selector in their
pane; the slowest selection wins. Start opens one shared three-dot menu and pauses the
match for everyone. The requesting controller's complete bindings appear along
the bottom while that menu is open. Player panes keep cash and grid state, with
icon-only navigation and no duplicate menu, calendar, event or control-hint bars.
The panes fill the left, right and bottom edges, retaining only the center separator.
The daily supply/demand plot is 20% shorter in split-screen to leave more room
for the fleet.
Cash and monthly profit share a row in each company pane. The shared date and
event name follow the grid-status type size, including native zoom and text scaling.

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
an inactive restore baseline before live telemetry. Guest companies never submit
account achievements or timeline events. Music and platform services stay in the
shell. Browser-gamepad vibration is suppressed throughout couch play: the pinned
native binding does not provide a verified Steam-handle mapping for haptics.
Seat vibration remains an explicit preview limitation until that mapping is
implemented and tested; it is never sent to an arbitrary first browser gamepad.

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
bootstrap, clients and controls. `e2e/desktop-couch.spec.ts` is selected by the
existing native desktop CI runner and checks actual Electron views, partitions,
protocol loading, ports, zoom and disposal. Browser bridge mocks do not establish
native focus, Steam overlay, physical controller or compositor behavior.

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
