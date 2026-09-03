import { expect, Locator, Page, test } from "@playwright/test";

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

async function activateFocusedNeighbor(
  page: Page,
  search: Locator,
  previousLabel: string,
  previousSelection: string,
  key: " " | "Enter",
) {
  const focusedMarker = page.locator(":focus");
  await expect(focusedMarker).not.toHaveAttribute("aria-label", previousLabel);
  const focusedCluster = await focusedMarker.evaluate((element) =>
    element.classList.contains("cluster"),
  );
  await focusedMarker.press(key);
  if (focusedCluster) {
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    await expect(search).toHaveValue(previousSelection);
  } else {
    await expect(focusedMarker).toHaveAttribute("aria-pressed", "true");
    await expect(search).not.toHaveValue(previousSelection);
  }
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

  const pointerTarget = map
    .locator(".worldMapMarker:not(.cluster)[aria-pressed='false']")
    .first();
  const pointerTargetLabel = await pointerTarget.getAttribute("aria-label");
  expect(pointerTargetLabel).not.toBeNull();
  await pointerTarget.click();
  await expect(
    page.getByRole("button", { name: pointerTargetLabel! }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(search).not.toHaveValue("San Francisco, CA");
  await search.fill("San Francisco");
  await page.getByRole("option", { name: "San Francisco, CA" }).click();
  await expect(search).toHaveValue("San Francisco, CA");

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
  await activateFocusedNeighbor(
    page,
    search,
    "Select San Francisco, CA, United States",
    startingSelection,
    "Enter",
  );
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
  await expect(map).toHaveCSS("touch-action", "none");

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

test("a city marker still selects after the map has zoomed", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("desktop"));
  await openCustomSetup(page);

  const search = page.getByRole("combobox", { name: "Search playable cities" });
  await expect(page.locator(".locationPickerCount")).toHaveText(
    /\d{3} playable locations/,
  );
  const map = page.getByRole("group", { name: "Playable locations map" });
  const startingSelection = await search.inputValue();
  await map.locator(".worldMapMarker.cluster").first().click();
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();
  const zoomedMarker = map
    .locator(".worldMapMarker.marker:not(.selected)")
    .first();
  const zoomedMarkerLabel = await zoomedMarker.getAttribute("aria-label");
  expect(zoomedMarkerLabel).not.toBeNull();
  await zoomedMarker.click();

  await expect(
    page.getByRole("button", { name: zoomedMarkerLabel! }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(search).not.toHaveValue(startingSelection);
});

test("custom setup uses side-by-side settings and facilities only at desktop widths", async ({
  page,
}, testInfo) => {
  await openCustomSetup(page);
  // Measure the settled setup, not its translated position during the outgoing card transition.
  await expect(page.getByRole("list", { name: "Available games" })).toHaveCount(
    0,
  );

  const settings = page.getByRole("region", { name: "Game setup" });
  const facilities = page.getByRole("region", { name: "Facilities" });
  const outlook = page.getByRole("region", { name: "Year 1 outlook" });
  const settingsBox = await settings.boundingBox();
  const facilitiesBox = await facilities.boundingBox();
  const outlookBox = await outlook.boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(facilitiesBox).not.toBeNull();
  expect(outlookBox).not.toBeNull();
  expect(outlookBox!.x).toBeGreaterThanOrEqual(facilitiesBox!.x);
  expect(outlookBox!.x + outlookBox!.width).toBeLessThanOrEqual(
    facilitiesBox!.x + facilitiesBox!.width,
  );

  if (testInfo.project.name.startsWith("desktop")) {
    expect(Math.abs(settingsBox!.y - facilitiesBox!.y)).toBeLessThanOrEqual(1);
    expect(settingsBox!.x + settingsBox!.width).toBeLessThan(facilitiesBox!.x);
  } else {
    expect(facilitiesBox!.y).toBeGreaterThanOrEqual(
      settingsBox!.y + settingsBox!.height,
    );
  }

  const overflow = await page
    .locator(".scrollable")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Year 1 outlook recalculates from the selected facilities", async ({
  page,
}) => {
  await openCustomSetup(page);

  const outlook = page.getByRole("region", { name: "Year 1 outlook" });
  await expect(outlook).toContainText(/Demand covered|Deficit forecast/, {
    timeout: 20000,
  });

  await page
    .getByRole("button", { name: "Remove Natural Gas", exact: true })
    .click();
  await expect(outlook).toContainText("Calculating Year 1 outlook…");
  await expect(outlook).toContainText("0%", { timeout: 20000 });
  await expect(outlook).toContainText("Deficit forecast");

  await page.getByRole("combobox", { name: "Facility type" }).click();
  await page.getByRole("option", { name: "Natural Gas" }).click();
  await page.getByRole("combobox", { name: "Facility size" }).click();
  await page.getByRole("option", { name: "2GW" }).click();
  await page.getByRole("button", { name: "Add facility" }).click();
  await expect(outlook).toContainText("Calculating Year 1 outlook…");
  await expect(outlook).toContainText("Demand covered", { timeout: 20000 });
  await expect(outlook).toContainText("100%");
  await expect(outlook).toContainText("No forecast shortfall");
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
  await expect(page.locator(".locationPickerCount")).toHaveText(
    /\d{3} playable locations/,
  );
  await sanFrancisco.focus();
  await sanFrancisco.press("ArrowLeft");
  await activateFocusedNeighbor(
    page,
    search,
    "Select San Francisco, CA, United States",
    "San Francisco, CA",
    " ",
  );

  await search.fill("San Francisco");
  await page.getByRole("option", { name: "San Francisco, CA" }).click();
  await page.getByRole("button", { name: "Show world" }).click();
  await sanFrancisco.focus();
  await sanFrancisco.press("ArrowLeft");
  await activateFocusedNeighbor(
    page,
    search,
    "Select San Francisco, CA, United States",
    "San Francisco, CA",
    "Enter",
  );

  await page.getByRole("button", { name: "Show world" }).click();
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

test("pointer, touch, pinch, and wheel interactions stay within the map", async ({
  page,
}, testInfo) => {
  await openCustomSetup(page);

  const map = page.getByRole("group", { name: "Playable locations map" });
  const search = page.getByRole("combobox", { name: "Search playable cities" });
  const startingSelection = await search.inputValue();
  const cluster = map.locator(".worldMapMarker.cluster").first();
  await cluster.click();
  await expect(map).toHaveClass(/zoomed/);
  await expect(map).toHaveCSS("touch-action", "none");
  const land = map.locator(".worldMapLand > g");
  const startingTransform = await land.getAttribute("transform");
  const mapBox = await map.boundingBox();
  expect(mapBox).not.toBeNull();

  if (testInfo.project.name.startsWith("desktop")) {
    await page.mouse.move(
      mapBox!.x + mapBox!.width / 2,
      mapBox!.y + mapBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      mapBox!.x + mapBox!.width / 2 - 80,
      mapBox!.y + mapBox!.height / 2 - 30,
    );
    await page.mouse.up();
    await expect
      .poll(() => land.getAttribute("transform"))
      .not.toBe(startingTransform);
    await expect(search).toHaveValue(startingSelection);
    const scroller = page.locator(".scrollable");
    const before = await scroller.evaluate((element) => element.scrollTop);

    await page.getByRole("button", { name: "Show world" }).click();
    const worldTransform = await land.getAttribute("transform");
    await page.mouse.move(
      mapBox!.x + mapBox!.width / 2,
      mapBox!.y + mapBox!.height / 2,
    );
    await page.mouse.wheel(0, -100);
    await expect
      .poll(() => land.getAttribute("transform"))
      .not.toBe(worldTransform);
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(before);
    return;
  }

  await map.scrollIntoViewIfNeeded();
  const touchMapBox = await map.boundingBox();
  expect(touchMapBox).not.toBeNull();
  // Start over the open ocean in the lower-left. Coarse-pointer marker hit areas deliberately
  // reach 44px, so the geometric center can belong to a marker on a 320px map.
  const panStart = {
    x: Math.round(touchMapBox!.x + 24),
    y: Math.round(touchMapBox!.y + touchMapBox!.height - 24),
  };
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [panStart],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: panStart.x - 20, y: panStart.y - 20 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => land.getAttribute("transform"))
    .not.toBe(startingTransform);
  await expect(search).toHaveValue(startingSelection);

  await page.getByRole("button", { name: "Show world" }).click();
  const beforePinch = await land.getAttribute("transform");
  const pinchY = Math.round(touchMapBox!.y + touchMapBox!.height - 20);
  const pinchLeftX = Math.round(touchMapBox!.x + 25);
  const pinchRightX = Math.round(touchMapBox!.x + 75);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: pinchLeftX, y: pinchY },
      { x: pinchRightX, y: pinchY },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: pinchLeftX - 20, y: pinchY },
      { x: pinchRightX + 20, y: pinchY },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect.poll(() => land.getAttribute("transform")).not.toBe(beforePinch);

  await page.getByRole("button", { name: "Show world" }).click();
  await expect(map).toHaveCSS("touch-action", "none");
  await map.scrollIntoViewIfNeeded();
  const worldMapBox = await map.boundingBox();
  expect(worldMapBox).not.toBeNull();
  const scroller = page.locator(".scrollable");
  const before = await scroller.evaluate((element) => element.scrollTop);
  const x = Math.round(worldMapBox!.x + worldMapBox!.width / 2);
  const startY = Math.round(worldMapBox!.y + worldMapBox!.height - 20);
  const endY = Math.round(worldMapBox!.y + 20);
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
    .toBe(before);
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
