# Steam store artwork

These capsules extend Electrify’s existing flat, outlined facility icons. The power-system
scene is authored in `public/images/power-system.svg`; the title is derived from the original
`public/images/logo-home.svg` wordmark, with its final marketing-tagline path removed. No
external illustrations, fonts, or AI-generated assets are used.

In-game briefings also use three companion SVGs in `public/images/`: frozen infrastructure for
Deep Freeze, city/data-center development for the authored Rapid growth family, and changing
generation for the Energy transition family. Other missions keep the connected-grid fallback;
their existing scenario icons remain the identifying feature. These thematic illustrations do
not represent a live fleet or alter scenario inputs. The title screen and Steam capsules keep
the common connected-grid composition.

After `npm ci`, run `node scripts/export-steam-art.js`. The script uses the lockfile’s
Playwright Chromium to regenerate the title-only logo, self-contained capsule SVGs, and PNGs:

| File | Pixels | Use |
| --- | --- | --- |
| `header.png` | 920 × 430 | Store header capsule |
| `small.png` | 462 × 174 | Store small capsule |
| `main.png` | 1232 × 706 | Store main capsule |
| `vertical.png` | 748 × 896 | Store vertical capsule |

The small capsule puts the title first and reduces scenery so the name remains readable at
Steam’s 120 × 45 preview. The vertical composition rearranges
the same turbine, solar, tower, and home silhouettes for a portrait layout. All four contain only
the title and artwork. PNGs are ready to upload;
the SVGs remain editable sources and are tracked with Git LFS, like the game’s other artwork.

Dimensions and content restrictions were checked against Valve’s [standard graphical
assets](https://partner.steamgames.com/doc/store/assets/standard) and [graphical asset
rules](https://partner.steamgames.com/doc/store/assets/rules). These are store capsules,
not gameplay screenshots or library artwork. Preview the exports before uploading after any
source changes; the export script intentionally stops if the original logo’s path structure changes.
