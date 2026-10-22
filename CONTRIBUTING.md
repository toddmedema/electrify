# Contributing to Electrify

Help make the game more interesting, more understandable, and more fun to play.
Bug fixes, balance improvements, scenarios, interface work, and documentation are
all welcome. [Browse or open an issue](https://github.com/toddmedema/electrify/issues)
to share what you have in mind, especially before starting a large change.

Follow the [README's local setup](README.md#run-locally) to get the game running.
Keep changes focused: the simulation is centralized and several authored data
files are large, so broad rewrites are difficult to review.

## Reporting issues

Use the [new issue form](https://github.com/toddmedema/electrify/issues/new). Include reproduction
steps, expected and actual behavior, and the device and browser where the problem occurs.

## Setup notes

Use Node.js 24; check with `node --version`. A version manager such as
[nvm](https://github.com/nvm-sh/nvm) can help when switching between projects.
Use `npm ci` to install the committed lockfile in a new checkout or after it
changes, and reuse that installation while it still matches.

Development commands work in standard Windows, macOS, and Linux shells. The web
deployment script requires a POSIX-compatible shell such as Git Bash.

For online accounts and leaderboards, ask a maintainer for a Firebase API key.
Put it in a git-ignored `.env.local` file at the repository root, then restart the
development server:

```dotenv
REACT_APP_FIREBASE_API_KEY=your-key
```

Run `npm run check:assets` in a fresh checkout before tests or builds. Images and
audio use Git LFS. If the check reports pointers, try `git lfs checkout` for cached
objects, then `git lfs pull` if needed. Restore missing files unless their deletion
or rename is intentional; stage intentional changes before retrying.
The full check runs this preflight automatically before starting any gates.

## Find your way around

| Location                                | What lives there                                       |
| --------------------------------------- | ------------------------------------------------------ |
| `src/components/views/`                 | Game screens and their Redux containers                |
| `src/components/base/`                  | Shared controls, charts, and manual entries            |
| `src/reducers/Game.tsx`                 | Simulation clock and state transitions                 |
| `src/helpers/`                          | Game calculations                                      |
| `src/data/`                             | Scenarios, facilities, economics, weather, and stories |
| `src/Types.tsx` and `src/Constants.tsx` | Shared domain types and constants                      |
| `src/testing/`                          | Headless simulator, invariants, and simulation tests   |
| `e2e/`                                  | Playwright UI tests and navigation helpers             |

The headless simulator drives the real game reducer. Use it to check balance
without playing through the UI; see the [simulation guide](src/testing/README.md).
Keep replay outcomes deterministic by using the seeded helpers in
`src/helpers/Math.tsx` and `pow` from `src/helpers/Pow.ts` for powers.

For data or artwork changes, see [weather and assets](docs/weather-and-assets.md).
The [agent guide](AGENTS.md) has further repository conventions and links to the
simulation's design references.

## Style guide

All code submissions should be formatted with prettier, configured in `package.json`. Run
`npm run format` before committing, or use VSCode with the Prettier extension
(esbenp.prettier-vscode) set to format on save. CI fails on unformatted files.

Lint rules live under `eslintConfig` in `package.json`, on top of the create-react-app
defaults. `npm run lint` runs with `--max-warnings=0`, so anything it reports fails CI. The
rules worth knowing about, and why they are on:

- **`@typescript-eslint/no-explicit-any`** -- `any` switches off checking for everything
  downstream of it, and the ones this codebase had were hiding real bugs. If you genuinely need
  one, disable it on the line with a comment saying why.
- **`no-console`**, allowing `warn` and `error` -- `console.log` is for debugging and should
  not survive review. Warnings and errors are how the game reports real problems, so they stay.
- **`@typescript-eslint/no-unused-vars`**, including caught errors -- an error that is caught
  and never looked at is usually a swallowed bug. Prefix with `_` (`catch (_err)`) to say the
  swallowing is deliberate.
- **`eqeqeq`** (`null` exempt), **`no-var`**, **`prefer-const`**.

## Check your changes

For **prose-only Markdown changes**, review the text and run `git diff --check`.
App tests, builds, and simulations are unnecessary. Changes to scripts,
configuration, or executable examples need the relevant checks.

For a focused test suite:

```sh
npm run test:once -- <name>
```

`npm test` starts Jest in interactive watch mode. Test files use the `.test.ts` or
`.test.tsx` suffix.

For the broader development check:

```sh
npm run check
```

Checks assets, types, lint, formatting, native unit tests, CI tooling, covered Jest tests,
simulation suites and a simulation CLI smoke run. Results appear as each gate finishes.
The check's Jest suites use at most four workers; set `ELECTRIFY_CHECK_WORKERS` to override
that limit. This default limits contention on shared machines; it is not a measured speedup.
The simulation CLI runs its single suite in process. These gates keep their caches inside `.tmp/`.

Before pushing code changes for a pull request, run `npm run check:ci` once on the integrated code instead.
It includes those eight gates plus tick performance, the production web build, bundle-size
ceilings, the production browser smoke/layout matrix and the desktop renderer's multiplayer
suite: fourteen gates in total. The packaged Electron UI suite remains CI-only.

After repairing a failed gate, use the printed retry command, for example
`npm run check -- --steps lint,tests`. This reports a partial check; retain earlier passing
results only when their inputs have not changed. The runner does not track invalidated results;
rerun the full check if unsure (`check:ci` when retaining evidence from its extra gates).
`npm run check:ci -- --steps browser` is also a partial retry; it rebuilds the web renderer
first. A `multiplayer` retry rebuilds the desktop renderer, since both write to `build/`.
Use `npm run check -- --help` for gate IDs. Individually:

| Command                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `npm run typecheck`    | `tsc --noEmit` for the app, then `tsc -p e2e`             |
| `npm run lint`         | ESLint for app and data scripts; warnings are errors      |
| `npm run format`       | Rewrite app and script files with Prettier                |
| `npm run format:check` | Report unformatted app or script files                    |
| `npm run test:ci`      | Run Jest once with the same coverage checks used by CI    |
| `npm run test:sim`     | Run the long simulation suites (`*.sim.test.tsx`)         |
| `npm run test:e2e`     | Run browser UI tests in headless Chromium                 |
| `npm run sim -- --all` | Run every scenario through the headless invariant checker |

Local checks run without opening application windows. The Electron UI suite requires an
explicit `npm run test:desktop -- --headed` because it opens native windows and takes keyboard
focus. CI runs that suite on dedicated runners; see [desktop testing](docs/desktop-steam.md).

For changed UI flows or layouts, run the affected specs even when they are outside CI's list:

```sh
npm run test:e2e -- <spec> --project=desktop-chromium --project=mobile-390px
```

Add `--project=mobile-360px` for minimum-width layout changes. Reuse the navigation helpers
in `e2e/layout.ts` and make sure the run reaches the changed assertions. `test:e2e:ci` only
selects the smoke/layout specs in `e2e/ci.playwright.config.ts`, even when passed another spec.
To run an arbitrary spec against production, use `test:e2e` with `E2E_BASE_URL` pointing to
your hosted web build. Rebuild web first if `check:ci` last wrote the desktop renderer.

Use an unused task-specific `E2E_PORT` for browser checks and keep it in the same shell
through the final check: `$env:E2E_PORT = "3189"` in PowerShell or `export E2E_PORT=3189`
in Bash. If occupied, choose another port without stopping another task's server.

`npm run test:ci` reports coverage and skips the `*.sim.test.tsx` suites, which CI runs without
coverage through `npm run test:sim`. `src/helpers` and `src/reducers` have floors set in
`package.json` just under where they stand today, so a change that guts them fails rather than
landing quietly; raise the floors as coverage grows.

## Open a pull request

Fork the repository and create a focused branch from `master`. Add tests for new
behavior and regressions, then open your pull request against
[`master`](https://github.com/toddmedema/electrify/tree/master).

Explain the problem, the resulting behavior, and how you verified the change.
Include screenshots for visible interface changes, with desktop and mobile views
when responsive behavior is involved. Keep review images out of the repository;
attach them to the pull request.

Run the relevant checks above and review `git diff --check` before pushing.
For simulation changes, include the scenario or invariant evidence that supports
the new behavior. See [performance work](docs/perf-plan.md) before changing
performance baselines.

## Debugging

The app supports the [Redux DevTools browser extension](https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd)
for inspecting application state.

## Working with remote branches

Git can get a bit confusing when it comes to pushing and pulling other folks' branches, so here's a quick reference:

Add a contributor's fork:

```sh
git remote add <username> https://github.com/<username>/electrify.git
```

Fetch its branches:

```sh
git fetch <username>
```

Create a local branch from one of them:

```sh
git switch --create <local-branch> --track <username>/<remote-branch>
```

## Questions?

Email [Contact@Fabricate.io](mailto:Contact@Fabricate.io).
