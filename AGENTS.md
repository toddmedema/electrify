# Working in Electrify

This is a React 18 / Redux Toolkit / TypeScript electricity-market game built with Create React
App. Keep changes focused: the simulation is deliberately centralized and many authored data
files are large, so broad rewrites create expensive review diffs.

## Start here

- Use Node 26. Verify with `node --version` and put the installed Node 26 on `PATH` if needed.
  Install exactly the lockfile with `npm ci` in a new checkout or when the lockfile changes;
  reuse that install across turns while it still matches the lockfile.
- Reserve the checkout before editing with `npm run task -- claim` (Codex supplies the chat ID;
  otherwise pass an ID or set `ELECTRIFY_TASK_ID`). If another task owns it, use an isolated
  worktree. Release it with `npm run task -- release` when finished. See
  [development coordination](docs/development-workflow.md) for recovery and command behavior.
- In a fresh worktree, run `npm run check:assets` before tests, builds or browser QA. If it finds
  Git LFS pointers, try `git lfs checkout` for cached objects, then `git lfs pull` if needed.
  For missing files, stage intentional deletions or renames; otherwise restore the files.
- Use `npm run check` for an eight-gate check during iteration. It runs types (including `e2e/`),
  lint, formatting, native unit tests, CI tooling, the covered Jest
  suite, the long simulation suites (`npm run test:sim`, which includes every scenario through
  the headless simulation), and a short run of the simulation CLI. CI also runs the Firestore
  rules tests (`npm run test:rules`, which needs Java 21); run them yourself when you change
  `firebase/firestore.rules`. It checks assets first, prints each gate's result as it finishes,
  and continues after gate failures.
- Before pushing a pull request, run `npm run check:ci` once on the integrated code; there is no
  need to run `check` immediately beforehand. Its fifteen gates add the CI checks that most
  often fail pull requests: tick performance, the production web build and bundle-size
  ceilings, the headless production browser suites at 1280, 390 and 360 px, and the multiplayer
  and controller suites against the desktop renderer. Only the packaged Electron suite stays CI-only,
  because it opens native windows.
- After a failed check, fix the issue and rerun the failed gates with the printed command, such as
  `npm run check -- --steps lint,tests`. Keep the earlier passing results only while their inputs
  remain unchanged. A test-query lint fix does not require repeating successful simulations;
  changes to simulation inputs do. `npm run check:ci -- --resume` accounts for all fifteen gates
  and reruns failed or invalidated gates, verifying any reused source, environment, reports,
  and build artifacts. Unknown inputs invalidate conservatively. Without `--resume`, checks run
  fresh. A partial check is never evidence that all gates ran.
  `npm run check:ci -- --steps browser --resume` also verifies its web-build prerequisite.
- For prose-only Markdown changes, review the text and run `git diff --check`; app tests, builds
  and simulations are unnecessary. Changes to scripts, configuration or executable examples
  need the relevant checks. Do not run the full game suite just to save a proposal.
- Local checks default to at most four Jest workers to limit shared-machine contention, and keep
  heavy suites serial. The simulation CLI runs its single suite in process. Override the cap with
  `ELECTRIFY_CHECK_WORKERS` only for a measured need. The npm build/test/check commands queue
  heavy work across local worktrees; do not pause a running test process to make room. When using
  subagents, give them focused checks and let the integrating agent own the final full check.
- `npm run fix` applies every mechanical fix: it runs `lint:fix` and `format`. Review its diff; it
  does not fix types or tests.
- Iterate on one Jest suite with `npm run test:once -- <name>`. Plain `npm test` starts Jest's
  interactive watch mode and never exits in a non-interactive shell. Coverage thresholds apply
  only to `test:ci`, which skips `*.sim.test.tsx`. Name a suite that way when it plays long
  simulations and isn't needed for coverage: `test:sim` runs those without instrumentation in a
  separate CI job.
- Iterate on game economics with `npm run sim -- --scenario <id>`. See `src/testing/README.md`
  for simulation flags and traps.
- Performance work starts from `docs/perf-plan.md`. `npm run perf:bench` reports tick and
  rollover cost and gates same-process ratios; `npm run perf:bundle` gates gzip bytes after a
  build; `src/testing/GoldenOutputs.sim.test.tsx` pins every scenario's output. Rebaseline all of
  them with `npm run perf:rebaseline`, last, and explain the move in the PR. Append `?perf=1`
  to a dev URL for the frame-budget overlay.
- Build with `npm run build`. For UI flow or layout changes, search affected `e2e/` specs for
  the old controls and reuse the navigation helpers in `e2e/layout.ts`. Run changed specs with
  `npm run test:e2e -- <spec> --project=desktop-chromium --project=mobile-390px`; include
  `--project=mobile-360px` when minimum-width layout changes. New assertions must be reached,
  even when an earlier failure also occurs on the base branch.
- `check:ci` runs only the smoke/layout specs listed in `e2e/ci.playwright.config.ts`.
  `test:e2e:ci -- <spec>` cannot select a spec outside that list. To test an arbitrary spec
  against production, use `test:e2e` with `E2E_BASE_URL` pointing to your hosted web build.
  Local `check:ci` keeps web and desktop artifacts in `.tmp/check-builds/web` and
  `.tmp/check-builds/desktop`. Standalone `build` and `desktop:build` still default to `build/`.
- Local npm browser/check commands reserve and print an unused `E2E_PORT`. To keep a specific
  port across invocations, set it explicitly; an occupied or reserved port fails before tests.
  Leave other tasks' servers alone. An already-running dev server may serve another checkout.
- Keep local validation windowless: use `npm run check` and headless Chromium through
  `npm run test:e2e`. The Electron UI suite opens native windows and takes keyboard focus;
  leave it to CI unless the user explicitly requests a local native-window test. It requires
  `npm run test:desktop -- --headed`. Do not add `--headed`, `--debug`, or `--ui`, set `PWDEBUG`,
  or launch `desktop:start` during routine local validation. `test:desktop:native` is a
  windowless Node unit suite and remains part of `check`.

## Verification design

For behavior changes and new guardrails, use the repo-local
[verify-electrify skill](.agents/skills/verify-electrify/SKILL.md) to choose the contract
and demonstrate that its check catches a violation. Prefer types, owning APIs, lint rules,
and behavioral tests over adding instructions here.

## Agent efficiency

Every turn re-reads the whole conversation, so many small turns and large images cost the most.

- Batch independent lookups: several `rg -n` or `sed -n` calls in one command, or parallel tool
  calls, instead of one lookup per turn.
- Prefer DOM text, computed styles and test assertions to screenshots. When you need an image,
  use `npm run shot` (see `npm run shot -- --help`) instead of a throwaway Playwright script: it
  is headless, writes device-scale-1 PNGs, and `--clip <selector>` captures just the component.
  It photographs the dev server that `npm start` is running in this checkout.
- Look at each image once; do not reopen unchanged screenshots after later edits.
- For any task that uses subagents, follow the
  [multi-agent-work skill](.agents/skills/multi-agent-work/SKILL.md): one shared brief, capped
  read-only reviewer findings, a fresh coder per cluster of about five findings, and a final
  review of `git diff origin/master...`.

## Run compatibility manifest

`src/data/RunCompatibility.json` is a generated, git-ignored identity of the game reducer's
runtime dependency graph and shipped data. Type-only, comment and formatting changes do not
move official-run compatibility; co-op also retains a broad source/data/lockfile identity.
The npm entry points for
`start`, `build`, `test*`, `sim`, and `typecheck` regenerate it automatically, so never commit or
merge it. Run `npm run compatibility:generate` by hand only if your editor complains that the file
is missing. See `docs/run-compatibility.md` for why the hash is intentionally broad.

## Claude Code

This file is the only agent guide; do not add a `CLAUDE.md`. `.claude/settings.json` allows the
npm scripts above without a prompt and formats each file Claude edits with Prettier, so formatting
failures should be rare. Generated `.codex/` hook copies are local and may be stale; keep them
untracked. Agents without a verified hook should format the files they changed before `check`
(for example, `npx prettier --write <files>`).

## Pull requests

- After required local checks pass, create or update the PR and report remote CI's current
  status. Monitor it to completion only when asked to monitor, merge, or deliver green CI.
- When CI fails, run `npm run ci:failures` (or `npm run ci:failures -- <pr>`). It lists the failed
  jobs, gates, tests and assertion excerpts, plus the local command that reproduces each
  failure. Reproduce the failure, fix the cause, rerun the matching local gate, push, and report
  the current status. Never weaken a test, raise a ceiling or rebaseline just to get green; when a change
  intentionally moves a ceiling, explain the move in the PR.
- If a failure is unrelated to your change (it also fails on `master`, or it is a known flake that
  passes on retry), rerun only the failed jobs once with `gh run rerun <run-id> --failed`. If it
  fails again, or after three fix attempts, stop and report the failing test, the evidence and
  your diagnosis instead of retrying further.
- Merge the base again when needed for conflicts or relevant changes, rather than restarting
  validation for every unrelated base commit. Stop temporary preview servers when finished.
- Stage explicit task files and inspect `git diff --cached` before committing; leave unrelated
  edits, generated hook configuration, scratch tests, and review artifacts out of the PR.
- When opening a pull request with user-visible UI changes, capture 1-3 screenshots of the
  finished interface and embed them in the pull request description. Choose views that clearly
  show the change, including both desktop and mobile layouts when responsive behavior is relevant.
  `npm run shot` produces small, clipped captures at each width and theme.
- Keep review screenshots in a temporary location and upload them with GitHub CLI 2.99 or newer
  using `gh pr create --attach`, `gh pr edit --attach`, or `gh pr comment --attach`. Do not commit
  screenshots that exist only to illustrate a pull request; GitHub-hosted attachments keep them
  out of the repository and its Git LFS history. Remove the temporary files after a successful
  upload.
- Review screenshots before uploading them: exclude sensitive or user-specific data, transient
  errors, debug UI, and unrelated windows or overlays. Non-UI changes do not need screenshots.
- If the current environment cannot capture or upload images, say so in the pull request
  description and tell the user instead of silently omitting the screenshots.

## Repository map

- `src/Store.tsx` assembles the `card`, `game`, `settings`, `ui`, and `user` slices. Use the typed
  hooks it exports in function components.
- `src/reducers/Game.tsx` owns the simulation clock and state transitions. Pure calculations
  belong in `src/helpers/`; authored scenarios, facilities, economics, weather, and stories belong
  in `src/data/`.
- `src/reducers/GameActions.tsx` intentionally breaks reducer import cycles. Put cross-slice game
  action creators there instead of importing `Game.tsx` from another slice.
- `src/Types.tsx` is the canonical domain model and `src/Constants.tsx` holds shared simulation
  constants. Search both before introducing another local shape or magic number.
- Facilities are exclusive generator/storage unions (`FacilityOperatingType`,
  `FacilityShoppingType`): a field only one side declares reads as `T | undefined` on the union.
  Narrow with `isStorage` instead of casting. Key maps by the domain union (`FuelNameType`,
  `DifficultyType`) rather than `string`.
- `src/components/views/` contains screens; adjacent `*Container.tsx` files provide Redux wiring.
  Reusable UI and charts live in `src/components/base/`. `Compositor.tsx` selects the current
  screen from the card-navigation state.
- Save structure changes append an ordered migration in `src/SaveUpgrade.ts`, which derives
  the version re-exported by `src/SaveSchema.ts`. Keep old steps unchanged and validate decoded,
  upgraded payloads before use. Cover retained progress, malformed/future-schema rejection,
  idempotent current-format round trips and deterministic resumed simulation; see `docs/saves.md`.
- `src/testing/Simulator.tsx` drives the real reducer, not a second model. Add economic invariants
  to `src/testing/Invariants.tsx`; do not duplicate game formulas in the simulator.
- Background reading, loaded only when relevant: `docs/demand-model.md` (customer demand),
  `docs/facilities-economics.md` (facility cost sources), `docs/construction-emissions.md`
  (embodied emissions sources), `docs/hydro-sites.md` (hydro site catalogue and provenance),
  `docs/intertie-trends.md` (neighbour emissions, prices and intertie opening years),
  `docs/intertie-balance.md` (intertie access rules and balance evidence),
  `docs/run-compatibility.md` (challenge compatibility), and
  `src/testing/SCENARIO_CHOICE_BALANCE.md` (scenario choice balance).
- Several files are large: `app.scss`, `reducers/Game.tsx`, `views/Insights.tsx`,
  `data/WorldEvents.tsx`, `data/TransmissionProfiles.ts`, `data/Scenarios.tsx`, and `Types.tsx`.
  Search them for the symbol you need and read that range instead of loading the whole file.

## Changes that span files

- A new facility usually touches `Types.tsx`, `data/Facilities.tsx`, build UI, icons under
  `public/images/`, and focused facility/simulation tests.
- A new scenario or story belongs in `data/Scenarios.tsx` or `data/WorldEvents.tsx` and should add
  deterministic tests. Keep scenario IDs unique and update their references when changing them.
- Weather binaries and `public/data/weather/index.json` are generated by the scripts documented in
  `README.md`. Their encoder must stay aligned with `src/data/WeatherBinary.tsx`.
- Static images and audio are tracked with Git LFS. Do not replace them with pointer text or assume
  a successful JS build proves those assets were fetched.
- Reducer changes should have a reducer/helper test and should run `npm run sim -- --all`. UI flow,
  responsive layout, or tutorial changes may also need a Playwright spec.

## Interface design

- Organize each screen around the player's next decision. Give it one clearly dominant action;
  keep navigation, account actions, and secondary controls quieter than the game state and choice
  in front of the player.
- Follow the established 4 px spacing rhythm, building common gaps and padding from 4, 8, 12, and
  16 px. Keep interactive controls at least 40 px high on desktop and 44 px on coarse-pointer
  devices.
- Preserve the palette's semantic roles. Electric blue means interaction, red means a shortage or
  harmful state, amber means warning, and green means favorable change. Use the cool neutral
  surfaces for structure instead of introducing decorative colors.
- Design light and dark modes as separate contrast systems rather than mechanically inverting
  colors. Use the shared theme and CSS tokens, and verify text, controls, charts, and SVGs in both
  palettes.
- Make dense information readable through hierarchy: clear headings, direct labels, restrained
  dividers, and small tonal steps between page, panel, card, selected, and chart surfaces. Prefer
  these tools to heavy shadows, ornamental decoration, or unnecessary nested cards.
- Reflow by priority instead of shrinking the desktop composition. On phones, show one primary
  pane, abbreviate or collapse secondary controls, allow appropriate rails to scroll, and stack
  actions before they crowd or overflow. Keep charts and critical status legible.
- Design for a minimum viewport width of 360 px, the narrowest common modern smartphone (many
  Samsung Galaxy models). Don't add short forms or layouts just for narrower widths.
- Never make color or an icon the only carrier of meaning. Pair symbols and state colors with text;
  distinguish chart series with direct labels, patterns, or line styles as well as color.

## Task guidance skills

Read the matching file before starting; each holds guidance only that task needs.

- Writing or editing scenario, event and story copy:
  [.agents/skills/scenario-writing/SKILL.md](.agents/skills/scenario-writing/SKILL.md).
- Designing or revising scenario and facility icons:
  [.agents/skills/icon-design/SKILL.md](.agents/skills/icon-design/SKILL.md).

## Guardrails

- Keep seeded simulation paths deterministic. Use the seed helpers in `src/helpers/Math.tsx`, not
  ambient randomness, for any simulation outcome. Raise powers with `pow` from
  `src/helpers/Pow.ts`: `Math.pow` and `**` round differently on Windows than on Linux CI. Take
  `exp`, `log`, `sin` and other transcendentals from `src/helpers/Libm.ts`: `Math`'s round
  differently on arm64 than on x86-64.
- Load simulation data before calling weather or fuel-price helpers from a non-browser entry point;
  the simulator does this through `loadSimData`.
- Preserve the import-order boundary around `StoreRegistry`: the game reducer dispatches follow-up
  actions through it, and `reducers/ImportOrder.test.tsx` protects startup from dependency cycles.
- Treat `public/data/`, large media, and generated output as artifacts. Prefer changing their source
  or generator, and avoid formatting or rewriting them incidentally.

## Open Sprint Runtime Contract

This section applies only to agents launched by the Open Sprint orchestrator, whose task prompt
asks for a `.opensprint/active/<task-id>/result.json` payload. Interactive Claude Code and Codex
sessions skip it and follow "Pull requests" above, including pushing and opening the PR.

Open Sprint manages task state internally. Do not use external task CLIs.

- Native Claude Code (`claude-cli`) and Codex (`codex`) agents use local subscription sign-in, not API-key settings. Their task prompts are passed on stdin. Provider, model, and optional effort are configured by task type: Planning, Design, Coding, QA, and Code Review. Effort uses the selected model’s supported levels; omitted effort preserves CLI defaults. Explicit effort is verified before launch and passed through the native CLI configuration, including task-file runs. Sandbox restrictions remain active; if a required action is blocked, report it rather than claiming success. The orchestrator commits remaining worktree changes before merge.
- Pull request delivery uses a shared plan branch; the orchestrator publishes the PR and retains the branch for human merge. Execute agents must leave publication to the orchestrator. PR delivery requires no active or retained review governance; governed projects use direct delivery.
- Execute agents start in a prepared worktree with the task branch already checked out.
- Agent admission is cancellable and FIFO. Recheck attempt generation and owning slot after admission and immediately before launch; cancelled or replaced queued attempts must never launch. Concurrency limit changes preserve active accounting.
- Recovered PIDs are observation-only until ownership is independently verified. Retain uncertain assignments instead of killing or requeueing them. A stop request becomes stopped only after observed completion. A terminal result file alone cannot complete an unverified recovered process. Guidance receipts distinguish durable queue acceptance from inclusion in a model turn.
- Run the smallest relevant non-watch verification for touched workspaces while iterating. Use scoped tests first, add scoped build/typecheck and lint commands when your changes could affect them, and leave the branch in a state where the project’s configured merge quality gates are expected to pass before reporting success.
- If you add, remove, or upgrade dependencies: run the repository’s documented install workflow from the repository root, update manifests/lockfiles required by that ecosystem, and commit dependency metadata changes together with the code that uses them.
- If the project’s build/typecheck includes tests, ensure test-runner globals and typing/runtime configuration are set up so build/typecheck still passes after your changes.
- Report completion or blocking questions by writing the exact `.opensprint/active/<task-id>/result.json` payload requested in the task prompt.
- Commit incremental logical units while working so crash recovery can preserve progress.
- If blocked by ambiguity, return `status: "failed"` with `open_questions` instead of guessing.
- Do not push, merge, or close tasks manually; the orchestrator handles validation, task state, merging, and remote publication.
- When review governance is enabled, use the assignment's pinned policy release and structured findings/appeals. Repository edits cannot alter governing authority. Human governance rulings are separate from ordinary open-question answers; do not resolve dockets or access approval credentials. Hard gates and protected-path scope cannot be waived; under enforcement only an owner's structured scope grant unlocks protected paths, never task wording.
- Governance waiting tasks retain their worktree and durable evidence while releasing agent slots. Only a valid code/policy-bound disposition permits resumption. Policy amendments and rollback require authorized human approval and complete isolated evaluation.
- Prepared remote publication tasks start with fresh review and hard checks against the assigned remote base and original per-file scope; rejected code may then enter a fix cycle. Pending publication cannot trigger automatic deployment.
