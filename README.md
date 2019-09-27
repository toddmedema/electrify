# Electrify

## Getting Started

### Requirements

Requires NodeJS v6.0 or above. Check your version with `node -v`.

We recommend using [NVM](https://github.com/creationix/nvm) to install node to make it easier to swap between and upgrade Node versions in the future.

Windows: must be run within a Unix-like shell (such as Git Bash)

iOS: Building the iOS app requires a mac, and cordova setup scripts currently work for unix-like environments only (Linux + Mac).

If you're having problems getting dependencies set up on your computer, try using this repo with [Containerizer](https://github.com/Fabricate-IO/containerizer).

### Install dependencies

#### Quick-start

With Node.js installed, run the following one liner from the root of the repository:

```sh
npm install -g webpack && npm install
```

For building native apps, you will also need to set up cordova.

```sh
npm install -g cordova
./project.sh
```

### Development workflow

#### Serve / watch

```sh
npm run dev
```

This runs the app at [http://localhost:8080](http://localhost:8080) (port may be different if you're using [Containerizer](https://github.com/Fabricate-IO/containerizer)). It also outputs an IP address you can use to locally test and another that can be used on devices connected to your network.

#### Run tests

```sh
npm run test
```

This runs the unit tests defined in the `app/test` directory.

Tests require Java JDK 7 or higher. To update Java go to http://www.oracle.com/technetwork/java/javase/downloads/index.html and download ***JDK*** and install it.

Tests require Chrome. Please make sure you have the Chrome browser installed and up-to-date on your system.

#### Release checklist

Before deploying to production, run `./beta.sh` to deploy to beta and create beta versions of the Android and iOS apps. Then check that:

- app icon and splashscreen appear properly on Android and iOS. If properly configured, the icons and splashscreens WILL show up in the beta build.
- basic functionality works for all three builds (app loads, game is able to start)

#### Build for Web

```sh
webpack --config ./webpack.dist.config.js
```

Notes:
- web files are output in the www/ folder. Can host locally for quick double checking via `python -m SimpleHTTPServer 5000` from www/.

#### Build for Android

For debugging:

```sh
webpack --config ./webpack.dist.config.js && cordova build android
```

Notes and debugging:

- requires the Android SDK
- when deploying Android, you'll need to update `android-versionCode` in `config.xml`, not just `version`.

#### Build for iOS

```sh
webpack --config ./webpack.dist.config.js && cordova build ios
```

Notes and debugging:

- requires a Mac with XCode installed
- if Xcode complains about signing, try going to the project settings in Xcode, disabling automatic signing, re-enabling it, and then selecting your team again.

#### Troubleshooting builds

If you're having trouble with UglifyJS when running `webpack -p`, try removing webpack's dependence on uglify-js and letting the dev-dependency version be used (see [here](https://github.com/mishoo/UglifyJS2/issues/448)).
