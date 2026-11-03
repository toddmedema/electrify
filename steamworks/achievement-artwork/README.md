# Steam achievement icons

`uploads/` contains an achieved color icon and an unachieved grayscale icon for
every entry in `src/achievements/AchievementCatalog.json` (36 achievements, 72 PNGs).
`upload-map.json` maps stable Steam API names to both files, English display copy,
the original SVG and its SHA-256 digest. These reuse the game's existing artwork.

In Steamworks, open Stats & Achievements → Achievements → Upload, then upload the
PNG files from `uploads/`. The `API_NAME_ACHIEVED.png` and
`API_NAME_UNACHIEVED.png` names match Valve's bulk icon assignment convention.
The map is a review manifest, not a Steam definitions CSV; `achievement-stats.csv`
in the parent directory separately defines progress stats. Configure the matching
achievement definitions/API names before uploading icons, review assignments, then
publish the Steamworks changes.

Valve recommends square 256 × 256 PNGs (64 × 64 minimum); these are exactly
256 × 256, opaque, with a neutral background so black icon outlines remain legible
in Steam's light and dark contexts. Locked icons preserve the same silhouette in
grayscale. See the official
[achievement setup and icon instructions](https://partner.steamgames.com/doc/features/achievements/ach_guide)
(checked October 21, 2026).

With Node 24, the locked `npm ci` install, real Git LFS assets and Playwright
Chromium installed, regenerate from the repository root:

```powershell
npm run achievements:artwork
npm run achievements:artwork -- --check
```

On this machine, point `PLAYWRIGHT_BROWSERS_PATH` to the shared Playwright cache if
needed. Rendering is headless. The exporter verifies all decoded PNGs, grayscale,
opaque backgrounds, artwork presence, dimensions, catalog coverage and source
digests. Review `.tmp/achievement-review/index.html`, `full.png` and `small.png`
before committing uploads: full-size icons and 40–48 px previews on both light and
dark surfaces. Review files are temporary and are not part of the upload package.
