# Inter 4.1

Unmodified variable WOFF2 files from the [official Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1), downloaded from `https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip`.

Copyright (c) 2016 The Inter Project Authors. Licensed under the SIL Open Font License 1.1; the complete license is included as `LICENSE.txt`. Keep it with these fonts in every distribution.

SHA-256:

- `InterVariable.woff2`: `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`
- `InterVariable-Italic.woff2`: `e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a`

The hashed Latin subset of the upright face is preloaded; the complete upright face remains an on-demand fallback for other scripts. The subset preserves the original weights, optical sizing, layout features and metrics. The original upright file is unchanged; italic loads only when used. MUI, plain HTML and chart canvases share this family. No external font service is needed at runtime. When updating the font, verify dense gameplay values and construction cards at desktop, 390 px and 360 px widths, including both themes.


The Latin subset is generated from the original 4.1 upright font using fontTools 4.61.1
and Brotli 1.2.1; run `python scripts/site/subset-fonts.py` with that environment to reproduce it.
The script prints its content-hashed filename and SHA-256. Update the preload and
`@font-face` references when the generated hash changes. The derived subset is also
covered by the bundled SIL Open Font License. The original files above remain available.

- `InterVariable-latin.f222662c.woff2`: `f222662c323be3ba6a285e75427c8d992007b4243381a7b2aa00ca28fd26fd18` (153,936 bytes).
