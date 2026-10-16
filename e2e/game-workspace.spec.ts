import { expect, Page, test } from "./fixtures";

test.setTimeout(90_000);

async function startGame(page: Page, theme: "light" | "dark") {
  await page.addInitScript((mode) => {
    localStorage.clear();
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
  }, theme);
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".gameStage .facilities")).toBeVisible();
  await page.keyboard.press("0");
}

async function settleSheets(page: Page) {
  await page.locator(".gameToolPanel").evaluateAll(async (panels) => {
    await Promise.all(
      panels.flatMap((panel) =>
        panel.getAnimations().map((animation) => animation.finished),
      ),
    );
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`game dock and sheets stay usable in ${theme}`, async ({
    page,
  }, testInfo) => {
    await startGame(page, theme);
    const dock = page.locator("#navfooter");
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    for (const label of ["Build", "Programs", "Insights", "Events"]) {
      const action = dock.getByRole("button", { name: label, exact: true });
      await expect(action).toBeVisible();
      const box = (await action.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
    }
    await page.screenshot({
      path: testInfo.outputPath(`workspace-facilities-${theme}.png`),
      animations: "disabled",
    });

    // Opening a tool keeps the fleet mounted and its selected plant intact.
    await page
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
    const fleet = page.locator(".gameStage .facilities");
    await fleet.evaluate((element) =>
      element.setAttribute("data-workspace-fleet", "kept"),
    );
    await dock.getByRole("button", { name: "Insights", exact: true }).click();
    const insights = page.getByRole("region", {
      name: "Insights",
      exact: true,
    });
    await expect(insights).toBeVisible();
    await expect(page.locator("#insightsNav")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(fleet).toHaveAttribute("data-workspace-fleet", "kept");
    await expect(page.locator("#rateSlider")).toHaveCount(0);
    await expect(insights.locator("#chartForecastSupplyDemand")).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      insights.getByRole("heading", { name: "Insights", exact: true }),
    ).toHaveCount(1);
    // The daily fleet chart has keyboard detail inspection. Its Escape owns the tooltip
    // even while a tool is open above the fleet.
    const chart = page.locator("#chartSupplyDemand").getByRole("img");
    await chart.focus();
    await chart.press("Enter");
    await chart.press("Escape");
    await expect(insights).toBeVisible();
    await insights
      .getByRole("heading", { name: "Insights", exact: true })
      .focus();
    await settleSheets(page);
    const [sheetBox, dockBox] = await Promise.all([
      insights.boundingBox(),
      dock.boundingBox(),
    ]);
    expect(sheetBox!.y).toBeGreaterThan(0);
    expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
    expect(
      await insights.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-insights-${theme}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Close Insights", exact: true })
      .click();
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    await expect(page.locator("#insightsNav")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Pause Coal", exact: true }),
    ).toBeVisible();

    await dock.getByRole("button", { name: "Events", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Events", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    await expect(page.locator("#eventsNav")).toBeFocused();
    expect(
      await page
        .locator(".gameWorkspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
}

test("Programs owns pricing and Build keeps purchase dialogs above its sheet", async ({
  page,
}, testInfo) => {
  await startGame(page, "dark");
  await page.locator("#programsNav").click();
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  await expect(programs).toBeVisible();
  const rate = page.locator("#rateSlider input");
  const original = Number(await rate.inputValue());
  await rate.focus();
  await rate.press("ArrowRight");
  const changed = Number(await rate.inputValue());
  expect(changed).toBeGreaterThan(original);
  await settleSheets(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-programs-overview.png"),
    animations: "disabled",
  });
  await programs.getByRole("button", { name: /^Efficiency rebates ·/ }).click();
  await expect(
    programs.getByRole("heading", { name: "Efficiency rebates", exact: true }),
  ).toBeVisible();
  await expect(
    programs.getByRole("button", { name: "Start next month", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await page.screenshot({
    path: testInfo.outputPath("workspace-programs-detail.png"),
    animations: "disabled",
  });
  await programs.locator(".customerProgramsBody").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(programs.getByText(/^Peak demand:/)).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("workspace-programs-detail-impact.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(rate).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(programs).toHaveCount(0);
  await page.locator("#programsNav").click();
  await expect(rate).toHaveValue(String(changed));

  await page.locator(".button-buildFacility").click();
  const build = page.getByRole("region", { name: "Build", exact: true });
  await expect(build).toBeVisible();
  await expect(programs).toHaveCount(0);
  const storageTab = page.getByRole("tab", { name: "Storage", exact: true });
  await storageTab.click();
  await expect(storageTab).toBeFocused();
  await build
    .getByRole("button", { name: /Review purchase of/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(build).toBeVisible();
  await page.getByRole("button", { name: "Close Build", exact: true }).click();
  await expect(build).toHaveCount(0);
  await expect(page.locator(".gameStage .facilities")).toBeVisible();
});

test("wide desktops can pin tools and compact screens retain one active sheet", async ({
  page,
}, testInfo) => {
  test.skip(
    !!testInfo.project.use.hasTouch,
    "Desktop pinning uses a wide pointer workspace",
  );
  await page.setViewportSize({ width: 2240, height: 1100 });
  await startGame(page, "light");
  await page.locator("#insightsNav").click();
  await page.getByRole("button", { name: "Pin Insights", exact: true }).click();
  await page.locator("#eventsNav").click();
  await expect(page.locator(".gameToolPanel")).toHaveCount(2);
  await page.getByRole("button", { name: "Pin Events", exact: true }).click();
  await page.locator("#programsNav").click();
  await expect(page.locator(".gameToolPanel")).toHaveCount(3);
  await expect(page.locator("#chartForecastSupplyDemand")).toBeVisible({
    timeout: 60_000,
  });
  await settleSheets(page);
  const boxes = await page.locator(".gameToolPanel").evaluateAll((panels) =>
    panels.map((panel) => {
      const box = panel.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, right: box.right };
    }),
  );
  expect(boxes.every((box) => box.width >= 560)).toBe(true);
  expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].x);
  expect(boxes[1].right).toBeLessThanOrEqual(boxes[2].x);
  expect(boxes.every((box) => Math.abs(box.y - boxes[0].y) <= 1)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workspace-pinned-desktop.png"),
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".gameToolPanel")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Programs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pin Programs", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 2240, height: 1100 });
  await expect(page.locator(".gameToolPanel")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Unpin Insights", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unpin Events", exact: true }),
  ).toBeVisible();
});

test("short desktop sheets keep their heading, scroll body, and game dock reachable", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.hasTouch, "A short desktop viewport");
  await page.setViewportSize({ width: 1280, height: 480 });
  await startGame(page, "dark");
  await page.locator("#insightsNav").click();
  const insights = page.getByRole("region", { name: "Insights", exact: true });
  await expect(insights.locator("#chartForecastSupplyDemand")).toBeVisible({
    timeout: 60_000,
  });
  await settleSheets(page);
  const [panel, dock, stage] = await Promise.all([
    insights.boundingBox(),
    page.locator("#navfooter").boundingBox(),
    page.locator(".gameStage").boundingBox(),
  ]);
  expect(panel!.y).toBeGreaterThanOrEqual(stage!.y);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(dock!.y);
  await expect(
    page.getByRole("button", { name: "Close Insights", exact: true }),
  ).toBeInViewport();
  await insights
    .locator(".scrollable")
    .first()
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  expect(
    await insights
      .locator(".scrollable")
      .first()
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await expect(page.locator("#eventsNav")).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("workspace-short-desktop.png"),
    animations: "disabled",
  });
});
