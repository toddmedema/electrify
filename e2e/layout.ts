import { expect, Locator, Page } from "@playwright/test";

/** Google sign-in and its optional consent remain usable at every supported width. */
export async function expectMailingListChoice(
  scope: Page | Locator,
  buttonName = "Sign in with Google",
) {
  const checkbox = scope.getByRole("checkbox", {
    name: "Join the Electrify mailing list",
  });
  const button = scope.getByRole("button", { name: buttonName, exact: true });
  await expect(checkbox).toHaveCount(1);
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await expect(button).toBeVisible();
  await expect(
    scope.getByRole("button", { name: "Sign in with Apple", exact: true }),
  ).toHaveCount(0);
  for (const control of [checkbox.locator("xpath=ancestor::label"), button]) {
    const geometry = await control.evaluate((element) => {
      const { x, width, height } = element.getBoundingClientRect();
      return {
        x,
        width,
        height,
        viewportWidth: window.innerWidth,
        minimumHeight: matchMedia("(pointer: coarse)").matches ? 44 : 40,
      };
    });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(
      geometry.viewportWidth + 1,
    );
    expect(geometry.height).toBeGreaterThanOrEqual(geometry.minimumHeight);
  }
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

/** Choose a build sort order through the desktop select or compact sort menu. */
export async function sortBuildCatalog(
  page: Page,
  order = "Build time",
): Promise<void> {
  const select = page.getByRole("combobox", {
    name: "Sort facilities",
    exact: true,
  });
  const compact = page.getByRole("button", { name: /^Sort facilities:/ });
  await expect(
    select.or(compact).filter({ visible: true }).first(),
  ).toBeVisible();
  if (await select.isVisible()) {
    await select.click();
    await page.getByRole("option", { name: order, exact: true }).click();
    await expect(select).toContainText(order);
  } else {
    await compact.click();
    await page.getByRole("menuitem", { name: order, exact: true }).click();
    await expect(compact).toHaveAttribute(
      "aria-label",
      `Sort facilities: ${order}`,
    );
  }
}

/** Move the generator ahead of storage using the same grip and drag sensors as a player. */
export async function dragCoalAbovePumpedHydro(page: Page) {
  const handle = page.getByRole("button", {
    name: "Reorder Coal",
    exact: true,
  });
  const row = page.locator('.facilityRow[data-facility="Coal"]');
  await handle.scrollIntoViewIfNeeded();
  const from = (await handle.boundingBox())!;
  const to = (await page
    .getByRole("button", { name: "Reorder Pumped Hydro", exact: true })
    .boundingBox())!;
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  const destination = to.y + to.height / 2;
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await expect(row).toHaveClass(/dragging/);
    for (let step = 1; step <= 10; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + ((destination - y) * step) / 10 }],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 8, { steps: 2 });
    await expect(row).toHaveClass(/dragging/);
    await page.mouse.move(x, destination, { steps: 10 });
    await page.mouse.up();
  }
}
