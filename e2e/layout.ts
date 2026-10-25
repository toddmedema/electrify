import { expect, Locator, Page } from "@playwright/test";

/** Both providers must remain equal, usable columns at every supported width. */
export async function expectSignInButtonsToFit(scope: Page | Locator) {
  const google = scope.getByRole("button", {
    name: "Sign in with Google",
    exact: true,
  });
  const apple = scope.getByRole("button", {
    name: "Sign in with Apple",
    exact: true,
  });
  // Card transitions briefly mount the outgoing and incoming screens together.
  await expect(google).toHaveCount(1);
  await expect(apple).toHaveCount(1);
  await expect(google).toBeVisible();
  await expect(apple).toBeVisible();
  // A leaderboard response can move the entire row between protocol calls. Read both
  // controls in one browser task so their geometry describes the same layout state.
  const layout = await scope
    .getByRole("group", { name: "Sign in", exact: true })
    .evaluate((group) => ({
      buttons: Array.from(group.querySelectorAll("button")).map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return {
          name: button.getAttribute("aria-label"),
          x,
          y,
          width,
          height,
          overflow: button.scrollWidth - button.clientWidth,
        };
      }),
      viewportWidth: window.innerWidth,
      minimumHeight: matchMedia("(pointer: coarse)").matches ? 44 : 40,
    }));
  expect(layout.buttons.map((button) => button.name)).toEqual([
    "Sign in with Google",
    "Sign in with Apple",
  ]);
  const [a, b] = layout.buttons;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  expect(a.height).toBeGreaterThanOrEqual(layout.minimumHeight);
  expect(a.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(layout.viewportWidth + 1);
  for (const button of layout.buttons)
    expect(button.overflow).toBeLessThanOrEqual(1);
}

/**
 * Tools open deliberately from the dock at every width. Keep this compatibility helper for
 * existing walkthrough specs: a wide screen no longer opens Insights and Events automatically.
 */
export function isPaneLayout(_page: Page): boolean {
  return false;
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
 * Open the Build tool from the dock, leaving it open when it already is: the dock button
 * toggles, so a second click would close it. Returns the Build region.
 */
export async function openBuild(page: Page): Promise<Locator> {
  const build = page.getByRole("region", { name: "Build", exact: true });
  if (!(await build.isVisible())) await page.locator("#buildNav").click();
  await expect(build).toBeVisible();
  return build;
}

/**
 * Show a game tool, opening it from the dock when it is closed.
 * Returns whether the nav button was clicked.
 */
export async function openPane(
  pane: Locator,
  navButton: Locator,
): Promise<boolean> {
  await waitForPaneOrNav(pane, navButton);
  const visiblePane = pane.filter({ visible: true });
  if ((await visiblePane.count()) > 0) {
    // Facilities stays mounted behind the tools. Returning to the fleet means closing the
    // sheets covering it, including pinned tools, before a caller tries its row actions.
    if (
      await visiblePane
        .first()
        .evaluate((element) => element.classList.contains("facilities"))
    ) {
      // A phone keeps a tool it switched away from mounted but hidden; only visible
      // sheets cover the fleet.
      const closes = pane
        .page()
        .locator(".gameToolHeader button[aria-label^='Close ']")
        .filter({ visible: true });
      while ((await closes.count()) > 0) await closes.first().click();
    }
    return false;
  }
  await navButton.filter({ visible: true }).first().click();
  await expect(visiblePane.first()).toBeVisible();
  return true;
}

/** Open the saved-game library from the menu and wait for its screen. */
export async function openSavedGames(page: Page) {
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Saved games", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved games", exact: true }),
  ).toBeVisible();
}
