# Electrify

Build power plants, keep the lights on, and make your grid cleaner. Electrify is a
mobile-friendly tycoon game about electricity markets, where weather, fuel prices,
and unexpected events put your plans to the test.

**[Play Electrify](https://electrifygame.com)** in your browser, on desktop or mobile.

![Electrify gameplay: a fleet of power plants, supply and demand forecasts, and upcoming events](public/images/gameplay-preview.png)

## Run locally

Install **Node.js 24** and **[Git LFS](https://git-lfs.com/)**, then:

```sh
git clone https://github.com/toddmedema/electrify.git
cd electrify
git lfs install
git lfs pull
npm ci
npm run check:assets
npm start
```

Open [localhost:3000](http://localhost:3000). The app reloads as you edit.
Online accounts and leaderboards need a Firebase API key from a maintainer; see
[setup notes](CONTRIBUTING.md#setup-notes).

## Start contributing

There are plenty of ways to help: tune game balance, write a scenario, improve a
tutorial, fix a bug, or make the interface easier to use.

- [Browse issues](https://github.com/toddmedema/electrify/issues) to find work or
  share a bug report or idea.
- Read the [contributor guide](CONTRIBUTING.md) for a map of the code and how to
  check your changes. The app uses React 18, Redux Toolkit, and TypeScript.
- Keep your pull request focused and explain what changed and how you checked it.

For a quick feedback loop, run `npm run test:once -- <name>` for one test suite or
`npm run sim -- --scenario 103` to try a scenario without a browser.
Use `npm run check` during development and `npm run check:ci` before pushing code
changes. For prose-only Markdown changes, review the text and run `git diff --check`.

## Explore further

- [Simulation guide](src/testing/README.md): run scenarios and check game economics.
- [Mods and Steam Workshop](docs/mods.md): create and share community scenarios for
  the desktop edition.
- [Desktop and Steam](docs/desktop-steam.md): build an offline app or prepare a Steam release.
- [Weather and assets](docs/weather-and-assets.md): add cities, update weather, and
  work with icons and manual figures.
- [Releases](docs/releases.md): web deployment, version metadata, and account storage.

## License

Electrify is source available under the [MIT License with Commons Clause](LICENSE.md).
The Commons Clause is a condition on the MIT License, not an alternative license.

You can use, study, modify, and share Electrify subject to these terms. The license
does not permit selling the software as defined by the Commons Clause: providing
a product or service for a fee or other consideration whose value derives entirely
or substantially from Electrify, including paid hosting and related consulting or
support services. See the [full license](LICENSE.md) and
[Commons Clause FAQ](https://commonsclause.com/) for the scope of this restriction.

Versions containing this license notice use the combined license. Versions
previously distributed under MIT retain their MIT permissions. Third-party
components and assets with separate license notices retain their own licenses.
