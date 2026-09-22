import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`wide desktop map keeps targets and clustering aligned in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(
      !["desktop-chromium", "foldable-unfolded"].includes(info.project.name),
    );
    const minimum = info.project.use.hasTouch ? 44 : 40;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [
            { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
          ],
        }),
      );
    }, theme);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Start playing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View Custom Game details" })
      .click();
    const map = page.getByRole("group", { name: "Playable locations map" });
    await expect(map).toBeVisible();
    const seed = page.getByRole("textbox", { name: "Seed", exact: true });
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await seed.fill("12345");
    await expect(seed).toHaveValue("12345");
    await seed.blur();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(
      await page
        .locator("main.base_main")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (
      process.env.PR_SCREENSHOTS &&
      theme === "dark" &&
      info.project.name === "desktop-chromium"
    ) {
      await expect(
        page.getByText("Calculating Year 1 outlook…", { exact: true }),
      ).toHaveCount(0, { timeout: 20000 });
      await map.scrollIntoViewIfNeeded();
      await page.screenshot({ path: ".tmp/pr-desktop.png" });
    }
    // Two fixture locations are 36px apart at 820px: they must form one cluster
    // for either 40px mouse or 44px touch targets, unlike the former 32px threshold.
    await page.route("**/data/weather/index.json", (route) =>
      route.fulfill({
        json: {
          cities: {
            QA_A: {
              id: "QA_A",
              name: "QA west",
              lat: 0,
              long: 0,
              region: "QA region",
            },
            QA_B: {
              id: "QA_B",
              name: "QA east",
              lat: 0,
              long: 16,
              region: "QA region",
            },
          },
        },
      }),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Start playing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View Custom Game details" })
      .click();
    // The production two-column grid caps its map near 629px. Exercise ResizeObserver
    // above 700px too, to catch mismatches between hit targets and clustering geometry.
    await page.addStyleTag({
      content:
        ".locationPicker { grid-template-columns: minmax(0, 1fr) !important; grid-template-areas: 'heading' 'map' 'details' !important; }",
    });
    await expect
      .poll(async () => (await map.boundingBox())!.width)
      .toBeGreaterThanOrEqual(700);
    const markers = map.locator(".worldMapMarker");
    await expect(markers.first()).toBeVisible();
    const boxes = await markers.evaluateAll((elements) =>
      elements.map((el) => {
        const box = el.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(minimum);
      expect(box.height).toBeGreaterThanOrEqual(minimum);
    }
    await expect(
      map.getByRole("button", { name: /2 locations near QA region/ }),
    ).toHaveCount(1);
    const land = map.locator(".worldMapLand > g");
    const before = await land.getAttribute("transform");
    await map
      .getByRole("button", { name: /2 locations near QA region/ })
      .click();
    await expect(land).not.toHaveAttribute("transform", before!);
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    await page.getByRole("button", { name: "Show world" }).click();
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`intertie review shares desktop dialog geometry in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!info.project.name.startsWith("desktop"));
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await facilities
      .getByRole("button", { name: "Build", exact: true })
      .click();
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
      })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const title = await dialog
      .locator(".closableDialogTitleText")
      .boundingBox();
    const close = await dialog
      .getByRole("button", { name: "close", exact: true })
      .boundingBox();
    expect(title!.x + title!.width + 7).toBeLessThanOrEqual(close!.x);
    expect(close!.height).toBeGreaterThanOrEqual(40);
    await expect(dialog.locator(".MuiDialogActions-root")).toHaveCSS(
      "gap",
      "8px",
    );
    await expect(
      dialog.getByRole("button", { name: "Take loan" }),
    ).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
