# Steam artwork

The selected direction is **C — Dispatch desk**: the original Electrify wordmark,
three recognizable power sources, and crossing supply/demand curves. The complete
set was approved by two independent visual reviewers and one Steam genre reviewer
after three feedback rounds. See [review notes](review-notes.md).

## Three directions

| Option                | Main capsule                             | Direction                                                        |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| A — Grid atlas        | [Preview](options/a-grid-atlas.png)      | An illustrated grid, facilities, and a town.                     |
| B — Power portfolio   | [Preview](options/b-power-portfolio.png) | Large generation silhouettes and a dam.                          |
| **C — Dispatch desk** | [Preview](uploads/store-main.png)        | Selected; emphasizes electricity economics and facility choices. |

A and B are alternative concepts. The coordinated upload set below uses C.

## Upload map

Sizes were checked against Valve's documentation on October 15, 2026. Use the files
in `uploads/` for artwork and `screenshots/` for gameplay images. The gallery,
source SVGs, concept options, and review crops are not Steam upload slots.

| Steamworks slot           | File                                      | Pixels                  | Requirement                          |
| ------------------------- | ----------------------------------------- | ----------------------- | ------------------------------------ |
| Store header capsule      | `uploads/store-header.png`                | 920 × 430               | Required                             |
| Store small capsule       | `uploads/store-small.png`                 | 462 × 174               | Required                             |
| Store main capsule        | `uploads/store-main.png`                  | 1232 × 706              | Required                             |
| Store vertical capsule    | `uploads/store-vertical.png`              | 748 × 896               | Required                             |
| Library capsule           | `uploads/library-capsule.png`             | 600 × 900               | Required                             |
| Library header            | `uploads/library-header.png`              | 920 × 430               | Required                             |
| Library hero              | `uploads/library-hero.png`                | 3840 × 1240             | Required; text-free                  |
| Library logo              | `uploads/library-logo.png`                | 1280 × 299              | Required; transparent PNG            |
| Shortcut icon             | `uploads/shortcut-icon.png`               | 512 × 512               | Required; PNG option                 |
| Shortcut icon alternative | `uploads/shortcut-icon.ico`               | 16–256, multiple sizes  | Alternative to PNG                   |
| Mac shortcut icon         | `uploads/mac-icon.icns`                   | 16–1024, multiple sizes | Required for branded macOS shortcuts |
| App icon                  | `uploads/app-icon.jpg`                    | 184 × 184               | Required; opaque JPG                 |
| Store page background     | `uploads/page-background.png`             | 1438 × 810              | Optional                             |
| Event cover               | `uploads/event-cover.png`                 | 800 × 450               | For an event or announcement         |
| Event header              | `uploads/event-header.png`                | 1920 × 622              | Optional event header                |
| Gameplay screenshots      | `screenshots/01-*.png` through `06-*.png` | 1920 × 1080 each        | Six provided; Steam requires five    |

The white library logo is intended for the dark library hero. Upload it separately
and use Steamworks' preview to position it in the lower left. The essential hero
motif fits the centered **860 × 380** safe area. The small capsule has a dedicated
layout checked at **120 × 45** and **184 × 69**; it is not a miniature main capsule.

Upload screenshot 01 first. The remaining images show generator comparisons,
actionable 200 MWh storage choices, customer programs, interties, and the 2026–27
heatwave/drought forecast. They are unretouched captures of the real game, rendered
at a 1280 × 720 logical viewport with a 1.5 device scale factor. They contain no
marketing overlays, debug UI, account information, or synthetic gameplay.

References: [store artwork and screenshots](https://partner.steamgames.com/doc/store/assets/standard),
[library artwork](https://partner.steamgames.com/doc/store/assets/libraryassets),
[client icons](https://partner.steamgames.com/doc/store/assets/community), and
[artwork rules](https://partner.steamgames.com/doc/store/assets/rules).

## Sources and regeneration

`sources/` contains text-free raster illustrations and editable SVG compositions
with relative image references. The original logo geometry and app icon come from
`public/images/`; the logo's tagline is excluded. [generation.json](generation.json)
records every illustration prompt and the built-in ImageGen provenance.

The raster masters retain the tool's native resolution. Exact-size uploads are
rendered from the SVG layouts using Chromium; the 3840 px hero is resampled from
its smaller generated master. Typography remains vector until the final export.

Run from the repository root after `npm ci` with Node 24 and the Playwright Chromium
browser installed:

```sh
node steamworks/artwork/export.cjs
node steamworks/artwork/validate.cjs
```

Open `steamworks/artwork/review.html` locally to review all slots, actual thumbnail
sizes, transparent-logo placement, and gameplay screenshots. Validation checks real
image dimensions, decoding, transparency, checksums, and the ICO/ICNS PNG payloads.

To refresh screenshots, start the game on port 3190, then run:

```sh
node steamworks/artwork/capture.cjs
# Or recapture one numbered image:
node steamworks/artwork/capture.cjs 03
node steamworks/artwork/export.cjs
node steamworks/artwork/validate.cjs
```

Use `ELECTRIFY_CAPTURE_URL` for another local server. The capture script starts fresh
profiles, uses public game controls, pauses a real scenario, and records its visible
state in `screenshots.json`. Timing can change the exact paused hour and cash.

These marketing files live outside `public/` so they are not downloaded into the
game's offline image cache or included in the desktop depot. Images use Git LFS;
fetch their real bytes before exporting or uploading. The Steamworks account upload,
logo positioning, and Valve store-page review remain release steps.
