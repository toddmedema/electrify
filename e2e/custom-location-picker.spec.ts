import { expect, Page, test } from "@playwright/test";

async function openCustomSetup(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, date: new Date().toString() }],
      }),
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "View Custom Game details" }).click();
  await expect(
    page.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();
}

test("world map location picker works with pointer, touch, search, and keyboard", async ({
  page,
}, testInfo) => {
  await openCustomSetup(page);

  const search = page.getByRole("combobox", { name: "Search playable cities" });
  const map = page.getByRole("group", { name: "Playable locations map" });
  const selectedSanFrancisco = page.getByRole("button", {
    name: "Select San Francisco, CA, United States",
  });
  await expect(search).toHaveValue("San Francisco, CA");
  await expect(map).toBeVisible();
  await expect(selectedSanFrancisco).toHaveAttribute("aria-pressed", "true");

  const tabbableMapControls = await map
    .locator(".worldMapMarker")
    .evaluateAll(
      (controls) => controls.filter((control) => control.tabIndex === 0).length,
    );
  expect(tabbableMapControls).toBe(1);

  const startingSelection = await search.inputValue();
  await map.locator(".worldMapMarker.cluster").first().click();
  await expect(search).toHaveValue(startingSelection);
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();
  await page.getByRole("button", { name: "Show world" }).click();

  await selectedSanFrancisco.focus();
  await selectedSanFrancisco.press("ArrowLeft");
  const focusedLabel = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") || "",
  );
  expect(focusedLabel).not.toBe("Select San Francisco, CA, United States");
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("Honolulu, HI");

  await expect(page.locator(".locationPickerCount")).toHaveText(
    /\d+ playable locations/,
  );
  await search.fill("Paris");
  await page.getByRole("option", { name: "Paris, France" }).click();
  await expect(search).toHaveValue("Paris, France");
  await expect(
    page.getByRole("button", { name: "Select Paris, France" }),
  ).toHaveAttribute("aria-pressed", "true");

  const overflow = await page
    .locator(".scrollable")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(map).toHaveCSS("touch-action", "pan-y");

  const mapBox = await map.boundingBox();
  const searchBox = await search.boundingBox();
  expect(mapBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  if (testInfo.project.name.startsWith("mobile")) {
    expect(searchBox!.y).toBeLessThan(mapBox!.y);
  }
  if (
    testInfo.project.name.startsWith("mobile") ||
    testInfo.project.name.startsWith("tablet")
  ) {
    const target = await map.locator(".worldMapMarker").first().boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
  } else if (testInfo.project.name.startsWith("desktop")) {
    expect(Math.abs(searchBox!.y - mapBox!.y)).toBeLessThan(12);
    expect(searchBox!.x).toBeGreaterThan(mapBox!.x);
  }
});

test("keyboard navigation retains one map stop and honors activation and zoom bounds", async ({
  page,
}) => {
  await openCustomSetup(page);

  const search = page.getByRole("combobox", { name: "Search playable cities" });
  const map = page.getByRole("group", { name: "Playable locations map" });
  const sanFrancisco = page.getByRole("button", {
    name: "Select San Francisco, CA, United States",
  });
  const honolulu = page.getByRole("button", {
    name: "Select Honolulu, HI, United States",
  });

  await sanFrancisco.focus();
  await sanFrancisco.press("ArrowLeft");
  await expect(honolulu).toBeFocused();
  await honolulu.press(" ");
  await expect(search).toHaveValue("Honolulu, HI");
  await expect(page.getByLabel("Selected location")).toContainText(
    "Honolulu, HI",
  );

  await search.fill("San Francisco");
  await page.getByRole("option", { name: "San Francisco, CA" }).click();
  await page.getByRole("button", { name: "Show world" }).click();
  await sanFrancisco.focus();
  await sanFrancisco.press("ArrowLeft");
  await expect(honolulu).toBeFocused();
  await honolulu.press("Enter");
  await expect(search).toHaveValue("Honolulu, HI");

  const cluster = map.locator(".worldMapMarker.cluster").first();
  await cluster.focus();
  await cluster.press("Enter");
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();
  await expect(page.locator(":focus")).toHaveClass(/worldMapMarker/);

  await page.locator(":focus").press("Home");
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  await expect(page.locator(":focus")).toHaveClass(/worldMapMarker/);
  await expect(map.locator(".worldMapMarker[tabindex='0']")).toHaveCount(1);

  await page.locator(":focus").press("Tab");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeFocused();

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await expect(zoomIn).toBeDisabled();
  await zoomOut.click();
  await zoomOut.click();
  await zoomOut.click();
  await expect(zoomOut).toBeDisabled();
});

test("pointer and touch interactions leave vertical scrolling available", async ({
  page,
}, testInfo) => {
  await openCustomSetup(page);

  const map = page.getByRole("group", { name: "Playable locations map" });
  const search = page.getByRole("combobox", { name: "Search playable cities" });
  const startingSelection = await search.inputValue();
  const cluster = map.locator(".worldMapMarker.cluster").first();

  if (testInfo.project.name.startsWith("desktop")) {
    await cluster.hover();
    await expect(search).toHaveValue(startingSelection);
    await expect(cluster).toHaveCSS("cursor", "pointer");
    return;
  }

  await map.scrollIntoViewIfNeeded();
  const clusterBox = await cluster.boundingBox();
  expect(clusterBox).not.toBeNull();
  await page.touchscreen.tap(
    clusterBox!.x + clusterBox!.width / 2,
    clusterBox!.y + clusterBox!.height / 2,
  );
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();
  await expect(search).toHaveValue(startingSelection);

  await page.getByRole("button", { name: "Show world" }).click();
  await map.scrollIntoViewIfNeeded();
  const mapBox = await map.boundingBox();
  expect(mapBox).not.toBeNull();
  const scroller = page.locator(".scrollable");
  const before = await scroller.evaluate((element) => element.scrollTop);
  const session = await page.context().newCDPSession(page);
  const x = Math.round(mapBox!.x + mapBox!.width / 2);
  const startY = Math.round(mapBox!.y + mapBox!.height - 20);
  const endY = Math.round(mapBox!.y + 20);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: startY }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: endY }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before);
});

test("location constraints keep Play valid only where the starting fleet is viable", async ({
  page,
}) => {
  await openCustomSetup(page);

  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled();
  await page.getByRole("combobox", { name: "Facility type" }).click();
  await page.getByRole("option", { name: "Geothermal" }).click();
  await page.getByRole("button", { name: "Add facility" }).click();
  await expect(play).toBeEnabled();

  const search = page.getByRole("combobox", { name: "Search playable cities" });
  await search.fill("Paris");
  await page.getByRole("option", { name: "Paris, France" }).click();
  await expect(play).toBeDisabled();

  await search.fill("San Francisco");
  await page.getByRole("option", { name: "San Francisco, CA" }).click();
  await expect(play).toBeEnabled();
});

test("dark theme and reduced motion keep the map legible and still", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await openCustomSetup(page);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const map = page.getByRole("group", { name: "Playable locations map" });
  const marker = map.locator(".worldMapMarker").first();
  await expect(map).toBeVisible();
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS("transition-duration", "0s");
  const colors = await map.evaluate((element) => {
    const land = element.querySelector<SVGPathElement>(
      ".worldMapContinents path",
    );
    const mapStyle = getComputedStyle(element);
    const landStyle = land && getComputedStyle(land);
    return {
      background: mapStyle.backgroundColor,
      land: landStyle?.fill || "",
      border: mapStyle.borderColor,
    };
  });
  expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.land).not.toBe(colors.background);
  expect(colors.border).not.toBe(colors.background);
});
