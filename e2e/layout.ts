import { expect, Locator, Page } from "@playwright/test";

/**
 * Whether the app renders its game panes side by side at this page's viewport.
 *
 * Mirrors isPaneLayout() in src/Globals. The tutorial's navigation steps advance on their
 * own in that layout but wait for a tap in single-pane mode, so the specs that walk a
 * walkthrough must know which flow they are in rather than assume it from the project name.
 */
export function isPaneLayout(page: Page): boolean {
  const { width, height } = page.viewportSize()!;
  if (width >= 1024) {
    return true;
  }
  const aspectRatio = width / height;
  return (
    width >= 700 &&
    height >= 600 &&
    aspectRatio >= 4 / 5 &&
    aspectRatio <= 5 / 4
  );
}

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
 * Wait for a card transition to settle, so a selector that matches in both the outgoing
 * and the incoming layout resolves to its single copy.
 *
 * The compositor keeps the outgoing card mounted while its exit animation runs (about 300 ms),
 * so a control that exists in both layouts -- the bottom navigation buttons, the rate slider --
 * is present twice in that window. Strict assertions and clicks on such a selector fail mid
 * transition; waiting for the count to reach one makes them deterministic.
 */
export async function waitForSettled(
  page: Page,
  selector: string,
  description?: string,
): Promise<void> {
  await expect(
    page.locator(selector),
    description ?? `exactly one ${selector} after the card transition settles`,
  ).toHaveCount(1);
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
