# Electrify

A mobile-friendly tycoon game about electricity markets. Play it at
[electrifygame.com](https://electrifygame.com).

## Getting started

### Setup

Requires Node.js 24. Check your version with `node --version`.

Using a version manager such as [nvm](https://github.com/nvm-sh/nvm) makes it easier to switch
between Node versions.

Development commands work in standard Windows, macOS, and Linux shells. The deployment script
requires a POSIX-compatible shell such as Git Bash.

With Node.js installed, run the following from the root of the repository:

```sh
npm ci
```

To use the online high score capabilities, you will need to contact an admin to get a Firebase api key.

### Serve and watch

```sh
npm start
```

This runs the app at [http://localhost:3000](http://localhost:3000).

### Run tests

```sh
npm test
```

This starts Jest in watch mode. Test files use the `.test.ts` or `.test.tsx` suffix.

### Check everything

```sh
npm run check
```

Types, lint, formatting and tests, which is what CI runs on every pull request. Individually:

| Command                | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `npm run typecheck`    | `tsc --noEmit`                                 |
| `npm run lint`         | ESLint, with warnings treated as errors        |
| `npm run format`       | Rewrite files with prettier                    |
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
lists the flags. See [the simulation guide](src/testing/README.md) for what it checks and how it
works.

### Add a city to play in

Every location is a single file in `public/data/weather`: forty years of hourly readings for the
twelve days a year the game actually simulates, packed into 57KB. Whichever cities have been
downloaded are exactly the ones the custom game screen offers - `public/data/weather/index.json`
is written by the same script and is what the picker reads.

```sh
npm run fetch-weather -- --list
```

lists the 282 cities in `scripts/cities.json` and marks the ones already downloaded; naming some
of them fetches them, and naming none fetches everything still missing:

```sh
npm run fetch-weather -- Tokyo Nairobi Reykjavik
```

The data is ERA5 reanalysis from the [Open-Meteo archive
API](https://open-meteo.com/en/docs/historical-weather-api), which is free and needs no key but
rate limits to roughly ten cities an hour and twenty a day. The script paces itself against that,
writes each city out as it finishes and skips whatever is already on disk - so filling in the rest
of the catalogue is a matter of running it again tomorrow rather than leaving it running.

To add somewhere that isn't listed, add it to `scripts/cities.json` and fetch it. An `id` ends up
in save games and replays, so it can never be changed afterwards; everything else can.

### Release checklist

To release, install and authenticate the AWS CLI.

Before deploying to production, run `./deploy.sh` and have it deploy to beta. Then check that:

- basic functionality works (app loads, game starts, music plays)

Once functionality is verified, you can deploy prod with the same script.

### Troubleshooting

The app supports the [Redux DevTools browser
extension](https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd)
for inspecting application state.
