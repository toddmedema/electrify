# Steam artwork

Upload the files in `uploads/` and `screenshots/` to the slots below. The artwork
uses the selected Connected landscape style and low-angle text-free library hero.

| Steamworks slot                             | File                                      | Pixels                  |
| ------------------------------------------- | ----------------------------------------- | ----------------------- |
| Store header capsule **and library header** | `uploads/store-header.png`                | 920 × 430               |
| Store small capsule                         | `uploads/store-small.png`                 | 462 × 174               |
| Store main capsule                          | `uploads/store-main.png`                  | 1232 × 706              |
| Store vertical capsule                      | `uploads/store-vertical.png`              | 748 × 896               |
| Library capsule                             | `uploads/library-capsule.png`             | 600 × 900               |
| Library hero                                | `uploads/library-hero.png`                | 3840 × 1240             |
| Library logo                                | `uploads/library-logo.png`                | 1280 × 299; transparent |
| Shortcut icon                               | `uploads/shortcut-icon.png`               | 512 × 512               |
| Mac shortcut icon                           | `uploads/mac-icon.icns`                   | 16–1024; multiple sizes |
| App icon                                    | `uploads/app-icon.jpg`                    | 184 × 184               |
| Gameplay screenshots                        | `screenshots/01-*.png` through `06-*.png` | 1920 × 1080 each        |

The two header slots share the same image. Steam generates the Windows ICO from
the shortcut PNG; upload the ICNS separately for branded macOS shortcuts.
Upload the white library logo separately and position it over the dark lower-left
foreground using Steamworks' preview. The hero's centered 860 × 380 crop retains
recognizable town and electricity infrastructure; the large foreground pylon is
intentionally cropped at the edge. The small capsule is legible at 120 × 45 and
184 × 69.

Upload screenshot 01 first. The six images show the grid overview, generator
comparisons, storage choices, customer programs, interties and weather forecasts.
They are unretouched captures of the current game at a 1440 × 810 logical viewport
with a 4/3 device scale factor, producing 1920 × 1080 PNGs with readable controls.
They show the dock, side-by-side tools, generator comparison, lithium battery
details, pricing and demand programs, an operating intertie, and temperature and
water forecasts. There are no marketing overlays or debug UI.

Run `npm start`, then `npm run shot -- --marketing` in another terminal to refresh
all six screenshots and the shared SEO/social preview. Review the staged images
before copying them into the tracked paths; see
[marketing screenshots](../../docs/marketing-screenshots.md) for the full workflow.

## Updating artwork

`sources/` contains the five text-free illustration masters used by the exporter
and the original Electrify wordmark without its tagline. The illustrations were
created and edited with the built-in ImageGen tool. The app icon comes from
`public/images/icon/1024x1024.png`.

With Node 26, `npm ci` and Playwright Chromium installed, regenerate the exact-size
uploads from the repository root:

```sh
node steamworks/artwork/export.cjs
```

The script renders the logo from its SVG geometry, checks output dimensions and
decodes source images. It also checks the gameplay screenshots' dimensions. The
hero is resampled from its native generated master; the export crop excludes the
tool's narrow outer padding. Layouts and crop settings live in the exporter.

Images use Git LFS; fetch their real bytes before exporting or uploading. These
marketing assets stay outside `public/` so they are excluded from the game's
runtime cache and desktop depot. Steamworks upload, logo placement and Valve
store-page review remain release steps.

Sizes checked October 16, 2026:
[store artwork and screenshots](https://partner.steamgames.com/doc/store/assets/standard),
[library artwork](https://partner.steamgames.com/doc/store/assets/libraryassets),
[client icons](https://partner.steamgames.com/doc/store/assets/community),
[artwork rules](https://partner.steamgames.com/doc/store/assets/rules).
