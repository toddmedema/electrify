# Issue 357: discovery and QA record

## Method and limits

A scripted expert walkthrough used local Chromium with desktop 1280 x 800 and phone 390 x 844 emulation. No energy novices, physical iPhone/Safari, modest Android, VoiceOver, or TalkBack were available. Results establish reproduced interaction behavior, not learning, fun, retention, or physical-device usability. Physical-device and formative-participant validation remain pending.

Baseline navigation was inspected before wider navigation edits. The first development compile overlapped implementation of the required legend/HUD; baseline conclusions below are restricted to the still-unchanged navigation/context behavior. A temporary Playwright script recorded chart viewport attributes and operating status, and used normal application controls. Development compiler overlays interrupted unrelated attempts; those are excluded from product findings.

## Baseline task paths

| Task                                                 | Device / speed                                                  | Actual path and result                                                                                                                                                       | Context / help                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Inspect an operating shortfall                       | Chromium 390 x 844; Carbon Fee (100); FAST briefly, then PAUSED | Start; select Coal; Pause Coal; run briefly; pause. Operating bar reports an actual 160 MW shortfall in Jan 2020. Facilities exposes the plant controls and operating chart. | Scripted expert chose the fixture action, not an observed novice decision.                                                        |
| Investigate evidence, inspect a build option, return | Chromium 390 x 844; Carbon Fee; PAUSED                          | Insights; Zoom out twice; Facilities; Generator; close; Insights. The date range changed from [0, 69120] to [0, 17280], reproduced twice.                                    | Three pane/control transitions plus close; original range was lost. No participant help count is available.                       |
| Tutorial Insights step                               | Chromium 390 x 844, dark; Finances tutorial                     | Existing tutorial test opened Insights, zoomed, and opened Layers through actual game controls; passed.                                                                      | No hidden gate in this measured path. Desktop attempt was blocked by an in-progress compiler overlay and is not a product result. |
| In-memory interruption                               | Chromium phone emulation; PAUSED; Jan 2020                      | Open another tab, activate it, return after 1.2 seconds. Date, operating status and [0, 34560] chart range were unchanged.                                                   | Headless page remained visibility=visible: this does not emulate a phone OS background transition.                                |
| Reload recovery                                      | Same fixture; PAUSED                                            | Reload returned to the main menu with Continue available.                                                                                                                    | Continue restore is validated separately below; transient chart context is not a saved-game promise.                              |

## Selected additional scope

One reproduced context problem justifies one bounded Insights evidence -> existing Generator build -> Return to evidence edge. The origin is Insights, with its date range/configuration and meaningful anchor. This is not an unlimited breadcrumb history. No second navigation redesign is selected. No interruption pause/resume change is selected because no local defect was established by the available tab-switch audit.

Before: Insights (chosen range) -> Facilities -> Generator -> close -> Insights (default range).

After, to validate: Insights (chosen range) -> existing Generator control -> Return/browser Back -> Insights (valid current evidence with preserved presentation); ordinary navigation ends the edge.

## Final QA rounds

Three coder <> QA rounds were completed. The results below distinguish browser functionality, visual review, simulation-helper evidence, and access limitations.

### Round 1 — source and browser feedback

The stable run passed 9 new Playwright checks across 1280 desktop, 390 and 320 phones, including both light/dark palettes. Three supplemental checks passed: temporary finance ownership/Continue/FAST Return at desktop and 390, and 150% root text at 390 x 600 and landscape 740 x 360. Mission details restore trigger focus on Escape; actual-shortage evidence leaves Interties for Plants; repeated evidence requests focus the operating chart; supply/demand labels remain at running speeds; mission access survives all three phone tabs; Return restores [0, 69120] and configured layers with one history push; Forward visits the build destination without reconstructing Return.

A controlled negative-cash saved-game fixture opens Finance details as temporary evidence, leaves configured layers unchanged and its checkbox unselected, then intentionally checking the layer persists it and ends temporary reveal. Continue restores PAUSED; entering the Generator control while FAST then Return remains PAUSED. The headless fixture is an interface check, not an economic recommendation.

Reviewed desktop/light and 390/dark operating screenshots showed readable mission/detail controls and no overlap or page overflow. The broader existing Insights responsive suite caught an important density regression: adding Generator to the compact phone Insights header increased it from its 52–54 px contract to 105 px. QA requested relocating that quiet control beside the evidence instead of weakening the height check.

The actual purchase walkthrough reproduced the other blocking issue: Insights -> Generator -> review first Natural Gas option -> Take loan completed the purchase but navigated to Facilities and removed Return (button count 0). The chosen investigation edge therefore failed after the player's decision. QA requested the selected purchase close through the same bounded browser traversal, preserving ordinary purchase behavior outside that edge. These two issues are the round-1 corrective feedback. Earlier source findings (missing target text in compact progress and phone anchor queries using a desktop-only ID) were corrected before the stable run.

### Computation evidence

The pure helper profile exercised 120 real immutable `tickState` ticks in scenario 103. Timeline identity changed on all 120 ticks. `getMissionStatus` + `selectMissionRisk` + a repeated cached sample lookup took 18.337 ms total, 0.152808 ms per tick on this local Jest run. This measures helper CPU, not browser render time or phone performance. The helper has no timeline-generation calls. Unit tests cover missing/partial required history as unknown while preserving the existing available-row outcome evaluator, zero demand, completed-month chronology, recoverable retention, decision waiver/count/categories, deterministic risk order, hidden-story selection, and plan/rollover cache invalidation.

### Round 2 — corrections and additional findings

The 12 established mission/target/return/responsive checks passed again. The corrected compact Insights header passed the existing mobile regression. Remaining corrective feedback for the third and final round: allow the 320 px Insights date-range label to fit its available width, replace the misleading X icon on a temporary-only chart's Keep action, and ensure temporary-only reorder controls have explicit configured-state behavior instead of an enabled no-op.

The repeated 390 px intertie-snackbar timeout was investigated directly. Immediately after Approve, `.MuiSnackbar-root.matches(':hover')` returned true. Moving the Playwright mouse to (0, 0) let the snackbar disappear; count was zero after 8.5 seconds. The test pointer was unintentionally pausing MUI's existing auto-hide timer. Correct the test pointer position; no tutorial timing, mission gates, or product pause policy change is justified.

A second reproducible operating fixture was established for the projected-risk walkthrough: the real Carbon Fee fleet is derated to 390 MW in a saved-game fixture, then Continue and Coal pause/resume regenerate the operating sample through the real reducer. Measured current supply was 390 MW against roughly 354 MW demand; a later sample at minute 495 had demand about 391 MW and supply 390 MW. This gives a current healthy margin and a genuine computed future shortage without fabricating forecast rows. This fixture was added during QA, after the initial unchanged-navigation baseline; the initial baseline did not include a separate future-only fixture. The final purchase walkthrough exercises it and does not assert that new construction immediately solves an operating problem.

### Round 3 — final verification

The final `mission-evidence.spec.ts` run passed **14 tests** with **4 intentional viewport skips** across desktop 1280 x 800, 390 x 844 and 320 x 568. It covers the repeated operating-shortfall inspection, all-speed series labels, both palettes, details/focus return, Interties -> Plants, repeated requests, mission availability on each phone destination, negative-cash temporary-layer ownership, Continue recovery, paused Return after entering a control from FAST, browser Return/Forward, narrow/landscape/large-text reachability, and the computed future-risk purchase path.

For the future-risk path on desktop and 390 phone, the player followed the risk to the actual operating chart, opened Insights, zoomed twice, opened the existing Generator shop from the evidence, reviewed the first Natural Gas option, and deliberately took its loan. The final UI returned to the original [0, 69120] evidence range, the real game had one additional facility under construction, browser history had exactly one additional control edge, and time remained paused. Evidence remains computed from the live plan; a plant with a build delay does not immediately resolve the current sample's shortage. This establishes decision/context continuity, not that this particular purchase is optimal.

A supplemental scripted Hint walkthrough exercised Mission 7 objective 3 with its hint expanded in both themes at 320 x 568, 740 x 360 landscape, and 390 x 700 with 150% root text. All six cases had zero horizontal page overflow; the Insights navigation, All requirements dialog and speed control remained reachable. The objective and hint stayed intact. Resizing the viewport height approximates changing available browser content height; it is not a test of actual mobile browser chrome or OS text-size settings.

The final desktop/light and phone/dark screenshots were inspected directly. They show the mission, timing, required cash threshold, live shortage label, operating-chart series identification and the existing phone/desktop compositions. No developer overlays, unrelated windows or personal data are present. Review-only image paths (temporary, not committed):

- `C:/Users/toddm/electrify/.codex-temp/mission-desktop-chromium-light.png`
- `C:/Users/toddm/electrify/.codex-temp/mission-mobile-390px-dark.png`

The two round-1 functional/design blockers were corrected and verified. No additional functional blocker remains in the new mission/evidence browser checks. The parent runner records final existing-suite reruns and repository-wide `check`/`build` results separately.

## Remaining limits and explicit no-change decisions

- No novice participants were available. Wrong-destination/help/remembered-context observations are expert-script results only; no novice correctness or learning improvement is claimed.
- No physical iPhone/Safari or modest Android device, VoiceOver, TalkBack, or WebKit installation was available. Physical touch scrolling/sliders, browser chrome, real OS interruption/eviction and assistive-technology validation remain pending.
- The headless tab-switch check preserved paused context but did not transition real document visibility to hidden. Reload/Continue was tested separately and restored paused gameplay. No interruption-policy or broader persistence change was selected.
- Only the reproduced Insights -> Generator investigation edge was selected. No second wider-navigation addition, generic history repair, dashboard redesign, economics change or predictive advice was introduced by the QA recommendations.
- The first baseline was captured while required HUD work was beginning; wider-navigation range loss was measured before its optional fix, but the separate future-only fixture was established later during QA. This limits claims about a complete pre-change two-fixture formative baseline.

## Final repository validation

The final production build compiled successfully. Final TypeScript, ESLint and Prettier checks passed. The existing Insights responsive, tutorial auto-advance and Interties matrix had 29 unique active cases and four intentional viewport skips across the runs. After the fixes, all six header/Interties targeted reruns passed at desktop, 390 px and 320 px, including the complete Interties action gates. Earlier desktop Interties overshoot under concurrent coverage/browser load did not reproduce in the final single-worker run; the persistent 390 snackbar case was fixed by the verified test pointer exit described above.

`npm run check` completed successfully: 122 covered Jest suites and 1,171 tests passed, followed by all 18 headless scenarios satisfying every invariant. The covered economics suite took 972 seconds locally. The final UI ownership corrections also passed focused rendered tests and final lint/type/format checks. The production build compiled successfully. Reviewed desktop/mobile screenshots were uploaded to PR #358 with GitHub CLI 2.99 attachments, then the temporary image files were removed.

## Follow-up: minimum-copy status bars

At the user's request, a design subagent critiqued the persistent mission bar and a coder subagent implemented its recommendation. The bar now contains only time left, All requirements, and one short evidence link. Scenario title and full requirement progress remain in the requirements dialog. Risk explanations remain in accessible labels, announcements and tooltip text. During a blackout, the grid strip contains only Blackout and its deficit; the Now prefix and generation/storage advice are removed.

The designer accepted the final desktop/light and 390 px/dark screenshots. The browser suite again passed 14 checks with four intentional viewport skips, including 320 px, both palettes, large text, evidence focus, temporary finance ownership, and purchase/Return. Fourteen focused unit tests and the production build passed. The full repository check passed again: types, lint, formatting, 122 covered Jest suites with 1,172 tests, and all 18 headless scenarios satisfying every invariant.
