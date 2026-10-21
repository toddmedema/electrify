# Release notices and asset provenance

Audit date: October 21, 2026. This records repository evidence, not a declaration
that private contributor agreements or third-party permissions have been obtained.

`scripts/generate-notices.js` runs before the web start/build and desktop build.
It produces the ignored `public/notices.json`, consumed by Settings → Credits and
licenses. The desktop build also copies Electron's original
`LICENSES.chromium.html`; the dialog extracts its attribution as inert local text
when requested. Electron's original runtime notices and webpack's generated
JavaScript license notices remain in their normal packaged locations.
`LICENSE.md` is also explicitly included in the packaged app. Notices do not make
network requests and remain readable in the installed desktop game offline.

## Software

- Game: the exact root `LICENSE.md` (MIT License with Commons Clause), including
  Todd Medema's copyright. About, Privacy and Data Centers use the same name.
- Runtime npm dependencies: installed versions must match `package-lock.json`.
  The generator collects original LICENSE, COPYING, COPYRIGHT and NOTICE files,
  including nested vendor notices, excluding separately enumerated node_modules.
  Dependencies used only for development are excluded. Koffi's native slices are
  grouped under their parent project's notice on every build platform. Other optional
  native dependencies absent on the build platform are omitted. The
  universal Mac packaging path installs both Koffi slices before generating its
  desktop notices. Missing required packages or redistribution terms fail the
  build rather than silently dropping attribution.
- Firebase packages omit the repository license from their npm tarballs.
  `firebase-LICENSE.txt` is the unchanged license fetched from the official
  [firebase@12.18.0 release](https://raw.githubusercontent.com/firebase/firebase-js-sdk/firebase%4012.18.0/LICENSE).
  It includes Apache 2.0 and the protobuf BSD 3-Clause notice. Only packages named
  `firebase` or `@firebase/*` with Apache-2.0 metadata use this fallback; the
  generator also retains their compiled copyright/license comment blocks.
- Koffi platform packages omit a separate LICENSE; their MIT metadata and README
  identify them as Koffi's binary slices. They use the original notice from their
  installed, pinned parent `koffi` package, including vendor notices. All locked
  slice versions must match the parent. Consolidating their common notice keeps
  a shared desktop renderer's attribution identical across build platforms.
- Electron: exact runtime LICENSE and Chromium third-party notices from the
  installed version. The game does not replace them or classify Chromium under
  the game's license.
- Steamworks.js: its original MIT notice is collected. Valve's proprietary SDK
  runtime is not MIT; its distribution relies on the developer's Steamworks
  agreement. Account/App ID configuration and publication remain release tasks.

## Asset and data coverage

| Shipped source / category                                                                                    | Evidence and retained attribution                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/fonts/inter/*`                                                                                       | Original SIL OFL 1.1 and Inter Project Authors notice, already beside fonts and also included in consolidated notices.                                                                                                                                                                                                 |
| `public/images/*`, including facility/scenario icons, app logos/icons, manual diagrams and gameplay previews | Existing About credits identify Chris Gebhart for art, without a per-file rights ledger. Preserve that credit; do not infer every image's creator from it. No additional asset-specific license files were found in these directories.                                                                                 |
| `public/audio/basic/*.mp3`, `public/audio/intro/intro.mp3`                                                   | Existing About credits identify Nicholas Coronado for music. Source files arrived with the CRA migration (`2d4898fc`). No per-track license/permission document was found.                                                                                                                                             |
| `public/audio/menu/{select,back,confirm}.wav`                                                                | Added by desktop integration commit `d6b3b1de`. No creator/source or separate license notice is recorded in the repository.                                                                                                                                                                                            |
| `public/audio/menu/quiet-current.wav`                                                                        | Added by menu music commit `4b31e614`. No creator/source or separate license notice is recorded in the repository.                                                                                                                                                                                                     |
| `steamworks/artwork/sources/*` and its derived marketing exports                                             | Existing artwork README records ImageGen generation/editing and reuse of the original wordmark/app icon. Marketing files stay outside the game depot. Existing artwork provenance applies to reused wordmark/icon inputs; do not infer additional artist permissions.                                                  |
| `steamworks/achievement-artwork/uploads/*`                                                                   | Deterministic rasterizations of the exact existing SVGs listed and hashed by `upload-map.json`. No new art or third-party imagery. Existing source-art provenance applies.                                                                                                                                             |
| `public/data/weather/*`                                                                                      | Open-Meteo / Copernicus ERA5 CC BY 4.0 credit, provider links and unit/packing/derived-game modifications; NASA POWER acknowledgement for catalogue overrides and curated upstream watersheds. Source overrides remain in `data/weather/index.json`.                                                                   |
| Derived plant ages, renewable ages, hydro sites and regional power mix                                       | WRI GPPD, Ember and De Felice/contributors' European hydro CC BY 4.0 attribution, license URLs, exact revisions where pinned and description of filters/aggregations/modeling. EIA and IRENA source credits retained. Original references and detailed modeling changes remain in the repository's research documents. |

The player-facing source credits and modifications are in `asset-notices.json`.
Primary references for weather obligations:
[Open-Meteo historical data](https://open-meteo.com/en/docs/historical-weather-api),
[Open-Meteo data licensing](https://open-meteo.com/en/terms), and
[NASA POWER](https://power.larc.nasa.gov/). Existing detailed data citations are in
`docs/starting-facility-ages.md`, `docs/hydro-sites.md` and
`docs/data-center-power-sources.md`.

## Remaining evidence for the release owner

Confirm that the original art/music contributor arrangements cover commercial
Steam distribution, all target platforms and the game's marketing/achievement
derivatives. The repository's contributor names and game source license alone do
not establish those private arrangements. Record the creator/source and the
commercial distribution basis for the four menu WAVs, and resolve any asset that
the original art/music credits do not cover. Keep the applicable agreements or
receipts with release records; do not publish private contracts in this repository.

The Open-Meteo data license allows commercial redistribution with attribution;
its free API endpoint is for noncommercial use. Existing packed data is shipped
offline. Before regenerating weather for commercial operations, the release owner
must choose the applicable API plan or another permitted access route. This audit
does not establish the historical API account terms or private download records.
