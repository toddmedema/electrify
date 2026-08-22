# How to contribute

We welcome contributions from the community and are pleased to have them. Please follow this guide when logging issues or making code changes.

## Logging Issues

All issues should be created using the [new issue form](https://github.com/toddmedema/electrify/issues/new). Clearly describe the issue including steps to reproduce if there are any. Also, make sure to indicate what device / browser you are running it on.

## Patching Code

Code changes are welcome and should follow the guidelines below.

- Fork the repository on GitHub.
- Fix the issue, making sure that you follow the style guide (below).
- Please leave the code nicer than you found it by including at least one new unit test for any functionality you're adding!
- [Pull requests](http://help.github.com/send-pull-requests/) should be made to the [master branch](https://github.com/toddmedema/electrify/tree/master).

## Testing

Run `npm run check` before opening a PR -- it runs types, lint, formatting and tests, which is
exactly what CI checks. For us to consider merging your PR, all of it must pass.

If your PR changes functionality that breaks a test, note it in your PR description and update the test and any other code affected.

If your PR adds new functionality, please do your best to add additional, passing tests to cover the new functionality. Or, at the very least, add test stubs to indicate what functionality and edge cases should be tested for.

## Style Guide

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

## Pulling and pushing remote branches

Git can get a bit confusing when it comes to pushing and pulling other folks' branches, so here's a quick reference:

Add a remote repo to your git (aka someone's fork): `git remote add <username> https://github.com/<username>/electrify`

Fetch all of the new branches: `git fetch`

Check out a remote branch: `git checkout -b <desired local branch name> <username>/<remote branch name>`

## Questions?

Email us at Contact@Fabricate.io
