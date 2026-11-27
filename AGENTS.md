# Working in Electrify

This is a React 18 / Redux Toolkit / TypeScript electricity-market game built with Create React
App. Keep changes focused: the simulation is deliberately centralized and many authored data
files are large, so broad rewrites create expensive review diffs. This file is the only agent
guide; do not add a `CLAUDE.md`. If your tooling does not format on save, run
`npx prettier --write <files>` over the files you changed before `check`.

## Start here

- Use Node 26 (`node --version`; put it on `PATH` if needed). Install exactly the lockfile with
  `npm ci` in a new checkout or when the lockfile changes; reuse that install while it still
  matches.
- Reserve the checkout before editing with `npm run task -- claim`. If no task ID is supplied by
  your environment, set `ELECTRIFY_TASK_ID` or pass the same ID to both claim and release. Use an
  isolated worktree if another task owns the checkout. Release it with `npm run task -- release`
  when finished. See [development coordination](docs/development-workflow.md) for recovery.
- In a fresh worktree, run `npm run check:assets` before tests, builds or browser QA; if it finds
  Git LFS pointers, try `git lfs checkout`, then `git lfs pull`. For missing files, stage
  intentional deletions or renames; otherwise restore them.
- `npm run check` runs eight gates: types (including `e2e/`), lint, formatting, native unit tests,
  CI tooling, covered Jest tests, long simulations of every scenario (`npm run test:sim`), and a
  simulation CLI smoke run. It checks assets first, prints results as each gate finishes, and
  continues after failures. CI also runs the Firestore rules tests (`npm run test:rules`, which
  needs Java 21). Run them yourself when you change `firebase/firestore.rules`.
- Before pushing, run the local checks that cover the changed behavior and its callers (broaden
  for shared simulation, save, co-op, build or workflow changes); record the commands and results
  in the PR. Run `npm run check:prepush` on the commit you will push to catch stale site pages and
  metadata. Hosted CI runs the complete suite on the pushed revision; `npm run check:ci` (fifteen
  gates) is available for broad local verification or reproducing CI failures.
- After fixing a failed gate, use its printed retry command, such as
  `npm run check -- --steps lint,tests`. Keep earlier passes only while their inputs are unchanged.
  `npm run check:ci -- --resume` accounts for all fifteen gates, reruns failed or invalidated gates,
  and verifies reused evidence. A partial check is never evidence that all gates ran. See the
  [resume rules](docs/development-workflow.md#resume-verified-validation).
- For prose-only Markdown changes, review the text and run `git diff --check`; app tests, builds
  and simulations are unnecessary. Changes to scripts, configuration or executable examples need
  the relevant checks.
- Local checks default to at most four Jest workers. Override with `ELECTRIFY_CHECK_WORKERS`
  only for a measured need. Heavy suites run serially, and the simulation CLI runs in process.
  Heavy work queues across worktrees. Let running tests finish.
- `npm run fix` applies every mechanical fix (`lint:fix`, `format`); review its diff. It does not
  fix types or tests.
- Iterate on one Jest suite with `npm run test:once -- <name>`. Plain `npm test` runs in
  interactive watch mode and never exits in a non-interactive shell. Name long simulations
  `*.sim.test.tsx` when they are outside the coverage requirement. `test:ci` skips them, and
  `test:sim` runs them without instrumentation.
- Iterate on game economics with `npm run sim -- --scenario <id>`; see `src/testing/README.md` for
  simulation flags and traps.
- Start performance work from [the performance plan](docs/perf-plan.md). `npm run perf:bench`
  reports tick and rollover times and gates same-process ratios. `npm run perf:bundle` gates gzip
  bytes after a build. `src/testing/GoldenOutputs.sim.test.tsx` pins every scenario's output.
  Rebaseline with `npm run perf:rebaseline` last and explain the move in the PR. Append `?perf=1`
  to a dev URL for the frame-budget overlay.
- Build with `npm run build`. For UI flow or layout changes, search affected `e2e/` specs for the
  old controls and reuse the helpers in `e2e/layout.ts`. Run changed specs with
  `ELECTRIFY_E2E_ALL_SPECS=1 npm run test:e2e -- <spec> --project=desktop-chromium --project=mobile-390px`.
  Add `--project=mobile-360px` for minimum-width layout changes. New assertions must be reached,
  even when an earlier failure also occurs on the base branch.
- `check:ci` uses `e2e/ci.playwright.config.ts` and `e2e/browser-projects.ts`.
  `npm run check:ci -- --steps browser --resume` also verifies the web-build prerequisite.
  `npm run test:e2e:ci -- <spec>` selects only cases in the CI matrix. For other specs against
  production, run `test:e2e` with `ELECTRIFY_E2E_ALL_SPECS=1` and `E2E_BASE_URL` pointing at
  your hosted web build. Local `check:ci` writes to `.tmp/check-builds/web` and
  `.tmp/check-builds/desktop`. Standalone `build` and `desktop:build` default to `build/`.
- Local npm browser/check commands reserve and print an unused `E2E_PORT`. Set it explicitly for
  a stable port across runs. An occupied or reserved port fails before tests. Verify which
  checkout an existing server is serving before using it.
- After freshly verifying a PR is merged, agents may stop its preview servers or obsolete
  validation and free their validation or port reservations. Verify the matching checkout and
  head, the exact process tree, and the absence of later unmerged work. Prefer graceful shutdown
  and normal reservation cleanup. Remove stale reservations only after proving the owner and
  process group are gone. Leave other tasks' servers, work, and leases alone.
- Keep local validation windowless with `npm run check` and headless Chromium through
  `npm run test:e2e`. The Electron UI suite opens native windows and takes keyboard focus. Run
  `npm run test:desktop -- --headed` locally only if the user explicitly requests a native-window
  test. During routine local validation, avoid `--headed`, `--debug`, `--ui`, `PWDEBUG`, and
  `desktop:start`. `test:desktop:native` is a windowless Node unit suite and remains part of `check`.

## Verification design

For behavior changes and new guardrails, use the repo-local
[verify-electrify skill](.agents/skills/verify-electrify/SKILL.md) to choose the contract
and demonstrate that its check catches a violation. Prefer types, owning APIs, lint rules,
and behavioral tests over adding instructions here.

## Agent efficiency

Every turn re-reads the whole conversation, so many small turns and large images cost the most.

- Batch independent lookups: several `rg -n` or `sed -n` calls in one command, or parallel tool
  calls, instead of one lookup per turn.
- Prefer DOM text, computed styles and test assertions to screenshots. When you need an image, use
  `npm run shot` (see `npm run shot -- --help`). It captures headless, device-scale-1 PNGs from
  this checkout's `npm start` server by default. Use `--clip <selector>` to capture one component.
- Look at each image once; do not reopen unchanged screenshots after later edits.
- For any task that uses subagents, follow the [multi-agent-work skill](.agents/skills/multi-agent-work/SKILL.md):
  give subagents focused checks and let the integrating agent own validation of the combined change.

## Run compatibility manifest

`src/data/RunCompatibility.json` is a generated, git-ignored identity of the game reducer's
runtime dependency graph and shipped data. Type-only, comment, and formatting changes leave
official-run compatibility intact. Co-op also uses a broad source/data/lockfile identity. The npm
entry points for `start`, `build`, `test*`, `sim`, and `typecheck` regenerate the manifest. Never
commit or merge it. Run `npm run compatibility:generate` by hand only if your editor needs the
missing file. See [run compatibility](docs/run-compatibility.md) for scope.

## Agent updates

- In chat, lead with what changed, what's blocked, or what you need from Todd. Default to 1–3
  sentences. Use plain verbs and contractions. Put test inventories, commands, and screenshots in
  the PR; in chat, keep the evidence or caveat that changes the next decision.
- In PRs, say what changes for players or maintainers, then what passed, failed, or is still
  pending. Keep commands, results, and required screenshots under their own headings. Never
  compress “not run,” “failed,” and “pending” into “verified.”
- Before sending, cut the setup and anything that repeats the result. Keep the exact label, number,
  or caveat if it helps the reader act. Follow a request for more detail.

Examples:

- Progress: “Build now reopens on phones without losing focus. I'm checking reduced motion.”
- Blocked: “The build passed, but I couldn't run the browser checks locally. Hosted CI is still
  running.”
- PR summary: “Tutorials now start on the 3D map. All seven passed on desktop and at both phone
  widths. See Verification for the commands and results.”

## Pull requests

- After required local checks pass, create or update the PR and report remote CI's current status;
  monitor it to completion only when asked to monitor, merge, or deliver green CI.
- When CI fails, run `npm run ci:failures` or `npm run ci:failures -- <pr>` for failed jobs,
  gates, tests, assertion excerpts, and local reproduction commands. Reproduce the failure, fix
  the cause, rerun the matching gate, push, and report status. Never weaken a test, raise a ceiling
  or rebaseline just to get green; when a change intentionally moves a ceiling, explain the move in
  the PR.
- If a failure is unrelated to your change (also fails on `master`, or a known flake that passes on
  retry), rerun only the failed jobs once with `gh run rerun <run-id> --failed`; if it fails again,
  or after three fix attempts, stop and report the failing test, evidence and diagnosis instead of
  retrying further.
- Merge the base again when needed for conflicts or relevant changes, rather than restarting
  validation for every unrelated base commit. Stop temporary preview servers when finished.
- Stage explicit task files and inspect `git diff --cached` before committing; leave unrelated
  edits, generated hook configuration, scratch tests, and review artifacts out of the PR.
- For user-visible UI work with design choices, share the first usable interaction in chat before
  final QA: a reproducible game state, desktop and mobile when the layout reflows, a short clip
  when motion matters. Call out open design decisions and continue routine verification while
  feedback is pending.
- When opening a pull request with user-visible UI changes, capture 1–3 screenshots of the finished
  interface with `npm run shot` (small, clipped captures at each width and theme) and embed them in
  the description; choose views that clearly show the change, including both desktop and mobile when
  responsive behavior is relevant.
- Review screenshots before uploading: exclude sensitive or user-specific data, transient errors,
  debug UI, and unrelated windows. Keep them in a temporary location and use GitHub CLI 2.99 or
  newer to upload them with `gh pr create --attach`, `gh pr edit --attach`, or
  `gh pr comment --attach`. Remove the files after a successful upload. Non-UI changes do not need
  screenshots. If you cannot capture or upload, say so in the PR description and tell the user.

## Repository map

- `src/Store.tsx` assembles the `card`, `game`, `settings`, `ui`, and `user` slices. Use the typed
  hooks it exports in function components.
- `src/reducers/Game.tsx` owns the simulation clock and state transitions; pure calculations belong
  in `src/helpers/`, and authored scenarios, facilities, economics, weather, and stories belong in
  `src/data/`.
- `src/reducers/GameActions.tsx` intentionally breaks reducer import cycles. Put cross-slice game
  action creators there instead of importing `Game.tsx` from another slice.
- `src/Types.tsx` is the canonical domain model and `src/Constants.tsx` holds shared simulation
  constants. Search both before introducing another local shape or magic number.
- Facilities are exclusive generator/storage unions (`FacilityOperatingType`,
  `FacilityShoppingType`): a field only one side declares reads as `T | undefined` on the union.
  Narrow with `isStorage` instead of casting. Key maps by the domain union (`FuelNameType`,
  `DifficultyType`) rather than `string`.
- `src/components/views/` contains screens with adjacent `*Container.tsx` Redux wiring; reusable
  UI and charts live in `src/components/base/`. `Compositor.tsx` selects the current screen from
  card-navigation state.
- Save structure changes append an ordered migration in `src/SaveUpgrade.ts`, which derives the
  version re-exported by `src/SaveSchema.ts`; keep old steps unchanged and validate decoded,
  upgraded payloads before use. Cover retained progress, malformed/future-schema rejection,
  idempotent current-format round trips and deterministic resumed simulation (`docs/saves.md`).
- `src/testing/Simulator.tsx` drives the real reducer, not a second model. Add economic invariants
  to `src/testing/Invariants.tsx`; do not duplicate game formulas in the simulator.
- Background reading, loaded only when relevant: `docs/demand-model.md`,
  `docs/facilities-economics.md`, `docs/construction-emissions.md`, `docs/hydro-sites.md`,
  `docs/intertie-trends.md`, `docs/intertie-balance.md`, `docs/run-compatibility.md`, and
  `src/testing/SCENARIO_CHOICE_BALANCE.md`.
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

Before UI work, read and follow the [interface design guidance](docs/interface-design.md). It
covers action hierarchy, spacing and control heights, palette and contrast, reflow down to 360 px,
and accessible labels for controls and charts.

## Player-facing writing

Use this whenever you add or change words players see, even as part of a code change: UI labels,
tooltips, status and error messages, tutorials, the manual and in-game help, scenarios, and web or
Steam copy. Also use the public-site and scenario writing skills for those surfaces.

- Write like you're explaining the grid to a friend who wants to play. Use “you,” familiar verbs,
  and contractions where they sound natural. Start with the action, decision, or consequence.
  Give one concrete detail instead of a generic promise. Read neighboring shipped copy before
  changing terminology or tone.
- **UI:** Name the action or state. A warning should explain what happened and what the player can
  do next, if anything. Keep accessible names useful out of context.
- **Tutorials:** Teach one action at a time. Use the exact on-screen control name; tell players
  what to look for when it matters. Don't assume a mouse when the same text is used on touch or
  controller.
- **Manual and help:** Start with the answer, then explain why it works. Keep prerequisites,
  units, limits, and exceptions that could change a player's choice. Use an example when it
  explains a mechanic better than another paragraph.
- **Before shipping:** Cut text the screen already tells the player. Verify labels and claims
  against the game, and read the copy in the screen or lesson where it appears. For UI strings,
  check the 360 px layout and any affected input modes or localization.

Examples (illustrative, not new game strings):

- Button: “Copy link” instead of “Copy invitation URL to clipboard.”
- Tutorial: “Open Build and choose a Battery” instead of “Navigate to the construction interface
  to begin adding storage capacity.”
- Manual: “Solar stops producing at night. A battery can store daytime power for later” instead
  of “Storage assets can mitigate intermittency from renewable sources.”

## Task guidance skills

Read the matching skill before starting.

- [Public-site writing](.agents/skills/public-site-writing/SKILL.md) for website copy.
- [Scenario writing](.agents/skills/scenario-writing/SKILL.md) for scenario, event, and story text.
- [Icon design](.agents/skills/icon-design/SKILL.md) for scenario and facility icons.

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
