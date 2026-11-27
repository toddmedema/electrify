import { expect, Locator, Page } from "@playwright/test";
import { hexCenter } from "../src/components/base/TerritoryHexGeometry";

/** Both providers must remain equal, usable columns at every supported width. */
export async function expectSignInButtonsToFit(scope: Page | Locator) {
  await expectMailingListChoice(scope);
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
  const consentLayout = await scope
    .getByRole("checkbox", { name: "Join the Electrify mailing list" })
    .evaluate((checkbox) => {
      const label = checkbox.closest("label")!;
      const consent = label.getBoundingClientRect();
      const buttons = label
        .parentElement!.querySelector('[role="group"]')!
        .getBoundingClientRect();
      return {
        centerOffset:
          consent.x + consent.width / 2 - (buttons.x + buttons.width / 2),
        gap: buttons.top - consent.bottom,
      };
    });
  expect(Math.abs(consentLayout.centerOffset)).toBeLessThanOrEqual(1);
  expect(consentLayout.gap).toBeGreaterThanOrEqual(0);
  // Sharing enables sign-in after preparing its snapshot; allow transitions to settle.
  await expect(apple).toBeEnabled();
  for (const button of [google, apple]) {
    await expect(button).toHaveClass(/MuiButton-outlined\b/);
    await expect(button).toHaveClass(/MuiButton-colorPrimary\b/);
    await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(button.locator("svg")).toBeVisible();
  }
  await expect
    .poll(() =>
      scope
        .getByRole("group", { name: "Sign in", exact: true })
        .evaluate((group) => {
          const colors = Array.from(group.querySelectorAll("button")).map(
            (button) => {
              const style = getComputedStyle(button);
              return [
                style.color,
                style.backgroundColor,
                style.borderColor,
              ].join(";");
            },
          );
          return new Set(colors).size;
        }),
    )
    .toBe(1);
  // A leaderboard response can move the entire row between protocol calls. Read both
  // controls in one browser task so their geometry describes the same layout state.
  const layout = await scope
    .getByRole("group", { name: "Sign in", exact: true })
    .evaluate((group) => ({
      buttons: Array.from(group.querySelectorAll("button")).map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        const icon = button.querySelector("svg")!.getBoundingClientRect();
        const label = button
          .querySelector(".signInLabel")!
          .getBoundingClientRect();
        return {
          name: button.getAttribute("aria-label"),
          x,
          y,
          width,
          height,
          overflow: button.scrollWidth - button.clientWidth,
          iconRight: icon.right,
          labelLeft: label.left,
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
  for (const button of layout.buttons) {
    expect(button.overflow).toBeLessThanOrEqual(1);
    expect(button.iconRight).toBeLessThanOrEqual(button.labelLeft);
  }
}

/** Optional consent remains unchecked, aligned and usable beside either provider. */
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

export async function closeTileSurface(surface: Locator): Promise<void> {
  const close = surface.getByRole("button", {
    name: /^Close (tile|project)$/,
  });
  if (await close.count()) await close.click();
  else await surface.locator(".tileWorkspaceHeading h3").press("Escape");
}

/** Return to the persistent territory map by closing its open surfaces front to back. */
export async function returnToTerritoryMap(page: Page): Promise<Locator> {
  const workspace = page.locator('.gameWorkspace[data-persistent-map="true"]');
  const map = workspace.getByRole("region", {
    name: "Territory map workspace",
    exact: true,
  });
  await expect(map).toBeVisible();
  const front = workspace.locator(
    ':is([data-map-window-front="true"], .tileWorkspaceInspector:not([data-game-tool]), .tileWorkspaceBuilding):not([inert] *)',
  );
  while (await front.count()) {
    if (
      await front.evaluate((element) =>
        element.classList.contains("tileWorkspaceSurface"),
      )
    )
      await closeTileSurface(front);
    else
      await front
        .locator(":scope > .gameToolHeader")
        .getByRole("button", { name: /^Close / })
        .click();
  }
  await expect(
    workspace.locator(
      ".gameToolPanel:visible:not(.tileWorkspaceProject), .tileWorkspaceInspector:visible, .tileWorkspaceBuilding:visible",
    ),
  ).toHaveCount(0);
  return map;
}

/** Opt in to facility badges through the same layer controls as a player. */
export async function showMapFacilityStatus(map: Locator): Promise<void> {
  await map.getByRole("button", { name: "Map layers", exact: true }).click();
  const layers = map.page().getByRole("dialog", {
    name: "Map layers",
    exact: true,
  });
  await layers
    .getByRole("checkbox", { name: "Facility status", exact: true })
    .check();
  await layers.press("Escape");
  await expect(layers).toHaveCount(0);
}

export async function readTerritoryMapCamera(viewport: Locator) {
  return viewport.evaluate((element) => {
    const stage = element.querySelector<HTMLElement>(".territoryMapStage")!;
    const transform = new DOMMatrix(stage.style.transform || undefined);
    const scale = Number(element.getAttribute("data-camera-scale"));
    return { x: -transform.e / scale, y: -transform.f / scale, scale };
  });
}

/** Pan the real camera before activating a virtualized tile through its keyboard target. */
export async function selectTerritoryMapTile(
  page: Page,
  tile: { id: string; q: number; r: number },
): Promise<Locator> {
  const map = await returnToTerritoryMap(page);
  const target = map.locator(`[data-map-target="${tile.id}"]`);
  const viewport = map.locator(".territoryMapViewport");
  const point = hexCenter(tile);
  for (let attempt = 0; attempt < 20 && !(await target.count()); attempt++) {
    const camera = await readTerritoryMapCamera(viewport);
    const dx = (camera.x - point.x) * camera.scale;
    const dy = (camera.y - point.y) * camera.scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
    const box = (await viewport.boundingBox())!;
    const step = Math.min(
      1,
      (box.width * 0.25) / Math.max(1, Math.abs(dx)),
      (box.height * 0.2) / Math.max(1, Math.abs(dy)),
    );
    const x = box.x + box.width / 2;
    const y = box.y + 40;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Cross the drag threshold even when the camera needs only a tiny correction.
    await page.mouse.move(x + 12, y);
    await page.mouse.move(x + dx * step, y + dy * step);
    await page.mouse.up();
  }
  await target.focus();
  await target.press("Enter");
  await expect(target).toHaveAttribute("aria-pressed", "true");
  return target;
}

/** Open the map catalogue through its public entry point at the current effective width.
 * Use an already open map when the journey has just reached it.
 */
export async function openMapProjectCatalogue(
  page: Page,
  openMap?: Locator,
): Promise<Locator> {
  const map = openMap ?? (await returnToTerritoryMap(page));
  const rail = map.getByRole("complementary", {
    name: "Build facilities",
    exact: true,
  });
  if (await rail.isVisible()) return rail;
  await page
    .getByRole("navigation", { name: "Game actions" })
    .getByRole("button", { name: "Build", exact: true })
    .click();
  const catalogue = map.locator(".tileWorkspaceSurface");
  await expect(
    catalogue.getByRole("heading", { name: "Build", exact: true }),
  ).toBeVisible();
  return catalogue;
}

/** Size the next map project through the rail popover or phone catalogue. */
export async function setMapProjectCapacity(
  catalogue: Locator,
  storage: boolean,
  tick: string,
): Promise<void> {
  const sizing = catalogue.getByRole("button", {
    name: storage ? /^Energy:/ : /^Power:/,
  });
  const opened =
    (await sizing.isVisible()) &&
    (await sizing.getAttribute("aria-expanded")) !== "true";
  if (opened) await sizing.click();
  await catalogue
    .getByRole("slider", {
      name: storage ? "Storage capacity" : "Generator capacity",
      exact: true,
    })
    .fill(tick);
  if (opened) await sizing.page().keyboard.press("Escape");
}

/**
 * Open the Build tool from the dock, leaving it open when it already is: the dock button
 * toggles, so a second click would close it. Returns the Build region.
 */
export async function openBuild(page: Page): Promise<Locator> {
  const build = page.getByRole("region", { name: "Build", exact: true });
  const navButton = page.getByRole("button", { name: "Build", exact: true });
  // A purchase dialog temporarily hides the workspace from the accessibility tree.
  // Wait for it to return before deciding whether the dock would open or close Build.
  await waitForPaneOrNav(build, navButton);
  if (!(await build.isVisible())) await navButton.click();
  await expect(build).toBeVisible();
  return build;
}

/** Select Fleet when the game opens on its map, then bring the fleet into view. */
export async function openFleet(page: Page): Promise<Locator> {
  const fleet = page.locator("#facilitiesPane");
  const action = page.getByRole("button", { name: "Fleet", exact: true });
  await openPane(fleet, action);
  return fleet;
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
  if ((await visiblePane.count()) > 0) return false;
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
  await handle.click({ trial: true });
  const from = (await handle.boundingBox())!;
  const to = (await page
    .getByRole("button", { name: "Reorder Pumped Hydro", exact: true })
    .first()
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

/** Let a paid tile finish through the normal simulation clock. */
export async function waitForTileConnection(page: Page, tileId: string) {
  const tile = page.locator(`[data-map-target="${tileId}"]`);
  await expect(tile).toHaveAttribute("data-connection-building", "true");
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect(tile).toHaveAttribute("data-owned", "true");
  await expect(tile).not.toHaveAttribute("data-connection-building", "true", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "pause", exact: true }).click();
}
