# Electrify

A mobile-friendly web game that teaches about the electricity markets in the style of a Tycoon game. Hosted at https://electrifygame.com

## Getting Started

### Setup

Requires NodeJS v21+. Check your version with `node -v`.

We recommend using [NVM](https://github.com/creationix/nvm) to install Node to make it easier to swap between and upgrade Node versions.

Windows: must be run within a Unix-like shell (such as Git Bash).

With Node.js installed, run the following from the root of the repository:

```sh
npm install
```

To use the online high score capabilities, you will need to contact an admin to get a Firebase api key.

### Development Workflow: Serve & watch

```sh
npm start
```

This runs the app at [http://localhost:3000](http://localhost:3000).

### Run tests

```sh
npm test
```

This runs the unit tests defined in files with the `.test.tsx` extension.

### Check everything

```sh
npm run check
```

Types, lint, formatting and tests, which is what CI runs on every pull request. Individually:

| | |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, with warnings treated as errors |
| `npm run format` | Rewrite files with prettier |
| `npm run format:check` | Report unformatted files without changing them |

`npm test -- --coverage` reports coverage. `src/helpers` and `src/reducers` have floors set in
`package.json` just under where they stand today, so a change that guts them fails rather than
landing quietly; raise the floors as coverage grows.

### Simulate the game headlessly

```sh
npm run sim -- --all
```

Plays every scenario through the real game reducer without a browser -- a 20 year run takes about
half a second -- and checks that the economy obeyed its invariants (no NaNs, cash only moves by
recorded revenue and expenses, storage can't invent electricity, and so on). Use it to sanity
check a change to the simulation in seconds rather than by playing through the UI.

`npm run sim -- --scenario 103` reports one scenario month by month, and `npm run sim -- --help`
lists the flags. See [src/testing/README.md](src/testing/README.md) for what it checks and how it
works.

### Release checklist

To release, you'll need to install and authenticate the `aws cli`.

Before deploying to production, run `./deploy.sh` and have it deploy to beta. Then check that:

- basic functionality works (app loads, game starts, music plays)

Once functionality is verified, you can deploy prod with the same script.

### Troubleshooting

If you're trying to debug the Redux store, it's wired up to use the Dev Tool extension for advanced state debugging: https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd
