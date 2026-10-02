# Implementation plan for multiple named saves

Status: implementation specification for one complete change, revised after code, QA, and visual reviews. The app is not in production, so existing browser saves and exports do not need migration or backward compatibility.

Give each playable run its own named save, and let the player return to any run from a Saved games screen. Autosave continues to update the run being played. Starting another game or importing a file creates another save, so experimenting with a new strategy no longer costs the player their existing game.

The implementation includes automatic creation, resume, rename, delete, per-save import and export, and retention of completed runs. Keep saves on the current device and browser, with no account requirement. Cloud synchronization, folders, bulk operations, and manual checkpoints are outside this change.

## Current behavior and constraints

The single-save assumption appears in several connected paths:

| Area                   | Current behavior                                                                                             | Required change                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Persistence            | `SaveGame.tsx` stores one `SaveGameType` under `localStorage.savedGame` and caches the parsed payload.       | Store independent records addressed by save ID; read lightweight metadata for the library.   |
| Autosave               | Writes at the first playable state and each game-year boundary; flushes on quit, tab hiding, and `pagehide`. | Bind every write to the active save and await saves before deliberate transitions.           |
| Main menu              | `Continue` resolves the single resumable save.                                                               | Derive Continue from resumable save metadata and expose the library.                         |
| Starting and importing | `StartGame.tsx` asks permission to replace the existing save; Settings imports directly into gameplay.       | Create another record; remove replacement confirmations.                                     |
| Game ending            | Three paths in `Game.tsx` call `clearSaveFor(scenarioId)`.                                                   | Record the exact active save's outcome; preserve post-completion play and terminal failures. |
| Tests                  | Many Playwright specs read or edit `localStorage.savedGame` directly.                                        | Replace the old fixtures with shared helpers for the selected record.                        |

These observations come from [SaveGame](../src/SaveGame.tsx), [SaveFile](../src/SaveFile.tsx), [StartGame](../src/components/views/StartGame.tsx), [SettingsContainer](../src/components/views/SettingsContainer.tsx), [MainMenuContainer](../src/components/views/MainMenuContainer.tsx), and the [game reducer](../src/reducers/Game.tsx).

Preserve the existing serialization and validation. A save contains the game slice and explicit commitment-forecast metadata; JSON alone would omit metadata attached to timeline ticks. Resume restores that metadata, pauses the game, and passes through Loading to reload simulation data. Tutorials and replay playback currently do not autosave and should remain outside the library.

## Player experience

### Main menu and access during play

Keep **Continue** as the dominant action when a resumable save exists. Add its name and scenario/date below the button so the player knows what will open. Offer **Saved games** as a quieter secondary action, followed by **Start a new game**. Without a resumable save, **Start playing** remains dominant. Keep Saved games available when the library is empty so import remains discoverable.

Derive Continue from the resumable record with the newest `lastPlayedAt`, using save ID as a deterministic tie-breaker. Set that timestamp only after a new run is initialized or Resume successfully completes Loading. Rename, export, import, and background autosave do not change it. Imports have no `lastPlayedAt`; if no resumable run has ever been played, Continue may offer the newest imported save by creation time. Deleting a record or making it terminal naturally removes it from consideration; there is no stored Continue pointer to repair. If a load fails, show the reason and open the library instead of silently opening another run.

Add Saved games to the existing game-bar overflow menu. Opening it pauses the simulation through the established blocking-card mechanism. Back returns to the existing run and restores its prior speed according to the current navigation behavior. Choosing another run saves the outgoing one before replacing live state.

In Settings, replace the single Saved game export/import row with **Saved games** and a **Manage saves** action. Keep appearance, sound, units, and account settings separate from save management.

### Saved games screen

Use one centered list on desktop and one full-width pane on phones. Avoid a dense file-management table or a second detail pane. Each entry contains:

- The player-chosen name as the strongest text.
- Scenario, location, difficulty, and in-game month/year as supporting text, using existing labels and formatters.
- Last saved time, with the full timestamp available to assistive technology and in a tooltip.
- A textual state: In progress, Completed, Bankrupt, or Fired. Mark the currently open run separately.
- A primary Resume action for in-progress and completed saves, or View result for terminal failures. The currently open entry uses Return to game.
- A labeled overflow menu containing Rename, Export, and Delete, plus View result when a result exists on a resumable completed save.

Sort by most recently played, using creation time for runs never opened. Autosaving and renaming should not reorder the list under the player's pointer. Include name/scenario search; additional filtering and alternative sorting are outside this change.

The following is a schematic layout with illustrative names and dates:

```text
Saved games                                      Back
Saved on this device and browser

Search saves...                         Import save

Renewables experiment                            ...
Rise of Renewables · Ontario · Normal
June 2035 · In progress · Saved 2 minutes ago
                                              Resume

Low carbon utility                               ...
Custom game · British Columbia · Hard
December 2040 · Completed · Saved yesterday
                                              Resume
```

On a phone, stack the search field and Import save action, then place each entry's main action below its text. Allow long names to wrap; do not compress supporting labels into unreadable text. Keep overflow controls at the upper right of each entry and avoid nested click targets: clicking an entry must not accidentally resume it while the player opens its menu.

### Creation and naming

A new game creates a save automatically at its first fully initialized playable state. Do not interrupt scenario selection with a required naming dialog. Use a suggested name such as `Rise of Renewables — Ontario`, adding a numeric suffix to generated names already in use. Offer Rename from the library and from the active run's overflow menu.

Track launch intent explicitly: new run, resume, tutorial, or replay. Allocate a new slot once per new-run launch token; retries and duplicate Loading callbacks must not create additional entries. Resume binds to the selected existing ID, including a save just created by import.

Names are plain text, trimmed, nonempty, and limited to 60 Unicode code points. Reject line breaks and control characters. Use one shared name-normalization and validation function for generated names, rename, import, and export. Allow duplicate player-entered names: identity comes from the save ID, and scenario/date help distinguish entries. Renaming never changes the scenario's authored name, seed, run identity, or replay.

The rename dialog has a labeled Name field, a character count, inline validation, Cancel, and Save name. Select the existing text on entry. Commit on Save name or Enter; Escape cancels. Keep the old name visible until persistence succeeds.

If initial persistence fails, show **This game has not been saved** with Retry and Export current game. Do not label the run saved or silently reuse an older slot. The player may keep playing with a persistent unsaved-state notice; the coordinator retains the pending ID, name, and latest run snapshot and retries creating that same slot. Show this unsaved current run explicitly in the manager, with Return to game and recovery actions, rather than hiding it behind an empty-library state.

### Resume and switching

When a player selects Resume, disable repeated activation and show Loading on that entry. Prepare the target through an atomic read-and-acquire operation: read its metadata, payload, and revision and acquire writer ownership in the same transaction. Validate that returned candidate and resolve its scenario outside the transaction, releasing ownership on failure. This prevents a write in another tab between a separate read and acquisition from producing a stale resume. Continue through Loading and start paused, as today.

Route all replacements of live gameplay through one transition coordinator: starting a scenario, challenge or replay, resuming another save, retrying a run, and returning to the main menu. Prepare the target without replacing live Redux state, pause the outgoing run, and wait for its outstanding write and latest snapshot to commit. Only then release the outgoing ownership and begin the requested load. Recheck the transition generation before committing delayed Loading callbacks; an abandoned or older request cannot bind or initialize a different run.

Serialize accepted handoffs through lease release. Fence gameplay and navigation mutations before capturing the final source snapshot, then suspend its writer before releasing ownership. Keep the fence until the accepted handoff finishes; show a non-dismissible saving dialog if it takes more than 200 ms. Recheck the accepted intent after every awaited handoff operation so an older switch cannot replace a newer one. Preparing an invalid target must not cancel an already accepted handoff. On persistence failure, restore the source writer and input before offering recovery.

A failed outgoing save leaves the existing run intact with Retry, Export current game, and Cancel switch. Also offer a quieter **Leave without saving** action with a separate confirmation. For a never-saved run, explain that the entire browser copy will be lost; otherwise explain that changes since the last successful save will be lost. Cancel receives initial focus. Starting an export does not count as permission to discard the live run. Explicit abandonment cancels pending snapshots and releases ownership before proceeding. Keep this escape available when browser storage stays unavailable.

Validation failure releases the prepared target and returns to the outgoing run. If target data Loading fails after the outgoing run was saved, release the target ownership and return to Saved games with Retry and the preserved outgoing entry available to resume. Do not update the target's `lastPlayedAt` until Loading succeeds. A failure must not leave the UI attached to a half-loaded game or holding an invisible writer lease.

Renew a prepared target's lease throughout Loading. Before committing the loaded run and `markOpened`, check both the transition generation and its ownership token/revision; the latter check belongs in the transaction that marks it opened and renews its lease. If another tab acquired the save or advanced its revision during a slow load, abandon the old candidate and reopen the latest payload. Same-tab generation checks alone cannot protect this case.

Return to game closes the manager and uses the current live run; it never reloads an older snapshot. The manager still preserves any pending unsaved snapshot when returning.

### Deletion and ended runs

Use a confirmation dialog: **Delete “Renewables experiment”?** Explain that deletion removes this browser's copy and that exported files remain usable. Offer Cancel and Delete save, with Cancel receiving initial focus. Remove the entry only after the delete transaction succeeds. Use confirmed permanent deletion; an undo system is outside this change.

Deleting the active run uses distinct wording: **Delete and leave this game?** After confirmation, suspend new autosaves, settle any in-flight operation, invalidate queued snapshots, and delete the exact record. Leave gameplay for the library only after success. If deletion fails, retain the live snapshot, restore a usable writer session and retry state, and remain paused with Cancel/Return to game available. For a never-saved pending run, use **Discard and leave this game?** and abandon its pending creation through the same coordinator. Never allow a delayed creation or queued save to recreate a deleted or discarded entry.

Preserve the existing **Keep playing** behavior after a successful term. Completed saves remain resumable and writable; their captured result remains available in secondary actions while later autosaves retain the completed status and result. If continued play later ends in bankruptcy or firing, replace that result with the final failure and make the save terminal. Bankrupt and fired saves offer View result as their primary action and cannot resume. Export and Delete remain available for all records.

Saved-result viewing loads the result on demand and uses a presentation-only dialog with Close/Back. Reuse score/debrief presentation, but not `VictoryDialogContainer`'s live Quit/Retry callbacks or `victoryOpen`/`victoryClose` actions that change game speed. Opening an older result must leave the current run, writer session, and navigation history intact and must not rerun the simulation or submit another score. Keeping these results replaces today's automatic save removal without removing post-completion play.

### Visual and accessibility details

Follow the existing theme tokens and 4 px spacing rhythm, with 8/12/16 px gaps and padding. Use restrained neutral surfaces and dividers. Electric blue identifies Resume and other primary actions; reserve red for deletion, failures, and harmful outcomes. Pair every state color with text.

Use existing scenario icons at their normal 40–48 px size, beside visible scenario labels. Controls must be at least 40 px tall on desktop and 44 px on coarse-pointer devices. Verify light and dark contrast separately, 390 px and 320 px layouts, and enlarged text.

Use semantic headings and lists, accessible overflow labels such as `Actions for Renewables experiment`, and keyboard-operable dialogs. Return focus to the invoking control after cancel/rename, or to the next entry after deletion. Announce save errors and successful mutations in a polite live region. Avoid announcements or toasts for every periodic autosave.

The empty state says **No saved games yet**, with Start playing dominant and Import save secondary. Distinguish an empty library from loading, unavailable storage, an unreadable record, or a search with no matches. A corrupt record should not hide the healthy ones; show it as unavailable with Delete and an option to download its raw data for recovery.

## Storage architecture

Use IndexedDB for save payloads and library metadata, while keeping ordinary settings in localStorage. IndexedDB provides asynchronous operations and transactions across object stores. Our design uses those transactions to commit payload and metadata together. [IndexedDB documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).

| Option                                    | Benefit                                          | Cost                                                                                                              | Recommendation                                           |
| ----------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| One localStorage key containing all saves | Small initial change.                            | Every save rewrites the collection; one malformed blob affects everything.                                        | Reject.                                                  |
| Separate localStorage keys plus an index  | Reuses the current synchronous path.             | Payload/index changes need recovery logic; writes remain synchronous and compete with settings for limited space. | Reasonable only for a deliberately small capped library. |
| IndexedDB                                 | Independent records and transactional mutations. | Requires an async repository and deliberate handling of page shutdown.                                            | Use for the proposed library.                            |

LocalStorage generally has a 5 MiB budget per origin. IndexedDB quotas vary by browser and share the origin's managed storage budget with other storage such as caches. Therefore, promise multiple saves without a product-imposed count limit, rather than unlimited storage. Handle quota and unavailable-storage errors explicitly. Browser-local data can be cleared or evicted, so retain per-save export and label the storage scope clearly. [Browser storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Create a small repository around the native IndexedDB API; avoid an application-wide persistence framework. Use three stores: `saves` for lightweight metadata, `payloads` keyed by save ID, and `sessions` for writer ownership. Continue is derived from metadata, so it needs no store or separately persisted identity.

### Record identity and types

Define save-domain types in `Types.tsx`, reusing existing location, difficulty, and victory/debrief types. The following is an outline, not a final interface:

```ts
type SaveId = string;
type SaveStatus = "inProgress" | "completed" | "bankrupt" | "fired";

interface SaveMetadata {
  id: SaveId;
  name: string;
  createdAt: string;
  lastPlayedAt?: string; // Unset for an import that has never been opened
  savedAt: string;
  revision: number;
  status: SaveStatus;
  // Scenario, location, difficulty, and game date summaries
  // No full result or debrief: metadata stays small
}

interface SavePayloadRecord {
  id: SaveId;
  save: SaveGameType;
  result?: SavedRunResult; // Validated serializable score/debrief data
}

interface SaveFileType {
  name: string;
  status: SaveStatus;
  save: SaveGameType;
  result?: SavedRunResult;
}
```

Generate opaque IDs outside the simulation. Never key records by scenario ID, seed, or `RunIdentity`: two attempts can share all three, and custom games already share a scenario ID. Save IDs, names, timestamps, and writer tokens belong to persistence/session state, not deterministic gameplay or recorded replay actions.

Derive summary fields from a validated payload at creation, import, and autosave, committing them atomically with the payload. Read only metadata to render the library; load full game/result data only for Resume, View result, or Export. Validate payloads on use and mark individual invalid entries unavailable without hiding healthy ones. Normal writes cannot produce stale summaries, so add no full-payload startup scan or general reconciliation subsystem.

Define one shared status policy for UI, repository guards, and import validation: `inProgress` and `completed` can resume and save; `bankrupt` and `fired` are terminal. A completed or terminal record must have a matching validated result in its payload. Keep `SavedRunResult` to the serializable score/debrief fields needed for presentation, excluding live callbacks, account-specific rank state, and score-submission authority. Do not copy the full result into metadata.

Retain `serializeSave` and `parseSave` as the payload boundary. Store their explicit forecast metadata and restore it on reads; do not persist the live Redux object directly and assume object cloning preserves everything.

### Repository and Redux responsibilities

Expose typed async operations: `initialize`, `list`, `create`, `read`, `readRaw`, `prepareResume`, `markOpened`, `renew`, `rename`, `writeSnapshot`, `recordOutcome`, `delete`, and `release`. `prepareResume` atomically acquires ownership and returns one consistent metadata/payload/revision candidate; `markOpened` sets `lastPlayedAt` only after successful Loading. Read-only result/export reads do not acquire gameplay ownership. `readRaw` returns the stored metadata and payload together without validation for a clearly labeled recovery download; it never authorizes gameplay. Return specific errors such as quota, unavailable, invalid, missing, or writer conflict. Resolve writes on transaction completion, not an individual request's success. Prepare data before opening a write transaction; avoid unrelated asynchronous work inside it and validate resume candidates after acquisition.

Add a small `saves` Redux slice containing summaries, load/error state, and mutation state. Keep full inactive game payloads out of Redux. Keep the active save ID and writer generation in a session coordinator outside the game slice. Use typed hooks for the new Saved games view.

The repository must not import the Store, game reducer, or scenario catalogue. Scenario resolution stays in the application layer, like the existing SaveFile separation. Keep cross-slice actions in `GameActions.tsx`, with dependencies injected into the coordinator. Preserve the `StoreRegistry` boundary and its import-order test.

### Autosave and lifecycle ordering

Replace scenario-based targeting with an explicit session binding `{ saveId, writerToken, generation }`. Capture that binding with each snapshot; never choose the destination from the active ID when an async write finally completes.

Serialize operations per active session, with one write in progress and one latest pending snapshot. Coalesce ordinary tick snapshots, but await an explicit final snapshot before leaving a run. Compare snapshot references so builds, rates, policies, and other changes made while paused are saved even when game time does not move. Autosave updates an existing resumable record; only the pending creation of an explicitly started/imported run may add one.

Rename updates metadata without rewriting the game payload. Snapshot writes merge the current metadata in their transaction, so a queued autosave cannot restore an old name. Serialize same-tab metadata changes with snapshot writes and propagate the resulting revision to the session.

Keep the initial and game-year checkpoints. Add a proposed 15-second wall-clock checkpoint while dirty, a save on pausing, and a short debounce after player decisions made while paused. Measure serialization cost before settling the debounce interval. Update Saved/Saving/Save failed state only from actual write results, and retain the last successful timestamp on failure.

Attempt a final checkpoint on `visibilitychange` to hidden and `pagehide`, but do not rely on it: IndexedDB transactions may be aborted at browser shutdown. Periodic checkpoints and awaited in-app transitions are the protection. This means a sudden process termination can lose changes since the last successful checkpoint; the interface must not claim otherwise. [IndexedDB shutdown behavior](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB#warning_about_browser_shutdown), [visibility change guidance](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event).

Retain pending snapshots for retry without recreating missing records. Show one actionable failure notice, backed by persistent Save failed state and Retry/Export actions. Distinguish full storage from denied/unavailable storage. Clear failure state after a successful commit. Do not silently fall back to the old single-save writer.

### Completion and multiple tabs

Replace `clearSaveFor(scenarioId)` with an explicit outcome notification. Capture the exact save/session binding when the outcome is computed, before delayed dialog work, then commit the snapshot, status, and result together. Successful completion retains its writable session for Keep playing; bankruptcy/firing stops ordinary snapshots and releases ownership after the terminal record commits. Later snapshots preserve an existing completed result and never turn a terminal record back into a resumable one. Tutorials and replays have no writable binding, so their end paths affect no save.

Carry the binding through a transient runtime-effect context captured before the tick is reduced, and pass it into the outcome callback. Keep it out of `GameType` and replay data. The existing headless `tickState` path supplies no save binding. Build the retained result from the serializable presentation fields of existing `VictoryType` and `VictoryDebriefType`, and dispatch the outcome action outside reduction; never read whichever save happens to be active when a delayed callback runs.

If a run reaches an outcome before its first successful save, its pending creation takes the latest snapshot, status, and result. Retry one atomic creation of that same ID, including a terminal outcome when applicable; do not insert an earlier in-progress snapshot or allocate a second ID. Export current game also carries that outcome. A failed terminal save keeps its final snapshot/result available for Retry, Export, or explicitly confirmed abandonment.

Allow different tabs to play different saves. For the same save, allow one writer at a time. Acquire/renew a bounded session lease transactionally, and fence every mutation with its ownership token and expected record revision. Lease timing uses wall-clock time outside the simulation. Renew during target preparation/Loading, while an owned run is paused or its manager is open, and while a final outcome is waiting to commit. Lease renewal changes ownership state only, not the save-content revision.

Release ownership on successful leave, target validation/load failure, successful terminal-outcome persistence, coordinator teardown, and deletion. Explicit abandonment also releases it when persistence cannot succeed. Page shutdown may prevent release, so expiry remains the recovery path. After suspension or expiry, reacquisition must also compare the stored revision with the revision last owned by the tab. If another writer advanced it, preserve the old tab's snapshot for export and require reopening the latest save; never overwrite newer progress just because the old tab obtained a new token.

For immediate same-tab reload handoff, remember the bound ID and writer token in session storage and hold a native Web Lock scoped to that token. A copied popup session cannot reuse the original document's live token. A fresh token can still acquire an expired IndexedDB lease, so an abandoned document's lock does not prevent crash recovery. Where Web Locks are unavailable, use a fresh token and the lease expiry path. IndexedDB token/revision checks remain authoritative. Teardown releases token locks in final cleanup even if the database release fails, invalidates delayed callbacks, and clears prepared references. Export binds the requested session before awaiting persistence.

If a live lease belongs to another tab, say **This game is open in another tab** and offer Cancel. Reclaim expired leases after crashes. Validate ownership again on every write so a sleeping tab cannot overwrite a newer game. Rename/delete operations must also respect another tab's live session. Broadcast committed changes to refresh open libraries, and refresh on focus as a fallback; the transaction checks, rather than notifications, enforce correctness.

Deletion removes metadata, payload, and ownership in one transaction. Continue automatically derives its next eligible target. Writes to missing records fail instead of inserting them. Invalidate queued writer work before deleting an active save, but restore a valid session and retry state if the transaction fails. Pending-create abandonment must settle any in-flight creation before deleting a record it may have committed.

Keep the existing cache-reset action scoped to application caches. It must not delete the save database or library metadata. Account sign-out also leaves this browser's save library intact.

## Storage cutover and file exchange

Replace the single-save reader, writer, cache, and replacement guards outright. The new library starts empty and never reads or converts `localStorage.savedGame`. Leave that obsolete key unused; add no cleanup routine, migration receipt, compatibility adapter, or dual writer. Development sessions using the old build must reload before testing this change.

Use a fresh IndexedDB database with the new object stores. Its structural version is an implementation detail, not a game-schema compatibility system. Support only the current save format, keep `appVersion` diagnostic, and preserve the existing challenge/run compatibility checks.

Import validates the payload, status/result relationship, and name, allocates a fresh local ID, and creates another entry with no `lastPlayedAt`. It never adopts an exported device ID or overwrites a matching scenario/name. Land in the library with **Imported “Name”** and the appropriate Resume or View result action; importing during play does not replace the live run or change Continue's played target. Reject tutorial/replay payloads as non-playable library entries. Preserve the existing 8 MiB file limit.

Use `SaveFileType` as the single current file envelope: required plain-text `name`, `status`, the existing serialized payload under `save`, and a validated `result` when completed or terminal. The nested `SaveGameType` keeps its existing `savedAt`, `appVersion`, `game`, and commitment-forecast fields. Files contain no local save ID, lease, revision, or played-order timestamps. Reject unsupported old envelopes with **This file uses an unsupported save format.** Do not add a legacy importer or game-schema conversions.

Exporting the active run first saves the latest snapshot; if persistence fails, Export current game serializes the live snapshot directly. Filenames use a sanitized player name and game date. Rename changes future filenames, and imported files always receive a new local ID. Never trust imported result metadata to authorize score submission.

## Implementation scope

Implement storage, session coordination, navigation, UI, and tests together in one reviewable change. There are no intermediate releases, feature flags, staged cutovers, or migration work. The change is complete only when the whole library and all acceptance criteria below work.

| Area         | Required work                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Persistence  | New repository, save types, metadata derivation, current-format import/export, and transaction/error handling.                  |
| Lifecycle    | Session coordination, awaited transitions, autosave ownership, and completion handling.                                         |
| Interface    | Saved games view, menu entries, rename/delete/result dialogs, and accessible responsive layouts.                                |
| Verification | Replace old storage fixtures, cover failure and concurrency cases, run regression gates, and inspect desktop/phone screenshots. |

Likely touch points are `SaveGame.tsx`, `SaveFile.tsx`, `Types.tsx`, `Store.tsx`, `App.tsx`, and small changes in `GameActions.tsx`, `Game.tsx`, `Card.tsx`, and `Compositor.tsx`. Add focused save-repository/session modules, a saves slice, and a Saved games view. Update MainMenu, Settings, GameAppBar, VictoryDialog/its container, and all `startWithSaveGuard` callers: authored scenarios, custom games, data-center setup, and challenges. Route run retry and other live-game replacements through the same transition coordinator. Add `SAVED_GAMES` to `CardNameType` and the blocking-card set.

Most work is persistence and lifecycle coordination. Reuse existing MUI dialogs, typography, scenario icons, and theme tokens, and keep edits to the large simulation and stylesheet files narrow. The generated compatibility manifest will change as covered inputs change; regenerate it through normal hooks and never commit it. This feature should not change economic formulas or require performance/golden-output rebaselining.

## Verification and acceptance

Extend the existing save/serialization tests rather than replacing them. Test the repository/coordinator with controlled transaction outcomes; use real-browser tests for IndexedDB, page lifecycle, and cross-tab behavior.

- Create A and B with the same scenario and seed. Resume each, make different decisions, and verify their progress stays independent after reload.
- Rename A, including Unicode and duplicate-name cases. Verify the name survives reload/export/import without changing gameplay or the scenario label.
- Delete B, then flush a previously queued B write. Verify B stays deleted and A remains resumable. Repeat for the active save, pending creation, and deletion failure; a failed delete must restore a usable session.
- Switch after a paused build or rate change. Verify that change survives. Inject an outgoing save failure and verify the live run is retained. Test confirmed Leave without saving, cancellation, and the different warnings for never-saved runs and unsaved changes.
- Fail target validation or Loading, and activate overlapping transitions. Verify ownership is released, only the current request can commit, and the outgoing save remains recoverable. Extend Loading past lease expiry and let another tab update the target; the old candidate must not commit. `lastPlayedAt` changes only on successful opening.
- Complete a term and Keep playing, then reload/resume. Verify the result is retained, later snapshots stay resumable, and a later bankruptcy/firing becomes terminal. View an older result while a different run is active and verify its gameplay, speed, session, and history are untouched and no score is submitted.
- Fail the first save, then complete or fail the run. Recover storage and retry; verify one record with the original ID and latest outcome/result is created. Export must preserve that outcome too.
- Run tutorials and replays while other saves exist; verify they create no slot and change no unrelated record.
- Verify the obsolete `savedGame` key is ignored and no legacy paths remain. Old test fixtures must not influence Continue or autosave.
- Import current-format exports and reject unsupported old files. Verify fresh local IDs, validation, file-size limits, and recovery/export of unavailable entries.
- Open the same save in two tabs, including another-tab commit immediately before Resume acquisition; verify the acquired payload/revision are consistent. Suspend a tab, expire its lease, and resume it after the other writes; reacquisition must not overwrite newer progress. Verify release, paused renewal, and independence of different saves.
- Copy a tab's session storage into a popup and reload it; verify it cannot borrow the live writer token. Verify ordinary reload and same-tab navigation can resume immediately, and cleanup/remount can recover after database release fails.
- Delay source or prepared-target lease release while accepting overlapping switches. Only the newest accepted switch may proceed, gameplay cannot change during the final handoff, and a concurrent export still contains the originally requested run.
- Seed 100 metadata entries and representative long-run payloads. Verify opening/searching the library reads summaries only and writes do not serialize the whole collection. Measure checkpoint serialization on a long run.
- Verify empty/loading/error states, the explicit unsaved-current-run entry, derived Continue with timestamp ties and never-opened imports, focus restoration, overflow menus, keyboard operation, and 320/390 px layouts in light and dark modes.

Introduce shared Playwright save helpers so existing chart, challenge, data-center, motion, mission, and victory specs address a selected record instead of the obsolete key. Run focused save/component tests during development, then `npm run check`. Build and run relevant Playwright flows on desktop and phone, including the existing tutorial-exit and build-options gates. For a UI implementation PR, capture and review desktop/phone screenshots and attach them through GitHub CLI as required by `AGENTS.md`.

The release is ready when a player can create, identify, resume, rename, export, import, and delete multiple runs without changing another run's progress, and every persistence failure leaves an accurate status and a recovery action.

## Product decisions in this proposal

Implement automatic slot creation with optional rename, device/browser storage without login, no fixed save-count cap, retention of ended runs, import into the library before resume, and confirmed permanent deletion. Ship the complete behavior in one change, supporting only the new current save format. Cloud saves, Save a copy/manual checkpoints, trash/undo, and bulk management are outside this implementation.
