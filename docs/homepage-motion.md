# Homepage motion proposal

Give the logo and main action a short entrance when the homepage first appears. The
page should then become still, leaving **Start playing** or **Continue** as its
focus.

## Proposed sequence

- Logo: fade from 0 to full opacity while moving upward 4 px over 280 ms, using
  ease-out. Preserve its existing SVG artwork and layout dimensions.
- Subtitle and primary actions: the same entrance over 220 ms, beginning 60 ms
  after the logo. Animate their shared wrapper so the buttons stay aligned.
- Resources and footer: remain still. Use the existing button hover and focus
  treatments; do not add looping pulses, drifting backgrounds, or sound.

The sequence ends within 340 ms. Controls remain interactive throughout, with no
focus movement, delayed mounting, or layout shift. If the user starts interacting
before the entrance finishes, finish the entrance immediately so a focused control
is fully visible.

## Accessibility and repeat visits

Use `prefers-reduced-motion: reduce` to show the final state immediately. Play the
entrance once per browser session; returning from Settings, How to play, or a game
should reveal the homepage immediately. Storage failure must also fall back to a
fully visible page. Keep the final visible state as the CSS default, so a missing
animation or disabled JavaScript cannot hide the controls.

## Validation before implementation

Review the entrance on desktop and 390 px and 320 px phones, in both themes. Check
reduced motion, keyboard focus during the entrance, immediate clicking, returning
from another screen, and a background-tab restore. The logo and buttons must keep
their existing positions and hit areas.

This is a proposal only. The QA changes do not enable homepage animation.

## Related flow-bar design

Keep generator, storage, and intertie magnitude bars filling from the left. Moving
reverse flow to the right loses its direction cue when the bar fills the row.
The existing reverse-flow hatch remains identifiable at full width and does not
rely on color alone. Pair it with the existing charging/discharging storage labels
and signed intertie reading; preserve the importing/selling wording in the
intertie button's accessible name. Do not animate the hatch: direction and amount
should remain readable while the player compares rows.
