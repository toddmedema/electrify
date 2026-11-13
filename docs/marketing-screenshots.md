# Marketing screenshots

Seven gameplay captures cover the repository's marketing and SEO uses:

- `public/images/gameplay-preview.png` is the 1200 × 630 shared image for the
  README, the power-grid simulator landing page, Open Graph and Twitter cards,
  and structured data on the home and generated scenario pages.
- `steamworks/artwork/screenshots/01-grid-overview-dark.png` through `06-*.png`
  are the six 1920 × 1080 Steam uploads, in order: fleet and forecasts, generator
  comparison, storage planning, customer programs, intertie trading, and weather.

These are real, paused game views. Steam captures use a 1440 × 810 logical
viewport at 4/3 device scale; the SEO image uses 1200 × 630 at device scale 1.
The scenes include both themes and use normal player controls. The intertie
scene starts Wildfire Emergency with its existing operating link. The manual
illustrations, app icons, Steam capsule illustrations and achievement artwork
are separate assets, not UI screenshots.

## Refreshing the set

Use Node 26, the lockfile's installed dependencies, real LFS assets, and
Playwright Chromium. Claim the checkout as described in
[development workflow](development-workflow.md), then start the current checkout:

```sh
BROWSER=none npm start
```

In another terminal in the same checkout:

```sh
npm run shot -- --marketing
```

The command finds this checkout's reserved server. It writes a staging tree
under `.tmp/marketing/`, leaving tracked images untouched. `--out <directory>`
changes that staging root; `--base-url <origin>` explicitly selects another
server. Other screenshot options cannot override the authored marketing scenes.

Review all seven images for legibility, framing, finished charts, transient
messages and unintended overlays, then copy the approved captures:

```sh
cp .tmp/marketing/public/images/gameplay-preview.png public/images/gameplay-preview.png
cp .tmp/marketing/steamworks/artwork/screenshots/*.png steamworks/artwork/screenshots/
npm run check:assets
```

The existing paths preserve every SEO reference and its declared dimensions.
Images are stored with Git LFS. Stop the preview server when finished. Updating
these repository files does not upload the six images to Steamworks.

The scene inventory lives in `e2e/marketing-scenes.ts`; the capture runner in
`e2e/marketing.run.ts` reuses the normal browser fixtures and navigation helpers.
It waits for charts and fonts and checks PNG dimensions before writing a file.
It runs only through `shot --marketing`, outside the normal browser test matrix.
Weather and economic values vary between fresh games; this is a UI capture
workflow, not a pixel baseline.
