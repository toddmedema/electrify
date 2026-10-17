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

async function expectFloatingDock(page: Page) {
  const [stage, facilities, dock] = await Promise.all([
    page.locator(".gameStage").boundingBox(),
    page.locator(".gameStage .facilities").boundingBox(),
    page.locator("#navfooter").boundingBox(),
  ]);
  // The dock overlays the full-height fleet instead of reserving a blank footer band.
  expect(
    Math.abs(facilities!.y + facilities!.height - stage!.y - stage!.height),
  ).toBeLessThanOrEqual(1);
  expect(dock!.y).toBeLessThan(facilities!.y + facilities!.height);
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(stage!.y + stage!.height);
  expect(
    Math.abs(dock!.x + dock!.width / 2 - page.viewportSize()!.width / 2),
  ).toBeLessThanOrEqual(1);
}

async function expectSideRails(page: Page) {
  const fleet = (await page.locator(".gameFleet").boundingBox())!;
  expect(fleet.width).toBeGreaterThanOrEqual(720);
  const panels = await page
    .locator(".gameToolPanel:visible")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { left, right, width } = element.getBoundingClientRect();
        return { left, right, width };
      }),
    );
  for (const panel of panels) {
    expect(panel.width).toBeGreaterThanOrEqual(400);
    expect(panel.width).toBeLessThanOrEqual(480);
    expect(
      panel.right <= fleet.x + 1 || panel.left >= fleet.x + fleet.width - 1,
    ).toBe(true);
  }
  await expectFloatingDock(page);
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
    await expectFloatingDock(page);
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
    const [sheetBox, stageBox] = await Promise.all([
      insights.boundingBox(),
      page.locator(".gameStage").boundingBox(),
    ]);
    expect(sheetBox!.y).toBeGreaterThan(0);
    expect(
      Math.abs(sheetBox!.y + sheetBox!.height - stageBox!.y - stageBox!.height),
    ).toBeLessThanOrEqual(1);
    if (
      (await page.locator(".gameStage").getAttribute("data-layout")) !== "sheet"
    ) {
      await expectSideRails(page);
    }
    expect(
      await insights.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-insights-${theme}.png`),
      // Keep review images focused on the layout after keyboard assertions above.
      style:
        ".gameToolTitle:focus { outline: none !important; box-shadow: none !important; }",
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

test("desktop side panels keep the dock centered and remember both rails across compact layouts", async ({
  page,
}, testInfo) => {
  test.skip(
    !!testInfo.project.use.hasTouch,
    "Desktop rails use a wide pointer workspace",
  );
  await page.setViewportSize({ width: 2240, height: 1100 });
  await startGame(page, "light");
  const originalDock = (await page.locator("#navfooter").boundingBox())!;
  await page.locator("#buildNav").click();
  await expectFloatingDock(page);
  expect((await page.locator("#navfooter").boundingBox())!.x).toBeCloseTo(
    originalDock.x,
    0,
  );
  await page.locator("#insightsNav").click();
  await expect(page.locator(".gameToolPanel")).toHaveCount(2);
  await expect(page.locator("#chartForecastSupplyDemand")).toBeVisible({
    timeout: 60_000,
  });
  await settleSheets(page);
  await expect(page.locator(".gameStage")).toHaveAttribute(
    "data-layout",
    "dual",
  );
  await expectSideRails(page);
  await expect(
    page.locator(".gameToolHeader").getByRole("tablist"),
  ).toHaveCount(0);
  await page.locator("#programsNav").click();
  await expect(
    page.getByRole("region", { name: "Programs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await page.locator("#eventsNav").click();
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Insights", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(2);
  await expectFloatingDock(page);
  expect((await page.locator("#navfooter").boundingBox())!.x).toBeCloseTo(
    originalDock.x,
    0,
  );
  await expect(
    page.getByRole("button", { name: /^(?:Unpin|Pin) /i }),
  ).toHaveCount(0);
  // Events is the most recently opened tool, but the player is working in Programs.
  // Narrowing preserves the focused decision instead of hiding it for the newer tool.
  const rate = page.locator("#rateSlider input");
  const value = await rate.inputValue();
  await page.screenshot({
    path: testInfo.outputPath("workspace-side-rails-desktop.png"),
    style:
      ".gameToolTitle:focus { outline: none !important; box-shadow: none !important; }",
    animations: "disabled",
  });
  await rate.focus();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Programs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Decisions", exact: true }),
  ).toHaveCount(0);
  await expect(rate).toBeFocused();
  await expect(rate).toHaveValue(value);
  await page.setViewportSize({ width: 2240, height: 1100 });
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(rate).toBeFocused();
  await expectSideRails(page);

  // A single desktop rail reveals a remembered tool rather than closing an unseen one.
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.locator(".gameStage")).toHaveAttribute(
    "data-layout",
    "side",
  );
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
  await expectSideRails(page);
  await page.locator("#eventsNav").click();
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Programs", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#eventsNav")).toBeFocused();
  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
  await expectSideRails(page);

  // Reviewing a Programs decision must not consume Escape from the opposite rail.
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  await programs.getByRole("button", { name: /^Efficiency rebates ·/ }).click();
  const decision = programs.getByRole("heading", {
    name: "Efficiency rebates",
    exact: true,
  });
  await expect(decision).toBeVisible();
  await page.locator("#insightsNav").click();
  await expect(
    page.getByRole("heading", { name: "Insights", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Insights", exact: true }),
  ).toHaveCount(0);
  await expect(decision).toBeVisible();
  await expect(page.locator("#insightsNav")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(decision).toHaveCount(0);
  await expect(programs.locator("#rateSlider input")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(programs).toHaveCount(0);
  await expect(page.locator("#programsNav")).toBeFocused();
});

test("short desktop rails keep their heading, scroll body, and floating dock reachable", async ({
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
  const [panel, stage] = await Promise.all([
    insights.boundingBox(),
    page.locator(".gameStage").boundingBox(),
  ]);
  expect(panel!.y).toBeGreaterThanOrEqual(stage!.y);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(
    stage!.y + stage!.height,
  );
  await expectSideRails(page);
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

for (const width of [320, 390]) {
  test(`compact ${width}px sheets and final actions remain usable behind the floating dock`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 640 });
    await startGame(page, "dark");
    await expect(page.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "sheet",
    );
    await expectFloatingDock(page);
    await page
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
    const fleet = page.locator(".facilities");
    await fleet.locator(".facilitiesBody").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const [lastRow, dock] = await Promise.all([
      fleet.locator(".facilityRow").last().boundingBox(),
      page.locator("#navfooter").boundingBox(),
    ]);
    expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(dock!.y + 1);

    await page.locator("#programsNav").click();
    const programs = page.getByRole("region", {
      name: "Programs",
      exact: true,
    });
    await programs
      .getByRole("button", { name: /^Efficiency rebates ·/ })
      .click();
    const commit = programs.getByRole("button", {
      name: "Start next month",
      exact: true,
    });
    await expect(commit).toBeEnabled({ timeout: 60_000 });
    await settleSheets(page);
    const [panel, stage, commitBox, dockBox] = await Promise.all([
      programs.boundingBox(),
      page.locator(".gameStage").boundingBox(),
      commit.boundingBox(),
      page.locator("#navfooter").boundingBox(),
    ]);
    expect(
      Math.abs(panel!.y + panel!.height - stage!.y - stage!.height),
    ).toBeLessThanOrEqual(1);
    expect(commitBox!.y + commitBox!.height).toBeLessThanOrEqual(
      dockBox!.y + 1,
    );
    expect(
      await commit.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return top === element || element.contains(top);
      }),
    ).toBe(true);
    await programs.locator(".customerProgramsBody").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(programs.getByText(/^Peak demand:/)).toBeInViewport();
    expect(
      await page
        .locator(".gameWorkspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await expect(page.locator("#eventsNav")).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`workspace-floating-dock-${width}.png`),
      animations: "disabled",
    });
  });
}
