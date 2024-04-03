# Electrify

A mobile-friendly web game that teaches about the electricity markets in the style of a Tycoon game. Hosted at https://electrifygame.com

## Getting Started

### Setup

Requires NodeJS v21+. Check your version with `node -v`.

We recommend using [NVM](https://github.com/creationix/nvm) to install Node to make it easier to swap between and upgrade Node versions.

Windows: must be run within a Unix-like shell (such as Git Bash).

With Node.js installed, run the following from the root of the repository:

```sh
npm
```

### Development Workflow: Serve & watch

```sh
npm start
```

This runs the app at [http://localhost:3000](http://localhost:3000).

### Run tests

```sh
npm test
```

This runs the unit tests defined in files with the `.test.tsx` extensio.

### Release checklist

Before deploying to production, run `./deploy.sh` and have it deploy to beta. Then check that:

- basic functionality works (app loads, game starts, music plays)

Once functionality is verified, you can deploy prod with the same script.

### Troubleshooting

If you're trying to debug the Redux store, it's wired up to use the Dev Tool extension for advanced state debugging: https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd
