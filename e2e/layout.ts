import { expect, Locator, Page } from "@playwright/test";

/**
 * Wait for the game's layout to settle after a start or card transition.
 *
 * The layout renders its panes a moment after "Start game". A one-shot visibility probe in
 * that window cannot tell "not mounted yet" from "this width does not render the pane", and
 * wide layouts render no navigation button at all -- so the usual fallback click then waits
 * for a button that will never appear and burns the test's whole timeout. Wait for whichever
 * of the pane or its nav button this width renders; afterwards the caller's probe-and-click
 * is reliable.
 *
 * The pane and its nav button can both be visible at once (single-pane mode keeps the bottom
 * bar under an open pane, and mid-width layouts render both), so a strict-mode assertion on
 * the union would throw. Poll non-strictly instead: `count()` never enforces strict mode, and
 * a pane locator without `:visible` counts DOM presence, which is enough -- once the layout
 * has mounted, the caller's probe-and-click distinguishes "hidden" from "absent at this
 * width" on its own.
 */
export async function waitForPane(
  page: Page,
  pane: Locator,
  navButton: Locator,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await pane.count()) > 0 || (await navButton.first().isVisible()),
      { timeout: 30_000 },
    )
    .toBe(true);
}
