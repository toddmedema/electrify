---
name: icon-design
description: Design or revise Electrify scenario and facility SVG icons. Use when creating, editing or reviewing icon artwork under public/images or the icons shown in the scenario, build and facility UI.
---

# Icon design

Read [AGENTS.md](../../../AGENTS.md) for commands and required checks. This skill holds the
icon system guidance for scenarios and facilities.

- Match the existing scenario and facility icon system: use a `0 0 500 500` SVG view box, a bold
  circular boundary where appropriate, flat fills, black outlines, and a small palette drawn from
  nearby icons. Do not use text, gradients, filters, or a one-off illustration style.
- Communicate one concept with a strong silhouette and the fewest useful shapes and anchor points.
  Build on clean circles, straight segments, and simple curves; remove incidental detail rather
  than relying on the full-size artwork to carry it.
- Use the shared stroke hierarchy exactly: `40` for the outer boundary, `20` for primary interior
  shapes, and `10` for secondary detail. Do not treat intermediate widths found in legacy icons as
  precedent or use them to compensate for imprecise geometry.
- Align geometry to deliberate centers, baselines, and axes. Use whole-number coordinates, mirror
  symmetric elements from a shared axis, keep repeated elements equal in size and spacing, and
  account for stroke extents so forms do not crowd or clip the canvas.
- Design for the icon's actual 40-48 px UI size. Review the full-size SVG and rasterized small-size
  previews on both light and dark backgrounds, checking silhouette, contrast, optical centering,
  negative-space separation, and whether fine details merge or disappear.
- Include concise SVG `<title>` and `<desc>` elements for scenario icons. Keep visible text labels
  beside icons in the interface so first-time players and assistive-technology users do not have to
  infer meaning from the artwork.
