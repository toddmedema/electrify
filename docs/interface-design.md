# Interface design

Guidance for UI work in Electrify, referenced from [AGENTS.md](../AGENTS.md#interface-design).

- Organize each screen around the player's next decision: one clearly dominant action, with
  navigation, account actions, and secondary controls quieter than the game state and choice in
  front of the player.
- Follow the established 4 px spacing rhythm, building common gaps and padding from 4, 8, 12, and
  16 px; keep interactive controls at least 40 px high on desktop and 44 px on coarse-pointer
  devices.
- Preserve the palette's semantic roles: electric blue means interaction, red a shortage or harmful
  state, amber warning, and green favorable change. Use the cool neutral surfaces for structure
  instead of introducing decorative colors.
- Design light and dark modes as separate contrast systems rather than mechanically inverting
  colors; use the shared theme and CSS tokens, and verify text, controls, charts, and SVGs in both
  palettes.
- Make dense information readable through hierarchy: clear headings, direct labels, restrained
  dividers, and small tonal steps between page, panel, card, selected, and chart surfaces; prefer
  these to heavy shadows, ornamental decoration, or unnecessary nested cards.
- Reflow by priority instead of shrinking the desktop composition: on phones, show one primary
  pane, abbreviate or collapse secondary controls, allow appropriate rails to scroll, and stack
  actions before they crowd. Keep charts and critical status legible; design for a minimum viewport
  width of 360 px, the narrowest common modern smartphone, and don't add short forms or layouts
  just for narrower widths.
- Never make color or an icon the only carrier of meaning: pair symbols and state colors with text,
  and distinguish chart series with direct labels, patterns, or line styles as well as color.
