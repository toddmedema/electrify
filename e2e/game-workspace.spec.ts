import { reviewScreenshot } from "./review-screenshot";
import { openBuild } from "./layout";
import { expect, Page, test } from "./fixtures";
import path from "node:path";
import { editSavedGame } from "./save-fixture";

test.setTimeout(90_000);

async function startGame(
  page: Page,
  theme: "light" | "dark",
  scenarioId = 100,
) {
  await page.addInitScript((mode) => {
    localStorage.clear();
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
  }, theme);
  await page.goto(`/?scenario=${scenarioId}`);
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".gameStage .facilities")).toBeVisible();
  await page.keyboard.press("0");
  await expect(page.locator(".facilities > .paneHeader")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Facilities", exact: true }),
  ).toHaveCount(0);
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

for (const side of [false, true]) {
  test(`purchases ${side ? "keep Build open in a side panel" : "close Build in an overlay"}`, async ({
    page,
  }, info) => {
    test.skip(
      side && !!info.project.use.hasTouch,
      "Side-panel coverage uses the desktop project",
    );
    const width = side
      ? 1300
      : info.project.use.hasTouch
        ? page.viewportSize()!.width
        : 1023;
    await page.setViewportSize({ width, height: page.viewportSize()!.height });
    await startGame(page, "dark", 100);
    for (const [category, purchase] of [
      ["Generators", "Solar"],
      ["Storage", "Pumped Hydro"],
      ["Interties", "Pacific Northwest intertie"],
    ]) {
      const build = await openBuild(page);
      await build.getByRole("tab", { name: category, exact: true }).click();
      const before = await page
        .locator(".facilityRow, .transmissionLine")
        .count();
      await build
        .getByRole("button", {
          name: `Review purchase of ${purchase}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".facilityRow, .transmissionLine")).toHaveCount(
        before + 1,
      );
      if (side) {
        await expect(build).toBeVisible();
        await build
          .getByRole("button", { name: "Close Build", exact: true })
          .click();
      } else {
        await expect(build).toHaveCount(0);
      }
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`main game content stays centered at 1800px while tools use spare width in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");
    await page.setViewportSize({ width: 3200, height: 1100 });
    await startGame(page, theme, 111);
    const fleet = page.locator(".gameFleet");
    const build = page.getByRole("region", { name: "Build", exact: true });
    const insights = page.getByRole("region", {
      name: "Insights",
      exact: true,
    });
    const expectCenteredFleet = async (left: number, right: number) => {
      const box = (await fleet.boundingBox())!;
      expect(box.width).toBe(Math.min(1800, right - left));
      expect(
        Math.abs(box.x + box.width / 2 - (left + right) / 2),
      ).toBeLessThanOrEqual(1);
      expect((await page.locator("#appbar").boundingBox())!.width).toBe(
        page.viewportSize()!.width,
      );
      expect(
        (await page.locator(".gameStage .facilities").boundingBox())!.width,
      ).toBe(box.width);
      expect(
        (await page.locator(".unifiedFacilitiesList").boundingBox())!.width,
      ).toBeLessThanOrEqual(box.width);
    };
    await expectCenteredFleet(0, 3200);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`centered-fleet-${theme}.png`),
      animations: "disabled",
    });
    await openBuild(page);
    await expectCenteredFleet(480, 3200);
    await page.locator("#insightsNav").click();
    await expect(insights).toBeVisible();
    await expectCenteredFleet(480, 2720);
    await expectSideRails(page);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`centered-fleet-tools-${theme}.png`),
      animations: "disabled",
    });
    // Three and four rails still leave a capped, centered fleet on a 4K display.
    await page.setViewportSize({ width: 3840, height: 1100 });
    await page.locator("#programsNav").click();
    await expect(page.locator(".gameToolPanel:visible")).toHaveCount(3);
    await expectCenteredFleet(960, 3360);
    await expectSideRails(page);
    await expect(insights.locator("#chartForecastSupplyDemand")).toBeVisible({
      timeout: 60_000,
    });
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`centered-fleet-three-panels-${theme}.png`),
      animations: "disabled",
    });
    await page.locator("#eventsNav").click();
    await expect(page.locator(".gameToolPanel:visible")).toHaveCount(4);
    await expectCenteredFleet(960, 2880);
    await expectSideRails(page);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`centered-fleet-four-panels-${theme}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Close Programs", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close Events", exact: true })
      .click();
    // Only shrink once the open tools leave less than 1800px for the main content.
    await page.setViewportSize({ width: 2240, height: 1100 });
    await expectCenteredFleet(480, 1760);
    await expectSideRails(page);
    await build
      .getByRole("button", { name: "Close Build", exact: true })
      .click();
    await expectCenteredFleet(0, 1760);
    await insights
      .getByRole("button", { name: "Close Insights", exact: true })
      .click();
    await expectCenteredFleet(0, 2240);
  });

  test(`mission header uses regular event text and matching button hover in ${theme}`, async ({
    page,
  }, testInfo) => {
    await startGame(page, theme, 111);
    const event = page.locator(".missionRiskEvent");
    await expect(event).toBeVisible();
    await expect(event.locator(".missionRiskText")).toHaveCSS(
      "font-weight",
      "400",
    );
    const months = page.getByRole("button", { name: /^\d+ months? left$/ });
    if (!testInfo.project.use.hasTouch) {
      const background = await months.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await event.hover();
      await expect(event).not.toHaveCSS("background-color", background);
      const hover = await event.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        );
        return getComputedStyle(element).backgroundColor;
      });
      await months.hover();
      await expect(months).toHaveCSS("background-color", hover);
    }
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`mission-header-${theme}.png`),
      animations: "disabled",
    });
    await months.click();
    await expect(
      page.getByRole("region", { name: "Scenario", exact: true }),
    ).toBeVisible();
  });

  test(`mobile grid status keeps the header height during a blackout in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(page.viewportSize()!.width >= 700);
    await startGame(page, theme);
    const status = page.locator(".gridHealth");
    await expect(status).toHaveClass(/gridHealth-stable/);
    const initialHeight = (await page.locator("#appbar").boundingBox())!.height;
    await page
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause Coal", exact: true }).click();
    await expect(status).toHaveClass(/gridHealth-blackout/);
    await expect(status.locator(".gridHealthMetric")).toHaveCount(0);
    const icon = status.getByRole("button", {
      name: /^Current grid status: Blackout/,
    });
    await expect(icon).toHaveCSS("height", "44px");
    expect((await page.locator("#appbar").boundingBox())!.height).toBe(
      initialHeight,
    );
    await icon.tap();
    await expect(
      page.getByRole("tooltip", { name: /^Blackout, .* short/ }),
    ).toBeVisible();
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`grid-blackout-${theme}.png`),
      animations: "disabled",
    });
  });

  test(`program statuses always sit below their names in ${theme}`, async ({
    page,
  }, testInfo) => {
    await startGame(page, theme, 111);
    await page.locator("#programsNav").click();
    const programs = page.getByRole("region", {
      name: "Programs",
      exact: true,
    });
    await settleSheets(page);
    await expect(programs.locator(".customerProgramTitle")).toHaveCount(7);
    for (const title of await programs.locator(".customerProgramTitle").all()) {
      const name = await title.locator(":scope > span").first().boundingBox();
      const status = await title
        .locator(".customerProgramStatus")
        .boundingBox();
      expect(name).not.toBeNull();
      expect(status).not.toBeNull();
      expect(status!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1);
      expect(Math.abs(status!.x - name!.x)).toBeLessThanOrEqual(1);
    }
    expect(
      await programs.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      theme === "light" &&
      testInfo.project.name === "mobile-390px"
    ) {
      await programs.locator(".customerProgramsBody").evaluate((body) => {
        body.scrollTop = body.scrollHeight;
      });
      await settleSheets(page);
      await programs.locator(".customerProgramList").screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          "programs-mobile-light.png",
        ),
        animations: "disabled",
      });
    }
  });

  test(`touch closes dock tools without a lingering highlight in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch);
    await startGame(page, theme);
    const insights = page.locator("#insightsNav");
    const build = page.locator("#buildNav");
    const insightsPane = page.getByRole("region", {
      name: "Insights",
      exact: true,
    });
    await insights.tap();
    await expect(insightsPane).toBeVisible();
    await expect(insights).toHaveAttribute("aria-expanded", "true");
    await insights.tap();
    await expect(insightsPane).toHaveCount(0);
    await expect(insights).toHaveAttribute("aria-expanded", "false");
    // Some phone browsers retain :hover after a tap. Exercise that state explicitly.
    const session = await page.context().newCDPSession(page);
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#insightsNav",
    });
    await session.send("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: ["hover"],
    });
    await expect(insights).toHaveCSS(
      "background-color",
      await build.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await session.detach();
    await expect(insights).not.toHaveClass(/Mui-focusVisible/);
    // A physical keyboard on the same touch device still receives visible focus when closing.
    await page.keyboard.press("e");
    await expect(insightsPane).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(insights).toBeFocused();
    await expect(insights).toHaveCSS("outline-style", "solid");
    await expect(insights).toHaveCSS("outline-width", "2px");
  });
}

test("Escape closes the game menu before an unsaved program decision", async ({
  page,
}) => {
  await startGame(page, "dark");
  await page.locator("#programsNav").click();
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  await programs.getByRole("button", { name: /^Time-of-use tariff ·/ }).click();
  await programs.getByLabel("Daily window").selectOption("22");
  await page.locator(".gameMenuButton").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    programs.getByRole("region", { name: "Program details" }),
  ).toBeVisible();
  await expect(programs.getByLabel("Daily window")).toBeVisible();
  await expect(programs.getByLabel("Daily window")).toHaveValue("22");
  await programs
    .getByRole("heading", { name: "Time-of-use tariff", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(
    programs.getByRole("region", { name: "Electricity pricing" }),
  ).toBeVisible();
});

test("Build and Programs restore selections and scrolling without reopening hidden tools", async ({
  page,
}) => {
  // One tool at a time: switching tools hides the other instead of opening beside it.
  if (page.viewportSize()!.width >= 1024)
    await page.setViewportSize({ width: 1023, height: 800 });
  await startGame(page, "dark");
  const build = page.getByRole("region", { name: "Build", exact: true });
  await page.locator("#insightsNav").click();
  await page.locator("#buildNav").click();
  const size = build.locator(".constructionCapacitySlider input");
  await size.focus();
  await size.press("ArrowRight");
  const generatorSize = await size.inputValue();
  const list = build.locator(".cardList");
  const left = await list.evaluate((element) => {
    element.scrollTop = Math.min(
      240,
      element.scrollHeight - element.clientHeight,
    );
    return element.scrollTop;
  });
  expect(left).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await size.focus();
  await size.press("ArrowRight");
  await size.press("ArrowRight");
  const storageSize = await size.inputValue();
  await page.getByRole("tab", { name: "Interties", exact: true }).click();
  await size.focus();
  await size.press("ArrowRight");
  const tier = await size.inputValue();
  await page.locator("#buildNav").click();
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(0);
  const closedColor = await page
    .locator("#buildNav")
    .evaluate((element) => getComputedStyle(element).color);
  await page.locator("#buildNav").click();
  await expect(
    page.getByRole("tab", { name: "Interties", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(size).toHaveValue(tier);
  await page.getByRole("tab", { name: "Generators", exact: true }).click();
  await expect(size).toHaveValue(generatorSize);
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBe(left);
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await expect(size).toHaveValue(storageSize);

  await page.locator("#programsNav").click();
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  const body = programs.locator(".customerProgramsBody");
  const rebate = programs.getByRole("button", {
    name: /^Efficiency rebates ·/,
  });
  await rebate.scrollIntoViewIfNeeded();
  // A real click can scroll its target after the initial visibility check.
  // Record the opening position during click capture, before React opens details.
  const openingPosition = await body.evaluateHandle((element) => {
    const position = { scrollTop: Number.NaN };
    element.addEventListener(
      "click",
      () => {
        position.scrollTop = element.scrollTop;
      },
      { capture: true, once: true },
    );
    return position;
  });
  await rebate.click();
  const listScroll = await openingPosition.evaluate(
    (position) => position.scrollTop,
  );
  await openingPosition.dispose();
  expect(Number.isFinite(listScroll)).toBe(true);
  await expect(
    programs.getByRole("button", { name: "Start next month", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  const detailScroll = await body.evaluate((element) => {
    element.scrollTop = Math.min(
      120,
      element.scrollHeight - element.clientHeight,
    );
    return element.scrollTop;
  });
  expect(detailScroll).toBeGreaterThan(0);
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(detailScroll);
  await page.locator("#buildNav").click();
  await expect(size).toHaveValue(storageSize);
  await page.locator("#programsNav").click();
  await expect(
    programs.getByRole("heading", { name: "Efficiency rebates", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(detailScroll);
  await programs
    .getByRole("button", { name: "Back to programs", exact: true })
    .click();
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(listScroll);
  await page.locator("#programsNav").click();
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(0);
  await page.locator("#programsNav").click();
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(listScroll);
  // Blue remains the interaction cue even with the pointer resting on a closed dock action.
  await expect(page.locator("#buildNav")).toHaveCSS("color", closedColor);
});

test("Insights and Events reopen at the scroll position the player left", async ({
  page,
}) => {
  // Short enough that both panes overflow on every project; a phone's Events sheet holds
  // only the upcoming card and an empty history at the start of a run.
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 400,
  });
  await startGame(page, "light");
  for (const [nav, pane] of [
    ["#insightsNav", "#insightsPane"],
    ["#eventsNav", "#eventsPane"],
  ] as const) {
    await page.locator(nav).click();
    const scroller = page.locator(`${pane} .scrollable`).first();
    // Insights renders a placeholder until its forecast arrives.
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      )
      .toBeGreaterThanOrEqual(32);
    const left = await scroller.evaluate((element) => {
      element.scrollTop = Math.min(
        120,
        element.scrollHeight - element.clientHeight,
      );
      return element.scrollTop;
    });
    expect(left).toBeGreaterThanOrEqual(32);
    // Let the scroll event land before the pane unmounts.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    await page.locator(nav).click();
    await expect(page.locator(".gameToolPanel:visible")).toHaveCount(0);
    await page.locator(nav).click();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(left);
    await page.locator(nav).click();
  }
});

async function expectFloatingDock(page: Page) {
  const [stage, facilities, fleet, dock, width] = await Promise.all([
    page.locator(".gameStage").boundingBox(),
    page.locator(".gameStage .facilities").boundingBox(),
    page.locator(".gameFleet").boundingBox(),
    page.locator("#navfooter").boundingBox(),
    page.evaluate(() => window.innerWidth),
  ]);
  // The dock overlays the full-height fleet instead of reserving a blank footer band.
  expect(
    Math.abs(facilities!.y + facilities!.height - stage!.y - stage!.height),
  ).toBeLessThanOrEqual(1);
  expect(dock!.y).toBeLessThan(facilities!.y + facilities!.height);
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(stage!.y + stage!.height);
  // Centered on the window, so opening a side tool doesn't move it, unless that would cover
  // the tool: then it centres on the free stage. Either way it stays clear of side tools.
  const center = dock!.x + dock!.width / 2;
  expect(
    Math.min(
      Math.abs(center - width / 2),
      Math.abs(center - (fleet!.x + fleet!.width / 2)),
    ),
  ).toBeLessThanOrEqual(1);
  expect(dock!.x).toBeGreaterThanOrEqual(fleet!.x);
  expect(dock!.x + dock!.width).toBeLessThanOrEqual(fleet!.x + fleet!.width);
}

async function expectSideRails(page: Page) {
  const fleet = (await page.locator(".gameFleet").boundingBox())!;
  // However many tools are open, the fleet keeps at least the widest phone's width.
  expect(fleet.width).toBeGreaterThanOrEqual(430);
  const panels = await page
    .locator(".gameToolPanel:visible")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { left, right, width } = element.getBoundingClientRect();
        return { left, right, width };
      }),
    );
  for (const panel of panels) {
    expect(panel.width).toBeGreaterThanOrEqual(360);
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
      await expect(action).toContainText(label);
      await expect(action).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const box = (await action.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
    }
    await expectFloatingDock(page);
    await reviewScreenshot(page, {
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
    await reviewScreenshot(page, {
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

test("icon labels support hover, keyboard focus, and touch hold-and-slide without opening tools", async ({
  page,
}, testInfo) => {
  await startGame(page, "light");
  const dock = page.locator("#navfooter");
  const status = page.locator(".gridHealth");
  if (page.viewportSize()!.width < 700) {
    // Phones shrink a stable grid to a checked bolt; the readout is a tap away.
    const summary =
      /^Stable, \d.*[kMGT]?W demand met with \d.*[kMGT]?W reserve$/;
    const bolt = status.getByRole("button", {
      name: /^Current grid status: Stable, /,
    });
    await expect(bolt).toHaveCSS("height", "44px");
    await expect(status.locator(".gridHealthMetric")).toHaveCount(0);
    await bolt.tap();
    await expect(page.getByRole("tooltip", { name: summary })).toBeVisible();
    await bolt.tap();
    await expect(page.getByRole("tooltip", { name: summary })).toHaveCount(0);
    await bolt.tap();
    await expect(page.getByRole("tooltip", { name: summary })).toBeVisible();
    await page
      .locator(".gameStage .facilities")
      .tap({ position: { x: 8, y: 8 } });
    await expect(page.getByRole("tooltip", { name: summary })).toHaveCount(0);
  } else {
    await expect(status.locator(".gridHealthMetric")).toHaveText(
      /^Stable, \d.*[kMGT]?W reserve$/,
    );
    await expect(status.locator(".gridHealthMetric")).toHaveCSS(
      "text-align",
      "left",
    );
  }
  await expect(status).toHaveCSS("border-right-width", "0px");

  if (!testInfo.project.use.hasTouch) {
    // Pointer and keyboard users see each tool's shortcut key.
    await page.locator("#buildNav").hover();
    await expect(
      page.getByRole("tooltip", { name: "Build (Q)", exact: true }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await page.locator("#programsNav").focus();
    await expect(
      page.getByRole("tooltip", { name: "Programs (W)", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    return;
  }

  const session = await page.context().newCDPSession(page);
  const dockBox = (await dock.boundingBox())!;
  const y = dockBox.y + dockBox.height / 2;
  // Start on the bar's padding, then move across every icon while holding the same finger.
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: dockBox.x + 2, y }],
  });
  await page.waitForTimeout(600);
  for (const [id, label] of [
    ["buildNav", "Build"],
    ["programsNav", "Programs"],
    ["insightsNav", "Insights"],
    ["eventsNav", "Events"],
  ]) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: box.x + box.width / 2, y }],
    });
    await expect(
      page.getByRole("tooltip", { name: label, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
  }
  await reviewScreenshot(page, {
    path: testInfo.outputPath("workspace-touch-labels.png"),
    animations: "disabled",
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page.locator(".gameToolPanel")).toHaveCount(0);
  // Starting on an icon also works when native capture transfers from the button to the bar.
  const programs = (await page.locator("#programsNav").boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: programs.x + programs.width / 2, y }],
  });
  await expect(
    page.getByRole("tooltip", { name: "Programs", exact: true }),
  ).toBeVisible();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: dockBox.x - 20, y }],
  });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const events = (await page.locator("#eventsNav").boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: events.x + events.width / 2, y }],
  });
  await expect(
    page.getByRole("tooltip", { name: "Events", exact: true }),
  ).toBeVisible();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page.locator(".gameToolPanel")).toHaveCount(0);
  const build = (await page.locator("#buildNav").boundingBox())!;
  await page.touchscreen.tap(build.x + build.width / 2, y);
  await expect(
    page.getByRole("region", { name: "Build", exact: true }),
  ).toBeVisible();
  await session.detach();
});

test("Programs keeps points visible through monthly forecast refreshes", async ({
  page,
}, testInfo) => {
  await startGame(page, testInfo.project.use.hasTouch ? "light" : "dark", 107);
  await page.locator("#programsNav").click();
  const pricing = page.getByRole("region", { name: "Electricity pricing" });
  const points = pricing.locator(".insightsRateScore");
  await expect(points).toHaveText(/[±+−]\d[\d,]* pts/);
  await pricing.getByRole("slider").press("ArrowLeft");
  await expect(points).toHaveText(/\+\d[\d,]* pts/);
  await pricing.evaluate((element) => {
    const months = new Set<string>();
    const sample = () => {
      if (
        element
          .querySelector(".insightsRateScore")
          ?.textContent?.includes("Calculating")
      ) {
        element.setAttribute("data-score-blanked", "true");
      }
      const month = document
        .querySelector(".gameStatus .weak")
        ?.textContent?.match(/^\w+ \d+/)?.[0];
      if (month) months.add(month);
      element.setAttribute("data-observed-months", String(months.size));
    };
    sample();
    const observer = new MutationObserver(sample);
    const options = { subtree: true, childList: true, characterData: true };
    observer.observe(element, options);
    observer.observe(document.querySelector("#appbar")!, options);
  });
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect
    .poll(
      async () => Number(await pricing.getAttribute("data-observed-months")),
      { timeout: 60_000 },
    )
    .toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(pricing).not.toHaveAttribute("data-score-blanked", "true");
  await settleSheets(page);
  await page.mouse.move(0, 0);
  await reviewScreenshot(page, {
    path: testInfo.outputPath("programs-points-estimate.png"),
    animations: "disabled",
  });
  await page.locator("#insightsNav").click();
  await expect(
    page.getByRole("button", { name: "Zoom out", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Displayed date range: 2017–23", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Monthly forecast ranges show/)).toHaveCount(0);
  if (testInfo.project.use.hasTouch) {
    await settleSheets(page);
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: testInfo.outputPath("insights-scenario-range.png"),
      animations: "disabled",
    });
  }
});

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
  await reviewScreenshot(page, {
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
  await reviewScreenshot(page, {
    path: testInfo.outputPath("workspace-programs-detail.png"),
    animations: "disabled",
  });
  await programs.locator(".customerProgramsBody").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    programs.getByRole("img", { name: /^Estimated demand:/ }),
  ).toBeInViewport();
  await reviewScreenshot(page, {
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
  // A sheet shows one tool at a time; side columns keep Programs open beside Build.
  if (
    (await page.locator(".gameStage").getAttribute("data-layout")) === "sheet"
  )
    await expect(programs).toHaveCount(0);
  else await expect(programs).toBeVisible();
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

test("wide screens keep several tools beside the fleet and remember them across compact layouts", async ({
  page,
}, testInfo) => {
  test.skip(
    !!testInfo.project.use.hasTouch,
    "Desktop rails use a wide pointer workspace",
  );
  await page.setViewportSize({ width: 2240, height: 1100 });
  await startGame(page, "light");
  await page.locator("#buildNav").click();
  await expectFloatingDock(page);
  await page.locator("#insightsNav").click();
  await expect(page.locator(".gameToolPanel")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator("#buildNav, #insightsNav")
        .evaluateAll(
          (elements) =>
            new Set(
              elements.map(
                (element) => getComputedStyle(element).backgroundColor,
              ),
            ).size,
        ),
    )
    .toBe(1);
  await expect(page.locator("#chartForecastSupplyDemand")).toBeVisible({
    timeout: 60_000,
  });
  await settleSheets(page);
  await expect(page.locator(".gameStage")).toHaveAttribute(
    "data-layout",
    "side",
  );
  await expectSideRails(page);
  await expect(
    page.locator(".gameToolHeader").getByRole("tablist"),
  ).toHaveCount(0);
  // Three tools fit beside a phone-width fleet at this width.
  await page.locator("#programsNav").click();
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(3);
  for (const name of ["Build", "Programs", "Insights"])
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  // A fourth doesn't, so the least recently opened tool steps aside.
  await page.locator("#eventsNav").click();
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Build", exact: true }),
  ).toBeHidden();
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(3);
  await expectSideRails(page);
  await expect(
    page.getByRole("button", { name: /^(?:Unpin|Pin) /i }),
  ).toHaveCount(0);
  // Events is the most recently opened tool, but the player is working in Programs.
  // Narrowing preserves the focused decision instead of hiding it for the newer tool.
  const rate = page.locator("#rateSlider input");
  const value = await rate.inputValue();
  await reviewScreenshot(page, {
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
  await expect(rate).toBeFocused();
  await expect(rate).toHaveValue(value);
  await page.setViewportSize({ width: 2240, height: 1100 });
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(rate).toBeFocused();
  await expectSideRails(page);

  // A compact sheet reveals a remembered tool rather than closing an unseen one.
  await page.setViewportSize({ width: 1023, height: 900 });
  await expect(page.locator(".gameStage")).toHaveAttribute(
    "data-layout",
    "sheet",
  );
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
  await expectFloatingDock(page);
  await page.locator("#eventsNav").click();
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Programs", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#eventsNav")).toBeFocused();
  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(0);
  await page.locator("#programsNav").click();
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

for (const theme of ["light", "dark"] as const) {
  test(`desktop controls and side rails switch together at 1300px in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");
    await page.setViewportSize({ width: 1299, height: 800 });
    await startGame(page, theme, 111);
    await page.locator("#programsNav").click();
    const rate = page.locator("#rateSlider input");
    await rate.focus();
    await rate.press("ArrowRight");
    const value = await rate.inputValue();
    const stage = page.locator(".gameStage");
    const appbar = page.locator("#appbar");
    const ultra = page.getByRole("button", {
      name: "ultra speed",
      exact: true,
    });
    for (const width of [1299, 1300, 1440, 1299]) {
      await page.setViewportSize({ width, height: 800 });
      const desktop = width >= 1300;
      const profit = appbar.getByLabel(/^Monthly profit forecast/);
      await expect(profit).toBeVisible();
      await expect(profit).toHaveText(/^[+−-]?\$[\d.,]+[KMBT]?\/mo$/);
      expect(await profit.evaluate((el) => el.getClientRects().length)).toBe(1);
      const [cashBox, profitBox, dateBox] = await Promise.all([
        appbar.locator(".gameStatusValue").first().boundingBox(),
        profit.boundingBox(),
        appbar.locator(".gameStatusValue.weak").boundingBox(),
      ]);
      expect(profitBox!.x).toBeGreaterThan(cashBox!.x + cashBox!.width);
      expect(dateBox!.x).toBeGreaterThan(profitBox!.x + profitBox!.width);
      await expect(stage).toHaveAttribute("data-layout", "side");
      if (desktop) {
        await expect(appbar).toHaveClass(/appbarSingleRow/);
        await expect(ultra).toBeInViewport();
        await expectSideRails(page);
      } else {
        await expect(appbar).not.toHaveClass(/appbarSingleRow/);
        await expect(ultra).toHaveCount(0);
      }
      await expect(rate).toBeFocused();
      await expect(rate).toHaveValue(value);
      await expect(page.locator("#navfooter")).toBeInViewport();
      expect(
        await appbar.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    await page.locator("#programsNav").click();
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `monthly-profit-${theme}.png`,
        ),
      });
      await appbar.locator(".gameStatus").screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `monthly-profit-detail-${theme}.png`,
        ),
      });
    }
    for (const width of [700, 699, 390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      const profit = appbar.getByLabel(/^Monthly profit forecast/);
      if (width >= 700) await expect(profit).toBeVisible();
      else await expect(profit).toHaveCount(0);
      expect(
        await appbar.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`desktop profit and warning controls fit with a large negative balance in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop-chromium");
    await page.setViewportSize({ width: 1300, height: 800 });
    await startGame(page, theme, 111);
    await editSavedGame(page, (save) => {
      save.game.lowCashWarningMonth = save.game.date.monthsElapsed;
      for (const tick of save.game.timeline) {
        tick.cash = -999999999999;
        tick.revenue = 0;
        tick.expensesFuel = 99999999;
        tick.supplyW = tick.demandW * 0.9;
      }
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const appbar = page.locator("#appbar");
    for (const width of [1300, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(appbar.getByLabel(/^Monthly profit forecast/)).toBeVisible();
      await expect(
        appbar.getByRole("button", { name: "ultra speed", exact: true }),
      ).toBeInViewport();
      expect(
        await appbar.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (process.env.REVIEW_SCREENSHOT_DIR && width === 1300) {
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `monthly-profit-warning-${theme}.png`,
          ),
          animations: "disabled",
        });
      }
    }
  });
}

test("short desktop rails keep their heading, scroll body, and floating dock reachable", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.hasTouch, "A short desktop viewport");
  await page.setViewportSize({ width: 1300, height: 480 });
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
  await reviewScreenshot(page, {
    path: testInfo.outputPath("workspace-short-desktop.png"),
    animations: "disabled",
  });
});

for (const width of [360, 390]) {
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
    await expect(
      programs.getByRole("img", { name: /^Estimated demand:/ }),
    ).toBeInViewport();
    expect(
      await page
        .locator(".gameWorkspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await expect(page.locator("#eventsNav")).toBeInViewport();
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`workspace-floating-dock-${width}.png`),
      animations: "disabled",
    });
  });
}
