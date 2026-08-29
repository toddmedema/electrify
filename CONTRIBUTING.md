# How to contribute

Contributions are welcome. This guide covers issue reports and code changes.

## Reporting issues

Use the [new issue form](https://github.com/toddmedema/electrify/issues/new). Include reproduction
steps, expected and actual behavior, and the device and browser where the problem occurs.

## Submitting code

Code changes are welcome and should follow the guidelines below.

- Fork the repository on GitHub.
- Create a focused branch from `master`.
- Follow the style and testing guidance below.
- Add tests for new behavior and regressions.
- Open the pull request against [`master`](https://github.com/toddmedema/electrify/tree/master).

## Testing

Run `npm run check` before opening a PR -- it runs types, lint, formatting and tests, which is
exactly what CI checks. For us to consider merging your PR, all of it must pass.

If a pull request intentionally changes behavior, update the affected tests and explain the change
in the pull request description.

## Style guide

All code submissions should be formatted with prettier, configured in `.prettierrc`. Run
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
