import { expect, Locator } from "@playwright/test";

/**
 * Wait until the game layout has rendered either a pane or its nav button.
 *
 * The layout renders its panes a moment after "Start game". A one-shot visibility probe in
 * that window cannot tell "not mounted yet" from "this width does not render the pane", and
 * wide layouts render no navigation button at all -- so a fallback click then waits for a
 * button that will never appear and burns the test's whole timeout.
 *
 * Both locators are narrowed to visible matches here, so callers may pass either form. The
 * pane and its nav button can be visible at once (single-pane mode keeps the bottom bar under
 * an open pane, and mid-width layouts render both), and a card transition briefly mounts two
 * of each, so nothing here asks a locator for a single element.
 */
export async function waitForPaneOrNav(
  pane: Locator,
  navButton: Locator,
): Promise<void> {
  await expect(
    pane
      .filter({ visible: true })
      .or(navButton.filter({ visible: true }))
      .first(),
    "the game layout should render the pane or its nav button",
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Show a game pane, opening it from the bottom navigation only when this width needs to.
 * Returns whether the nav button was clicked.
 */
export async function openPane(
  pane: Locator,
  navButton: Locator,
): Promise<boolean> {
  await waitForPaneOrNav(pane, navButton);
  const visiblePane = pane.filter({ visible: true });
  if ((await visiblePane.count()) > 0) {
    return false;
  }
  await navButton.filter({ visible: true }).first().click();
  await expect(visiblePane.first()).toBeVisible();
  return true;
}
