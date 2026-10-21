# Co-op setup: any scenario, chosen together

Design for replacing the fixed five-year co-op sandbox in PR #543 with "the host picks any
scenario or custom game in the normal selection screens, and everyone follows." The scope is
flow and technical design only; no code has changed. Citations are to the PR #543 worktree.

## TL;DR

- **Flow:** **Host a game** goes straight to the real `NEW_GAME` / `NEW_GAME_DETAILS` /
  `CUSTOM_GAME` cards, with **Invite friends** and **Copy invite code** in the follow bar;
  friends join with the code and land on the host's card. (The Gathering dialog and **Choose a
  game together** below were the original design; guests now see the dialog only while
  joining or picking companies for a multiplayer save.) The host drives; guests follow
  read-only with a "Following Alice" bar and one action, **Ready**. Host presses **Start for
  everyone**, then Loading, the shared game, a co-op result, and **Back to lobby**.
- **Mirroring:** one host-only `browse` wire message carries the complete selection state
  (card, scenario, difficulty, custom draft, filter/sort). It is under 16 KB, coalesced to 5/s,
  and deduplicated by session and revision. Guests feed it into the existing UI Redux fields, so
  the real views render it through one optional `coop` prop. No views are forked.
- **Scenario rule:** every company gets the scenario's own location, fleet, cash, customers,
  difficulty, seed and story. The only change is that NPC interties are replaced by tier 1 links
  to each other player. Each company answers its own scenario choices. The match is unranked,
  ends at the scenario's term. A company that fails retires while the others play on.
- **Eligible:** authored non-tutorial scenarios and custom games. **Not eligible:** tutorials,
  challenge links, replays and the Data Center setup landing.
- **Delivery:** built inside PR #543, in phases:
  simulation and protocol first, then UI.
- **Riskiest parts:** turning on end-of-scenario triggers inside the worker, the scenario-choice
  early return, restore validation for arbitrary scenarios, view size in long scenarios, and
  balance without NPC imports.

---

## 1. Player flow and states

```
 [Main menu] --Play with friends--> [Gathering]  (Lobby dialog: host / join / invite)
                                        |   \--Resume shared save (host)--------------+
                     host: Choose a game together (>=2 connected)                     |
                                        v                                             |
              +---------------> [Browsing: NEW_GAME list] <---> [CUSTOM_GAME]          |
              |                         |  ^                         |                |
              |                         v  | Back                    |                |
              |                 [NEW_GAME_DETAILS] ------------------+                |
              |                         |  host: Start for everyone                    |
              |                         v                                             |
              |                    [Starting] --worker error--> Browsing + alert      |
              |                         v                                             |
              |                    [Loading]  <---------------------------------------+
              |                         v
              |                    [Playing]  (pauses: ready gate, disconnects, choices)
              |                         v  term reached or a company fails
              +--Back to lobby---- [Ended: co-op result] --Main menu--> leaves lobby
```

`phase` is host state, published to guests (§2) and mirrored into Steam lobby data so that
non-roster joiners can see when a match is already in progress.

### Screens and the dominant action

| State             | Host sees / dominant action                                                                                                                                                                                                                           | Guest sees / dominant action                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Gathering         | Lobby dialog: code, Invite, roster with connection state. **Choose a game together** (disabled with "Waiting for a friend…" until ≥2 are connected). Secondary: Resume shared save, which shows the scenario, date and roster from `read-checkpoint`. | Roster, then "Alice will choose a game". Only action: Leave lobby.                                                            |
| Browsing: list    | The real catalog with tutorials, "For you" and play-count sorts hidden. The dominant action is unchanged: pick a row. Back returns to Gathering.                                                                                                      | The same list read-only under the follow bar. Scroll freely. No dominant action; the bar says what's happening.               |
| Browsing: details | Same dossier. Difficulty picker live. **Start for everyone · 2 of 3 ready**. Leaderboard, replays and "Continue saved game" hidden.                                                                                                                   | The same dossier and difficulty, read-only. **Ready** toggle replaces Start. Victory Conditions dialog still opens.           |
| Browsing: custom  | Same setup table, editable. **Start for everyone**.                                                                                                                                                                                                   | Same table read-only, with values updating live. **Ready**. The setup forecast runs locally from the mirrored draft and seed. |
| Starting/Loading  | Loading card: "Starting Deep Freeze for 3 players…"                                                                                                                                                                                                   | Same. After 30 s with no first view: "Alice's game didn't start", with Leave.                                                 |
| Playing           | Existing co-op game view, unchanged.                                                                                                                                                                                                                  | Unchanged.                                                                                                                    |
| Ended             | Co-op result (§3). **Back to lobby**. Secondary: Main menu.                                                                                                                                                                                           | Same result. Status: "Waiting for Alice". Secondary: Leave.                                                                   |

**How guests know they are following:** a persistent bar sits first in each co-op card's scroll
area. It reads "Following Alice · Deep Freeze · Manager" and shows roster chips with text
states (Ready / Reviewing / Reconnecting). Every interactive control the guest cannot use is
read-only with `aria-describedby` pointing at the bar, so a screen reader hears "Alice chooses
the game." Guests **may** scroll, open read-only info dialogs, toggle Ready and leave. They
**may not** change filter, sort, scenario, difficulty or custom fields, start, or navigate.
On the guest, Back becomes Leave lobby, with a confirmation.

**How the host knows who's ready:** roster chips in the host's bar, plus the Start label count.
Ready is a soft signal and clears itself when the host changes the scenario, difficulty or
custom settings (§2). Start is enabled when everyone is connected. If someone isn't ready,
Start asks "Bob is still reviewing. Start anyway?" A missing click can't deadlock the room,
because the world's own ready gate still holds the clock until everyone selects a running
speed (`World.ts:266-269`, `markReady` at `World.ts:69-77`).

### Joins, leaves and recovery

| Event                                 | Behavior                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Friend joins while Browsing           | They get the current browse state immediately (same trigger as the reconnect baseline at `Session.ts:118-121`) and land on the host's page. The host sees "Dana joined". Start becomes "0 of 3 ready". |
| Guest leaves while Browsing           | Their chip disappears. With only the host left, Start is disabled with the text "Invite a friend".                                                                                                     |
| Guest connection drops while Browsing | Their chip shows "Reconnecting" and Start is disabled. On reconnect, the host resends the full state.                                                                                                  |
| Host leaves while Browsing            | The existing native failure path runs (`steam-multiplayer.cjs:486-490`). Guests see "Alice closed the lobby" and return to the main menu.                                                              |
| Non-roster friend joins while Playing | The native host already rejects the connection (`steam-multiplayer.cjs:404-418`). The Lobby shows "Match in progress, join the next one", read from lobby data `phase=playing`.                        |
| Roster player drops while Playing     | Existing behavior: pause, wait, reconnect (`Multiplayer.worker.ts:185-191`).                                                                                                                           |
| Resume a saved co-op match            | Gathering → Resume. This requires exactly the saved roster (`Session.ts:413-424`) and skips Browsing. Guests see "Alice is resuming Deep Freeze (Jun 2031)".                                           |

### Narrow widths and accessibility

- **≥600 px:** the bar is one row. **390 px:** two rows. Chips become initials plus a text state,
  "2/3 ready" stays visible, and Start/Ready becomes a full-width sticky button at the bottom.
  **360 px:** the roster collapses to a "3 players · 2 ready" button that opens a list, and
  Invite moves into the header overflow. Targets are 40 px (44 px on coarse pointers), with
  4/8/12/16 spacing.
- Ready is never shown by color alone: it is always a word plus a check icon. Blue stays the
  interaction color, and the bar uses neutral surfaces.
- A polite live region announces only page, scenario and difficulty changes, debounced by 1 s
  ("Alice opened Deep Freeze"). Filter changes are not announced. Focus is never stolen. If the
  focused node unmounts because the host navigated, focus moves to the new page's `h1`
  (`tabIndex=-1`).
- Read-only inputs use `readOnly`/`aria-readonly` rather than `disabled`, so guests can Tab
  to them and read values. The Ready control is a toggle button with `aria-pressed`.

---

## 2. Following the host

### What is mirrored

| Mirrored                                                             | Not mirrored (and why)                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card (`NEW_GAME` / `NEW_GAME_DETAILS` / `CUSTOM_GAME`)               | Scroll position: viewports differ, and 360 px vs desktop positions are meaningless.                                                                      |
| Previewed scenario id (`ui.scenarioPreview`)                         | Hover/focus: too chatty, and it adds nothing to the decision.                                                                                            |
| Difficulty (`ui.previewDifficulty`)                                  | Info dialogs, tooltips, leaderboard: per-viewer reading.                                                                                                 |
| List filter and sort (lifted from `NewGame.tsx:221-227` local state) | "For you" and play-count sorts: they read each player's own `getScenarioPlayCounts()` (`NewGame.tsx:228`) and would differ, so they are hidden in co-op. |
| Custom draft scenario and preview seed (`CustomGame.tsx:241-248`)    | Data Center setup: not eligible.                                                                                                                         |

### Wire message

Add one variant to `WireMessage` (`src/multiplayer/Native.ts:14-20`):

```ts
{
  kind: "browse";
  browse: BrowseState;
}

interface BrowseState {
  session: string; // random per lobby session, ≤64 chars (like epoch)
  revision: number; // safe integer, +1 per change
  phase: "browsing" | "starting" | "playing" | "ended";
  card: "NEW_GAME" | "NEW_GAME_DETAILS" | "CUSTOM_GAME";
  filter?: string;
  sort?: string; // unknown values fall back; never reject
  scenarioId?: number; // authored, non-tutorial
  difficulty: DifficultyType;
  custom?: ScenarioType; // CUSTOM_GAME draft
  previewSeed?: number;
  selectionKey: string; // hash of (scenarioId | custom draft, difficulty)
  matchId?: string; // set when phase = "starting"
}
```

Rules, consistent with the existing protocol:

- **Authenticated host only.** The guest path already accepts only messages from `hostId`
  (`steam-multiplayer.cjs:572-573`). The host already rejects guest message kinds other than
  `command` and `save-request` (`:574-579`), so a guest cannot send `browse`.
- **Bounded.** The native layer rejects a `browse` larger than 16 KB of JSON, next to the
  command bound at `:585-600`. The session rejects custom drafts with more than 40 facilities.
- **Rate.** Changes are coalesced on a trailing edge at `VIEW_INTERVAL_MS` (200 ms, `Timing.ts:4`),
  so at most 5/s. The full state goes out immediately to a newly connected guest, and unchanged
  state is resent every 2 s. That resend is the guest's liveness signal under the existing
  `HOST_SILENCE_MS` (`Timing.ts:19`).
- **Deduplicated.** A guest keeps `(session, revision)`. It accepts a new `session`, or the same
  session with a higher revision, and drops anything else.
- **Validated.** `validBrowseState` lives in a new `src/multiplayer/Browse.ts`, so it is part of
  `multiplayerCompatibilityId` (`scripts/run-compatibility.js:70-88`). It checks the card
  allowlist and that `getScenario(id)` exists without `tutorialSteps`. For a custom draft it runs
  `isValidLocation` (`helpers/Locations.tsx:47`), `validCustomEventScenario` and finite, bounded
  numbers. If validation fails, the guest keeps the last valid state and shows "Out of sync,
  Reconnect".

**Ready** uses Steam lobby member data, not a new guest message. Generalize the native
`location` request (`steam-multiplayer.cjs:715-725`) to `{kind:"member", key:"ready", value}`
with a key allowlist. `members()` (`:285-307`) then returns `ready` instead of `locationId`.
The value is the `selectionKey` the guest agreed to. A guest counts as Ready only while that
value equals the current key, so any host change clears it without anyone sending a message.
Steam authenticates the value and delivers it to every member within the 1 s refresh
(`:605-608`).

### Rendering the real views read-only

1. `MultiplayerRoot` already lives for the whole app (`Root.tsx:18-147`). It stores the browse
   state in a new `ui.coop` field: `{ role, hostName, phase, roster, selectionKey }`.
2. **Guest:** on each accepted state it dispatches `navigate(card)` (replace, not push),
   `uiDelta({ scenarioPreview, previewDifficulty })` and `ui.coop.custom`. It reuses the fields
   that `NewGameDetailsContainer.tsx:59-68` and `CustomGameContainer.tsx:127-143` already read.
   Leaving co-op clears them so single-player state isn't polluted.
3. **Host:** a store subscription derives `BrowseState` from the same fields and passes it to
   `session.publishBrowse()`.
4. The three containers add a `coop` prop when `ui.coop` is set. Each component has one branch:
   - guest: inputs read-only, Start replaced by Ready, Back replaced by Leave;
   - host: Start says "Start for everyone" and calls the registered `coopStart(spec)` instead of
     `startWithSaveGuard` → `quit`/`start`.
   - NewGame filter and sort become optional controlled props.
   - CustomGame gains an optional `onScenarioChange`, called where it sets the draft
     (`CustomGame.tsx:417, 424`). In guest mode it syncs its draft from props.
   - `CoopBrowseBar` lives in `src/multiplayer/` and each card renders it first.

---

## 3. Eligible scenarios and how each is changed

| Kind                                                      | Eligible | Reason                                                                                                                                                                                     |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authored challenges (`SCENARIOS` without `tutorialSteps`) | **Yes**  | This is the request.                                                                                                                                                                       |
| Custom game                                               | **Yes**  | This is the request. It covers the old sandbox.                                                                                                                                            |
| Tutorials                                                 | No       | Guided single-player HUD and `tutorialIntertieStress` early returns (`Game.tsx:3350-3357`). `NewGame.tsx:232` already filters tutorials out of challenges; also hide the tutorial section. |
| Challenge links / ranked runs                             | No       | These are bound to `runIdentity` and leaderboards. Co-op clears `runIdentity` (`World.ts:185`).                                                                                            |
| Replays                                                   | No       | Watch-only and single-grid.                                                                                                                                                                |
| Data Center setup                                         | No       | A separate landing page with its own difficulty and guide (`DataCenterSetupContainer.tsx:30-41`). Custom games can still add data-center event arcs.                                       |

**"Modified only by the multiplayer intertie setup", exactly:**

| Aspect                                                                         | Rule                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location                                                                       | The scenario's own, the same for every company (`getScenarioLocation`, which handles non-built-in places like Delhi and Austin).                                                                                                                                                                                                    |
| Opening fleet, cash, customers, demand scale, rate, carbon fee, load additions | The scenario's own, identical per company, built through the same `initGame` call as `LoadingContainer.tsx:160-175`.                                                                                                                                                                                                                |
| Difficulty                                                                     | The host's choice, the same for all. This replaces the hard-coded `"Employee"` (`World.ts:165`).                                                                                                                                                                                                                                    |
| Seed                                                                           | `customScenario.seed` if set, else `storyHash(matchId)` (`World.ts:148`). It is shared, so weather, hazards and story arcs land identically for everyone.                                                                                                                                                                           |
| Story and world events                                                         | They already run per grid before the co-op early return (`Game.tsx:3464`), seeded by `state.seed`. Because the seed is shared, every company sees the same events at the same time.                                                                                                                                                 |
| Scenario choices                                                               | Per company. `chooseScenarioResponse` is already allowlisted (`Commands.ts:137`). The shared clock waits until every company has answered.                                                                                                                                                                                          |
| Interties                                                                      | All NPC corridors and `SCENARIO_INTERTIE_ACCESS` are removed. `corridorsForGame` already returns only peers in co-op (`IntertieAccess.ts:329-340`), and NPC lines don't operate (`Game.tsx:4692`). Every pair gets the existing tier 1 peer edge sized from 25% of opening peak (`World.ts:188-212`), so it scales to the scenario. |
| Duration and clock                                                             | The scenario's `durationMonths`, which replaces `MULTIPLAYER_DURATION_MONTHS` (`World.ts:62-63`, `:625`). Shared clock and speed rules are unchanged.                                                                                                                                                                               |
| Ranking                                                                        | Unranked. No score submission, `recordScenarioPlayed` or achievements.                                                                                                                                                                                                                                                              |

**Scenario end: a failed company retires; the others keep playing** (owner decision). At the month
rollover where a company goes bankrupt, is fired, or misses its objective (including a decided
early miss), only that company's run ends:

- Its grid **retires**: it stops ticking and its date freezes at that month. Its links switch off
  for both ends, and peers see the line as "Retired".
- Its speed selection, menu pauses, ready state and connection **no longer gate the shared clock**.
  A retired player who disconnects or leaves does not pause anyone.
- That player sees their own unranked result (outcome, reason, debrief). They can keep watching
  the match status from their frozen grid, or leave.
- Commands from a retired seat are refused, apart from leaving. A joint upgrade with a retired peer
  is refused: "Bob's company has retired."
- The match **ends** when the remaining companies reach the scenario's term (each sees "completed"),
  or when every company has retired. Everyone still connected then sees a company table with name,
  outcome, the month it ended, reliability, emissions and cash, plus **Back to lobby**.
- Resuming a saved match needs only the companies still playing. Retired seats are optional.

An ended save restores to that result only, because `markReady` refuses, as it already does at
`World.ts:71`.

---

## 4. Simulation and save changes

1. **Match spec.** Add `spec: { scenarioId; customScenario?; difficulty }` to `World`
   (`Types.ts:34-56`) and to the worker `create` request (`WorkerProtocol.ts:4`). `createWorld(spec,
seats, matchId, epoch)` does the following:
   - replaces `DEFAULT_CUSTOM_SCENARIO`/`MULTIPLAYER_PORTFOLIOS` (`World.ts:149-180`) with
     `start(id)`, then `delta({difficulty, customScenario})`, then `initGame` from the resolved
     scenario;
   - validates the spec: the scenario exists and has no tutorial, the custom draft passes the
     save-path checks, and the location is valid.

   Delete `MULTIPLAYER_PORTFOLIOS`, `_STARTING_*`, `_DEFAULT_LOCATION_ID` and `_DURATION_MONTHS`
   (`data/Multiplayer.ts:11-15, 54`).

2. **Locations beyond `LOCATIONS`.** Today co-op assumes the six built-ins (`Constants.tsx:87`)
   in several places:
   - `World.ts:145, 596, 627`
   - `Multiplayer.worker.ts:43, 47`
   - the native `DEFAULT_LOCATION_ID` and location member data (`steam-multiplayer.cjs:96,
298-304`)

   Authored scenarios use Delhi, Austin, Johannesburg and others, and custom games can use any
   indexed city. Derive one `LocationType` from the spec. Validate it with
   `isValidLocation`/`isValidLocationId`. Pass it to the worker's `data()` (`:39-61`), which
   already fetches `/data/weather/<id>.bin` plus the watershed. `Seat.locationId` is filled from
   the spec only for peer labels. The guest renderer already loads weather from
   `view.game.location` (`Root.tsx:53`).

3. **Pending-scenario-choice pause (risky).** `tickStatePhases` returns early without yielding
   (`Game.tsx:3361-3365`), so `stepWorld` throws (`World.ts:457-459`). Fix this at the world
   level:
   - Before calling `tickStatePhases`, `stepWorld` checks `pendingScenarioChoice(g)` on every
     grid.
   - If any choice is pending, it doesn't step. It sets `world.speed` to `PAUSED` with the reason
     "Waiting for Bob to choose a response" (a choice gate in `syncClock`, `World.ts:87-111`).
   - When the last answer arrives through the normal command, the selected speeds resume.

   The post-tick check (`Game.tsx:3812-3815`) only touches the grid's own speed, which the world
   ignores. Choices are date-triggered on a shared clock, so all companies hit them on the same
   tick. Audit the other non-yielding returns: the tutorial stress return (`:3350-3357`) is
   unreachable once tutorials are excluded, and the `isDraft` return (`:3343-3349`) never runs in
   the worker. Add an assertion that turns any future one into a named fault.

4. **End-of-scenario triggers in co-op (riskiest).** The block after `if (state.multiplayer)
return;` (`Game.tsx:3506-3803`) mixes the decision with renderer-only side effects: `getStore`,
   `setTimeout`, `saveEffects`, desktop hooks, `recordScenarioPlayed` and analytics. None of those
   may run in the worker. The fix:
   - Extract the pure decision (`:3655-3695` and `:3746-3748`) into `helpers/ScenarioEnding.ts`.
     It is built from the already-pure `ObjectiveRules`.
   - The single-player path calls it with no behavior change; the `GoldenOutputs` sim test is
     the gate.
   - In co-op, the rollover stores `state.multiplayer.ending` and still returns before the
     side effects.
   - `stepWorld` folds the grid endings into `world.ending = { month, outcomes }` and pauses.
   - `roomView` publishes it, and each renderer dispatches `victoryOpen({ ranked: false, … })`
     once.
5. **Restore validation.**
   - Bump `World.schema` to 2. There's no migration, because co-op is unreleased and any
     `src/multiplayer` change already moves `multiplayerCompatibilityId`.
   - `validGridHeaders` (`World.ts:618-633`) checks each grid against `spec`: `scenarioId`, a
     deep-equal `customScenario`, `difficulty`, the scenario's `startingYear`, and a location
     deep-equal to the spec location. These replace the pinned sandbox values.
   - `validRoster` drops the `LOCATIONS` lookup.
   - `restoreWorld` rebuilds the expected peers with `createWorld(world.spec, …)` (`:767`).
   - Validate `ending` if present.
6. **Session and native.**
   - `Session.start(spec)` replaces `start()` (`Session.ts:405-497`), and seats come from
     members without locations.
   - New `Session.endMatch()`: final checkpoint, terminate the worker, native `unlock` (clears
     `allowed`, `:730-740`), `phase=browsing`, then back to the NEW_GAME list. Guests drop the
     view, which already calls `quit()` (`Root.tsx:38-43`), and keep following.
   - New native requests: `member` and `unlock`, plus lobby data `phase` and the `browse` size
     check. Remove the `location` request.
7. **Entry point.** "Play with friends" is unchanged (`MainMenu.tsx:170` →
   `showMultiplayerLobby`). In the Lobby dialog:
   - remove the location picker and the portfolio roster (`Lobby.tsx:105-127`);
   - replace "Start shared game" with **Choose a game together** (`:128-144`), which closes the
     dialog and navigates to `NEW_GAME` in co-op mode;
   - keep Resume.
8. **Compatibility.** Put `Browse.ts`, the spec validation and the ending fold under
   `src/multiplayer` so they are hashed. View components under `src/components` aren't hashed.
   Guests must therefore tolerate unknown filter and sort values. Anything a guest has to
   interpret identically, like scenario ids and draft shape, already lives in hashed
   `src/data`/`src/helpers`.

**Risk ranking:**

1. Triggers in the worker (#4): this touches the scoring path for all single-player runs.
2. The choice gate (#3): a missed early-return path faults the match.
3. View and checkpoint size in long scenarios. Today a 4-player view at month 48 is 163 KB on the
   wire per publication (`docs/multiplayer-network.md:48`). Views clone full history at up to
   5/s, so month 156–240 could be 3–4× that.
4. Balance. Shared-shock scenarios such as Deep Freeze hit every company at once with
   identical weather and no outside imports.
5. Restore validation for arbitrary specs (#5).

---

## 5. Decisions

The owner decided (16 October 2026):

| Question          | Decision                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| Locations         | Every company uses the scenario's own location.                           |
| One company fails | It retires and the others keep playing (§3).                              |
| Scenario choices  | Each company answers its own, and the shared clock waits for all of them. |
| Delivery          | Built inside PR #543 rather than as stacked PRs.                          |

The remaining recommendations below stand as defaults: soft Ready, no private browsing by guests,
the 5-year sandbox removed, and no achievements or play counts from co-op.

### Original open questions (with recommendations)

1. **Identical vs per-player locations?** Recommend **identical** for every scenario. It is the
   scenario as authored, and it is fair. Downside: identical weather means less trade, which then
   comes only from different player decisions. Offer per-seat locations for _custom_ games later.
2. **Do NPC interties go away?** Recommend **yes, replaced by peers**, which matches #543. Keeping
   both needs the allocator to mix NPC offers with the peer market, which is new market work. On
   the co-op details page, add one line: "Your only interties are to the other players."
3. **Does one company's failure end the match for everyone?** Recommend **yes** (shared fate, a
   co-op goal), with a result screen and Back to lobby. Defer "continue as sandbox".
4. **May guests preview other scenarios privately?** Recommend **no** in v1, so there is one
   source of truth. Guests can read everything on the host's page. Consider a "Suggest" action
   later.
5. **Does Ready gate Start?** Recommend **soft**: Start asks for confirmation if someone isn't
   ready, and the in-game speed gate already guarantees consent.
6. **Who answers scenario choices?** Recommend **each company for itself**, with the clock waiting
   for all. Alternative: the host answers for everyone.
7. **Long scenarios?** Recommend allowing all of them, but gating release on a 4-player month-240
   measurement. If host egress at 24× is above about 1 MB/s, cap co-op at 10 years until
   versioned history blocks ship.
8. **Keep the old 5-year sandbox as a preset?** Recommend **remove it**. Custom game covers it.
9. **Achievements, play counts or "played" markers from co-op?** Recommend **none** in v1.

---

## 6. Delivery plan

The owner chose to build this inside #543, so the phases below are ordered work within that PR,
not separate PRs. Each phase must leave `npm run check` green.

| Phase                       | Scope                                                                                                                                                                  | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A: Sim and save** (PR 1)  | Match spec, `createWorld(spec)`, location generalization, worker `data(location)`, choice gate, `ScenarioEnding` extraction plus co-op endings, schema 2 restore.      | `World.test`: authored spec at a non-built-in location (115 Delhi); custom spec; tutorial and unknown ids rejected; choice gate on 111 at month 11 pauses with a reason and resumes after both answer; one bankrupt grid ends the world; term completion; restore round-trip; a tampered spec or difficulty rejected; schema 1 rejected. `ScenarioEnding` unit tests. `GoldenOutputs.sim.test` unchanged, which proves single-player is untouched. A new `World.sim.test` runs 2 grids through every eligible scenario's full term (`test:sim`) plus a 4-player month-240 size measurement. `npm run sim -- --all`. Worker test for `create` with a spec. |
| **B: Protocol** (PR 1 or 2) | `BrowseState` and validation, native `browse` bound, `member`/`unlock`/`phase`, session publish, accept, dedupe and resend, `endMatch`.                                | `Session.test`: dedupe, stale session, invalid state keeps the last valid one, resend to a joiner, 200 ms coalescing, Ready clears on key change. `steam-multiplayer.test.cjs`: a guest can't send `browse`; >16 KB rejected; member key allowlist; unlock re-admits members.                                                                                                                                                                                                                                                                                                                                                                             |
| **C: UI** (PR 2)            | Gathering dialog, `coop` props on the three views, `CoopBrowseBar`, Ready, Start for everyone, co-op result, Back to lobby. Screenshots on desktop, 390 px and 360 px. | Component tests for guest details (no Start, difficulty read-only, Ready toggles, live-region text) and guest custom sync. Prefer `getByText`/test ids over `getByRole({name})`, which is slow here. `e2e/multiplayer.spec.ts` (`npm run test:multiplayer`): host browses, guest follows, start Deep Freeze, choice pause, end, Back to lobby, then a joiner during browsing; run at desktop and 390 px.                                                                                                                                                                                                                                                  |
| **D: Later**                | Per-seat custom locations, sandbox continuation, versioned history deltas for long matches, guest suggestions.                                                         | Per feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Run `npm run check` per PR. Phase A changes reducer code, so it also needs `npm run sim -- --all`.

## 7. Where v1 differs from this design

- Guests keep their own list filter and sort. Rows can't be opened, so the list is reference
  only. The bar names what the host has open ("Alice is looking at Deep Freeze on Hard") and
  announces it through its polite status region.
- Guests' controls are `disabled` rather than `aria-readonly`. Screen readers still read
  disabled values in browse mode, and the bar states the host's choice in words. Guests'
  custom-game values keep secondary-text contrast instead of greying out.
- Focus isn't moved when the host changes screens.
- Guests leave through a quiet "Leave" button in the bar, which asks for confirmation.
