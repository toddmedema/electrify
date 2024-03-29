# Electrify

A mobile-friendly web game that teaches about the electricity markets in the style of a Tycoon game. Hosted at https://electrifygame.com

## Getting Started

### Requirements

Requires NodeJS v12. Check your version with `node -v`.

We recommend using [NVM](https://github.com/creationix/nvm) to install Node to make it easier to swap between and upgrade Node versions.

Windows: must be run within a Unix-like shell (such as Git Bash).

If you're having problems getting dependencies set up on your computer, try using this repo with [Containerizer](https://github.com/Fabricate-IO/containerizer).

### Getting started & Development workflow

With Node.js installed, run the following from the root of the repository:

```sh
npm install -g webpack@^4 yarn && yarn
```

#### Serve / watch

```sh
yarn start
```

This runs the app at [http://localhost:8080](http://localhost:8080) (port may be different if you're using [Containerizer](https://github.com/Fabricate-IO/containerizer)). It also outputs an IP address you can use to locally test and another that can be used on devices connected to your network.

#### Run tests

```sh
yarn test
```

This runs the unit tests defined in the `app/test` directory, as well as anything with the `.test.tsx` extension and `scripts/meta_tests.js`.

Tests require Java JDK 7 or higher. To update Java go to http://www.oracle.com/technetwork/java/javase/downloads/index.html and download ***JDK*** and install it.

Tests require Chrome. Please make sure you have the Chrome browser installed and up-to-date on your system.

#### Release checklist

Before deploying to production, run `./beta.sh` to deploy to beta. Then check that:

- basic functionality works (app loads, game starts, music plays)

Once functionality is verified, you can deploy prod with `./scripts/prod.sh`.

#### Build for Web

```sh
webpack --config ./webpack.dist.config.js
```

Notes:
- web files are output in the www/ folder. Can host locally for quick double checking via `python -m SimpleHTTPServer 5000` from www/.

#### Troubleshooting

If you're having trouble with UglifyJS when running `webpack -p`, try removing webpack's dependence on uglify-js and letting the dev-dependency version be used (see [here](https://github.com/mishoo/UglifyJS2/issues/448)).

If you're trying to debug the Redux store, it's wired up to use the Dev Tool extension for advanced state debugging: https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd
