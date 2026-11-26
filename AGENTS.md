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
- Reserve the checkout before editing with `npm run task -- claim` (pass an ID or set
  `ELECTRIFY_TASK_ID`); if another task owns it, use an isolated worktree. Release with
  `npm run task -- release` when finished; see [development coordination](docs/development-workflow.md)
  for recovery.
- In a fresh worktree, run `npm run check:assets` before tests, builds or browser QA; if it finds
  Git LFS pointers, try `git lfs checkout`, then `git lfs pull`. For missing files, stage
  intentional deletions or renames; otherwise restore them.
- `npm run check` runs eight gates: types (including `e2e/`), lint, formatting, native unit tests,
  CI tooling, the covered Jest suite, the long simulation suites (`npm run test:sim`), and a short
  simulation CLI run. It checks assets first and continues after gate failures. CI also runs the
  Firestore rules tests (`npm run test:rules`, which needs Java 21); run them yourself when you
  change `firebase/firestore.rules`.
- Before pushing, run the local checks that cover the changed behavior and its callers (broaden
  for shared simulation, save, co-op, build or workflow changes); record the commands and results
  in the PR. Run `npm run check:prepush` on the commit you will push to catch stale site pages and
  metadata. Hosted CI runs the complete suite on the pushed revision; `npm run check:ci` (fifteen
  gates) is available for broad local verification or reproducing CI failures.
- After a failed check, rerun only the failed gates with the printed command (e.g.
  `npm run check -- --steps lint,tests`); keep earlier passing results only while their inputs are
  unchanged. `npm run check:ci -- --resume` reruns failed or invalidated gates and verifies reused
  evidence ([development coordination](docs/development-workflow.md#resume-verified-validation)). A
  partial check is never evidence that all gates ran.
- For prose-only Markdown changes, review the text and run `git diff --check`; app tests, builds
  and simulations are unnecessary. Changes to scripts, configuration or executable examples need
  the relevant checks.
- Local checks cap Jest workers at four (override with `ELECTRIFY_CHECK_WORKERS` only for a
  measured need) and queue heavy work across local worktrees; do not pause a running test process
  to make room.
- `npm run fix` applies every mechanical fix (`lint:fix`, `format`); review its diff. It does not
  fix types or tests.
- Iterate on one Jest suite with `npm run test:once -- <name>`; plain `npm test` is interactive
  watch mode and never exits in a non-interactive shell. Coverage thresholds apply only to
  `test:ci`, which skips `*.sim.test.tsx` — name long simulation suites that way and run them with
  `test:sim`.
- Iterate on game economics with `npm run sim -- --scenario <id>`; see `src/testing/README.md` for
  simulation flags and traps.
- Performance work starts from `docs/perf-plan.md`: `npm run perf:bench` gates tick and rollover
  cost, `npm run perf:bundle` gates gzip bytes after a build, and GoldenOutputs pins every
  scenario's output; rebaseline with `npm run perf:rebaseline`, last, and explain the move in the
  PR. Append `?perf=1` to a dev URL for the frame-budget overlay.
- Build with `npm run build`. For UI flow or layout changes, search affected `e2e/` specs for the
  old controls and reuse the helpers in `e2e/layout.ts`; run changed specs with
  `ELECTRIFY_E2E_ALL_SPECS=1 npm run test:e2e -- <spec> --project=desktop-chromium
  --project=mobile-390px` (add `--project=mobile-360px` for minimum-width layout changes). New
  assertions must be reached, even when an earlier failure also occurs on the base branch.
- `check:ci` runs the production browser selection in `e2e/ci.playwright.config.ts`;
  `test:e2e:ci -- <spec>` selects only cases already in that matrix. To test an arbitrary spec
  against production, run `test:e2e` with `ELECTRIFY_E2E_ALL_SPECS=1` and `E2E_BASE_URL` pointing
  at your hosted web build. Local `check:ci` keeps artifacts in `.tmp/check-builds/`.
- Local npm browser/check commands reserve and print an unused `E2E_PORT`; set it explicitly to
  keep a specific port across invocations. Preserve other tasks' servers except for the verified
  merged-PR cleanup below.
- Agents may stop preview servers and free port reservations for PRs freshly verified as merged,
  after verifying the matching checkout/head and exact process tree with no later unmerged work.
  Prefer graceful shutdown; remove stale reservations only after proving their owner and process
  group are gone. Never touch unrelated or unmerged work, or a lease another task has acquired.
- Keep local validation windowless: use `npm run check` and headless Chromium through
  `npm run test:e2e`. The Electron UI suite opens native windows and takes keyboard focus; leave it
  to CI unless the user explicitly requests `npm run test:desktop -- --headed`. Do not add
  `--headed`, `--debug`, or `--ui`, set `PWDEBUG`, or launch `desktop:start` during routine local
  validation. `test:desktop:native` is a windowless Node unit suite and remains part of `check`.

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
  `npm run shot` (see `--help`) instead of a throwaway Playwright script: headless, device-scale-1
  PNGs, `--clip <selector>` captures just the component; it photographs the dev server that
  `npm start` is running in this checkout.
- Look at each image once; do not reopen unchanged screenshots after later edits.
- For any task that uses subagents, follow the [multi-agent-work skill](.agents/skills/multi-agent-work/SKILL.md):
  give subagents focused checks and let the integrating agent own validation of the combined change.

## Run compatibility manifest

`src/data/RunCompatibility.json` is a generated, git-ignored identity of the game reducer's
runtime dependency graph and shipped data. The npm entry points for `start`, `build`, `test*`,
`sim`, and `typecheck` regenerate it automatically, so never commit or merge it; run
`npm run compatibility:generate` by hand only if your editor complains that the file is missing.
See [docs/run-compatibility.md](docs/run-compatibility.md) for why the hash is intentionally broad.

## Pull requests

- After required local checks pass, create or update the PR and report remote CI's current status;
  monitor it to completion only when asked to monitor, merge, or deliver green CI.
- When CI fails, run `npm run ci:failures` (or `-- <pr>`): it lists the failed jobs, gates, tests
  and assertion excerpts plus the local command that reproduces each. Reproduce the failure, fix
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
  debug UI, and unrelated windows. Keep them in a temporary location and upload with `gh pr create
  --attach`, `gh pr edit --attach`, or `gh pr comment --attach`; remove the files after a successful
  upload. Non-UI changes do not need screenshots; if you cannot capture or upload, say so in the PR
  description and tell the user.

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
  `docs/intertie-trends.md`, `docs/intertie-balance.md`, `docs/interface-design.md`,
  `docs/run-compatibility.md`, and `src/testing/SCENARIO_CHOICE_BALANCE.md`.
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

For UI work, follow the [interface design guidance](docs/interface-design.md): one dominant action
per screen, 4 px spacing rhythm and minimum control heights, semantic palette roles, separate
light/dark contrast systems, hierarchy over decoration, priority-based reflow to a 360 px minimum,
and no color-only meaning.

## Task guidance skills

Read the matching skill before starting: [scenario copy](.agents/skills/scenario-writing/SKILL.md)
for scenario, event and story text; [icon design](.agents/skills/icon-design/SKILL.md) for scenario
and facility icons.

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
