# A × C hybrid concepts

Three follow-up concepts combine **A's connected power landscape** with **C's bold,
simplified graphic style**. All three retain the town, transmission pylon, hydro,
wind, solar, and power station, and use the same existing Electrify wordmark.

| Variant                                               | Composition                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [1 — Connected landscape](01-connected-landscape.png) | Closest to A's composition: prominent blue pylon and a compact connected landscape.               |
| [2 — Powering the town](02-powering-the-town.png)     | A larger town becomes the focal point; the infrastructure is smaller and more evenly balanced.    |
| [3 — Grid in silhouette](03-grid-in-silhouette.png)   | Closest to C's reduction: bold navy silhouettes on a broad ivory ribbon, with the fewest details. |

Open [the comparison gallery](review.html) to view the options together. Each concept
preserves the complete 1536 × 1024 illustration for choosing a direction before
framing its individual Steam upload formats.

The built-in ImageGen tool created the text-free illustrations. `sources/` contains
the original outputs and editable SVG compositions; [generation.json](generation.json)
records the three prompts and reference images. Branding is rendered from the
existing SVG wordmark, without its tagline.

Regenerate the branded previews and gallery from the repository root:

```sh
node steamworks/artwork/hybrids/export.cjs
```

The exporter decodes each source image and verifies the output dimensions. It also
records checksums in `manifest.json`. These follow-up concepts are separate from
the original coordinated artwork set documented in [the parent upload map](../README.md).
