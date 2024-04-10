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

For us to consider merging your PR, all existing tests must pass.

If your PR changes functionality that breaks a test, note it in your PR description and update the test and any other code affected.

If your PR adds new functionality, please do your best to add additional, passing tests to cover the new functionality. Or, at the very least, add test stubs to indicate what functionality and edge cases should be tested for.

## Style Guide

All code submissions should be formatted with prettier's default styling. We recommend using VSCode with the Prettier extension (esbenp.prettier-vscode)

## Pulling and pushing remote branches

Git can get a bit confusing when it comes to pushing and pulling other folks' branches, so here's a quick reference:

Add a remote repo to your git (aka someone's fork): `git remote add <username> https://github.com/<username>/electrify`

Fetch all of the new branches: `git fetch`

Check out a remote branch: `git checkout -b <desired local branch name> <username>/<remote branch name>`

## Questions?

Email us at Contact@Fabricate.io
