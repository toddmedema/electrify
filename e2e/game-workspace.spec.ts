import { reviewScreenshot } from "./review-screenshot";
import { openBuild, openFleet, openPane } from "./layout";
import { expect, Page, test } from "./fixtures";
import path from "node:path";
import { editSavedGame } from "./save-fixture";

test.setTimeout(90_000);

async function startGame(
  page: Page,
  theme: "light" | "dark",
  scenarioId = 100,
  scale = 1,
) {
  await page.addInitScript(
    ({ mode, scale }) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("interfaceScale", String(scale));
      // Layout assertions need the same weather and risk headline on every visit.
      Math.random = () => 0.25;
    },
    { mode: theme, scale },
  );
  await page.goto(`/?scenario=${scenarioId}`);
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator("#mapPane")).toBeVisible();
  await page.keyboard.press("0");
  await expect(page.locator("#mapPane > .paneHeader")).toHaveCount(0);
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

test("snackbars clear medium and large floating docks", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium");
  await startGame(page, "light", 111);
  for (const width of [1600, 2200]) {
    await page.setViewportSize({ width, height: 1080 });
    await expect(page.locator(".gameWorkspace")).toHaveAttribute(
      "data-dock-size",
      width === 2200 ? "large" : "medium",
    );
    await page.keyboard.press("Shift+1");
    const snackbar = page.locator(".snackbar-above-nav");
    await expect(snackbar).toBeVisible();
    await expect
      .poll(async () => {
        const [toast, dock] = await Promise.all([
          snackbar.boundingBox(),
          page.locator("#navfooter").boundingBox(),
        ]);
        return toast!.y + toast!.height - dock!.y;
      })
      .toBeLessThanOrEqual(-8);
    await snackbar
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    await expect(snackbar).not.toBeVisible();
  }
});

test("map notifications follow the full desktop header and clear the compact dock", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (!info.project.use.hasTouch)
    await page.setViewportSize({ width: 1119, height: 800 });
  await startGame(page, "light", 116);
  const header = page.locator("#appbar");
  const dock = page.locator("#navfooter");
  const snackbar = page.locator(".snackbar-above-nav");
  await page.keyboard.press("Shift+1");
  await expect(snackbar).toBeVisible();

  if (info.project.use.hasTouch) {
    const toast = (await snackbar.boundingBox())!;
    expect(toast.y).toBeGreaterThan(page.viewportSize()!.height / 2);
    expect(toast.y + toast.height).toBeLessThan((await dock.boundingBox())!.y);
    return;
  }

  const expectBelowHeader = async () => {
    await expect
      .poll(async () => {
        const [toast, bar] = await Promise.all([
          snackbar.boundingBox(),
          header.boundingBox(),
        ]);
        return Math.round(toast!.y - bar!.y - bar!.height);
      })
      .toBe(8);
    const toast = (await snackbar.boundingBox())!;
    expect(toast.x + toast.width / 2).toBeCloseTo(
      page.viewportSize()!.width / 2,
      0,
    );
  };
  await expect(header).not.toHaveClass(/appbarSingleRow/);
  await expectBelowHeader();
  await reviewScreenshot(page, {
    path: info.outputPath("desktop-map-notification.png"),
  });
  await snackbar.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(snackbar).toBeHidden();

  // A wider header folds into a single row. The toast tracks it even over an open tool.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(header).toHaveClass(/appbarSingleRow/);
  const insights = page.getByRole("region", { name: "Insights", exact: true });
  await openPane(insights, dock.getByRole("button", { name: "Insights" }));
  await page.keyboard.press("Shift+1");
  await expect(snackbar).toBeVisible();
  await expectBelowHeader();
});

for (const side of [false, true]) {
  test(`purchases ${side ? "keep the Build window open" : "close the compact Build panel"}`, async ({
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
      const before = await (
        await openFleet(page)
      )
        .locator(".facilityRow, .transmissionLine")
        .count();
      await page.getByRole("button", { name: "Close Fleet" }).click();
      const build = await openBuild(page);
      await build.getByRole("tab", { name: category, exact: true }).click();
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
      if (side) {
        await expect(build).toBeVisible();
        await build
          .getByRole("button", { name: "Close Build", exact: true })
          .click();
      } else {
        await expect(build).toHaveCount(0);
      }
      const fleet = await openFleet(page);
      await expect(
        fleet.locator(".facilityRow, .transmissionLine"),
      ).toHaveCount(before + 1);
      await page.getByRole("button", { name: "Close Fleet" }).click();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
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

  test(`mobile grid status keeps the power visible during a blackout in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(page.viewportSize()!.width >= 700);
    await startGame(page, theme);
    const status = page.locator(".gridHealth");
    await expect(status).toHaveClass(/gridHealth-stable/);
    await openFleet(page);
    await page
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause Coal", exact: true }).click();
    await expect(status).toHaveClass(/gridHealth-blackout/);
    const readout = status.getByRole("button", {
      name: /^Current grid status: NOW .* short/,
    });
    await expect(readout).toContainText(/NOW.*MW.*short/);
    expect((await readout.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await readout.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await readout.tap();
    const dialog = page.getByRole("dialog", {
      name: "Grid status",
      exact: true,
    });
    await expect(
      dialog.getByRole("heading", { name: "Now · Shortage" }),
    ).toBeVisible();
    await expect(dialog).toContainText(/\d.*MW short/);
    await expect(
      dialog.getByRole("button", { name: "View supply forecast" }),
    ).toHaveClass(/MuiButton-contained/);
    await reviewScreenshot(dialog, {
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
    await expect(programs.locator(".customerProgramTitle")).toHaveCount(5);
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
    await page.keyboard.press("t");
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startGame(page, "dark");
  const build = page.getByRole("region", { name: "Build", exact: true });
  await page.locator("#insightsNav").click();
  await page.locator("#buildNav").click();
  const size = build.locator(".constructionCapacitySlider input");
  await size.focus();
  await size.press("ArrowRight");
  const generatorSize = await size.inputValue();
  // Measure tab restoration after forecast charts have finished laying out the list.
  await expect(
    build.getByText("Calculating output and energy costs…", { exact: true }),
  ).toHaveCount(0);
  const list = build.locator(".cardList");
  const left = await list.evaluate((element) =>
    Math.min(240, element.scrollHeight - element.clientHeight),
  );
  expect(left).toBeGreaterThan(0);
  await list.evaluate((element, position) => {
    element.scrollTop = position;
  }, left);
  const scrollPosition = () => list.evaluate((element) => element.scrollTop);
  await expect.poll(scrollPosition).toBe(left);
  // Let the scroll event land before switching tabs.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
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
  await expect.poll(scrollPosition).toBe(left);
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

async function expectWorkspaceDock(page: Page) {
  await expect(async () => {
    const { stage, map, dock, width, height } = await page.evaluate(() => {
      const box = (selector: string) => {
        const { x, y, width, height } = document
          .querySelector(selector)!
          .getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        stage: box(".gameStage"),
        map: box(".gameMapStage"),
        dock: box("#navfooter"),
        width: window.innerWidth,
        height: window.innerHeight,
      };
    });
    expect(map).toEqual(stage);
    expect(dock.height).toBeGreaterThanOrEqual(44);
    expect(dock.y + dock.height).toBeLessThanOrEqual(height + 1);
    expect(dock.x).toBeGreaterThanOrEqual(0);
    expect(dock.x + dock.width).toBeLessThanOrEqual(width + 1);
    expect(Math.abs(dock.x + dock.width / 2 - width / 2)).toBeLessThanOrEqual(
      1,
    );
  }).toPass({ timeout: 12000 });
}

async function expectWindowsToClearDock(page: Page) {
  const dock = (await page.locator("#navfooter").boundingBox())!;
  const panels = await page
    .locator(".gameToolPanel:visible")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { width, bottom } = element.getBoundingClientRect();
        return { width, bottom };
      }),
    );
  for (const panel of panels) {
    expect(panel.width).toBeGreaterThanOrEqual(360);
    expect(panel.width).toBeLessThanOrEqual(480);
    expect(panel.bottom).toBeLessThanOrEqual(dock.y + 1);
  }
  await expectWorkspaceDock(page);
}

for (const theme of ["light", "dark"] as const) {
  test(`game dock and tools stay usable in ${theme}`, async ({
    page,
  }, testInfo) => {
    await startGame(page, theme);
    const dock = page.locator("#navfooter");
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    const labels = ["Programs", "Insights", "Events"];
    if (page.viewportSize()!.width < 1024) labels.push("Build");
    for (const label of labels) {
      const action = dock.getByRole("button", { name: label, exact: true });
      await expect(action).toBeVisible();
      await expect(action).not.toContainText(label);
      await expect(action).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const box = (await action.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
    }
    await expectWorkspaceDock(page);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`workspace-facilities-${theme}.png`),
      animations: "disabled",
    });

    const map = page.locator(".gameMapStage");
    await map.evaluate((element) =>
      element.setAttribute("data-test-mounted", "kept"),
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
    await expect(map).toHaveAttribute("data-test-mounted", "kept");
    await expect(page.locator("#rateSlider")).toHaveCount(0);
    await expect(insights.locator("#chartForecastSupplyDemand")).toBeVisible({
      timeout: 60_000,
    });
    const fleet = await openFleet(page);
    const chart = fleet.locator("#chartSupplyDemand").getByRole("img");
    await chart.focus();
    await chart.press("Enter");
    await expect(page.locator(".chartTooltip:visible")).toHaveCount(1);
    await chart.press("Escape");
    await expect(page.locator(".chartTooltip:visible")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close Fleet", exact: true })
      .click();
    await openPane(
      insights,
      dock.getByRole("button", { name: "Insights", exact: true }),
    );
    await expect(
      insights.getByRole("heading", { name: "Insights", exact: true }),
    ).toBeVisible();
    await expectWorkspaceDock(page);
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
    await expect(map).toHaveAttribute("data-test-mounted", "kept");

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

test("dock labels support pointer, keyboard and touch without accidental tool activation", async ({
  page,
}, testInfo) => {
  await startGame(page, "light");
  const dock = page.locator("#navfooter");
  const status = page.locator(".gridHealth");
  const labels = ["Programs", "Insights", "Events"];
  if (page.viewportSize()!.width < 1024) labels.push("Build");
  for (const name of labels) {
    const action = dock.getByRole("button", { name, exact: true });
    await expect(action).toBeVisible();
    await expect(action).not.toContainText(name);
  }
  const readout = status.getByRole("button", {
    name: /^Current grid status: NOW/,
  });
  await expect(readout).toContainText(/NOW.*W.*reserve/);
  await expect(readout).toHaveCSS("text-align", "left");
  await readout.click();
  const diagnosis = page.getByRole("dialog", {
    name: "Grid status",
    exact: true,
  });
  await expect(diagnosis).toBeVisible();
  await diagnosis.getByRole("button", { name: "Close grid status" }).click();
  await expect(diagnosis).toHaveCount(0);
  await expect(readout).toBeFocused();
  await expect(status).toHaveCSS("border-right-width", "0px");

  if (!testInfo.project.use.hasTouch) {
    // Pointer and keyboard users see each tool's shortcut key.
    await page.locator("#buildNav").hover();
    await expect(
      page.getByRole("tooltip", { name: "Build (B)", exact: true }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    // The diagnostic exercised pointer input; switch back to real keyboard modality.
    await page.keyboard.press("Tab");
    await page.locator("#programsNav").focus();
    await expect(
      page.getByRole("tooltip", { name: "Programs (R, P)", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    return;
  }

  const session = await page.context().newCDPSession(page);
  const dockBox = (await dock.boundingBox())!;
  const y = dockBox.y + dockBox.height / 2;
  if (page.viewportSize()!.width < 700) {
    // Holding owns the slide preview; a quick swipe still scrolls the compact rail.
    const actions = ["Build", "Programs", "Insights", "Events"];
    for (const label of actions) {
      const action = dock.getByRole("button", { name: label, exact: true });
      await expect(action).not.toContainText(label);
    }
    const build = (await page.locator("#buildNav").boundingBox())!;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: build.x + build.width / 2, y }],
    });
    await page.waitForTimeout(600);
    await expect(
      page.getByRole("tooltip", { name: "Build", exact: true }),
    ).toBeVisible();
    for (const label of actions.slice(1)) {
      const action = dock.getByRole("button", { name: label, exact: true });
      const box = (await action.boundingBox())!;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: box.x + box.width / 2, y }],
      });
      await expect(
        page.getByRole("tooltip", { name: label, exact: true }),
      ).toBeVisible();
      await expect(action).not.toContainText(label);
      await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    await dock.getByRole("button", { name: "Build", exact: true }).tap();
    await expect(
      page.getByRole("region", { name: "Build", exact: true }),
    ).toBeVisible();
    await session.detach();
    return;
  }
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

test("comparison controls keep keyboard focus when the Build layout changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startGame(page, "light");
  await openBuild(page);
  await page.getByRole("button", { name: "Compare Coal", exact: true }).click();
  const clear = page.getByRole("button", { name: "Clear", exact: true });
  await clear.focus();
  await clear.press("Tab");
  const remove = page.getByRole("button", {
    name: "Remove Coal from comparison",
  });
  await expect(remove).toBeFocused();
  for (const width of [390, 1280, 360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 700)
      await expect(page.locator(".gameWorkspace")).not.toHaveAttribute(
        "data-map-windows",
        "true",
      );
    else
      await expect(page.locator(".gameWorkspace")).toHaveAttribute(
        "data-map-windows",
        "true",
      );
    await expect(remove).toBeFocused();
    await expect(
      page.getByRole("region", { name: "Generator comparison" }),
    ).toContainText("Comparing 1/3");
  }
  await clear.focus();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(clear).toBeFocused();
  await clear.press("Enter");
  await expect(
    page.getByRole("region", { name: "Generator comparison" }),
  ).toHaveCount(0);
});

test("quick touch swipes scroll the enlarged dock without opening a tool", async ({
  page,
}, info) => {
  test.skip(!info.project.use.hasTouch);
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 1080,
  });
  await startGame(page, "light", 100, 2);
  // The Fleet setup clicks with the mouse. Park it outside the dock so a
  // button scrolling under the stationary cursor cannot produce a hover label.
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const dock = page.locator("#navfooter");
  const box = (await dock.boundingBox())!;
  // Maximum interface scale gives the compact dock a horizontal scroll range.
  expect(
    await dock.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeGreaterThan(50);
  const session = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width - 24, y }],
  });
  for (let step = 1; step <= 5; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: box.x + box.width - 24 - (step * (box.width - 48)) / 5, y },
      ],
    });
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => dock.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(20);
  await expect(page.locator(".gameToolPanel")).toHaveCount(0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
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

test("pricing keeps changing customer forecasts on one line", async ({
  page,
}, info) => {
  await startGame(page, "dark");
  await page.locator("#programsNav").click();
  const pricing = page.getByRole("region", { name: "Electricity pricing" });
  await expect(pricing).toBeVisible();
  await settleSheets(page);
  const rate = pricing.getByRole("slider");
  for (const key of ["Home", "End", "ArrowLeft", "ArrowLeft", "ArrowLeft"]) {
    await rate.press(key);
    const metric = pricing.locator(".insightsRateMetric").last();
    const value = metric.locator(".insightsRateMetricValue");
    await expect(value).toContainText(/^[+-]?\d.*\(.*%\)$/);
    const geometry = await value.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        lines: range.getClientRects().length,
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(geometry.lines).toBe(1);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(
      await pricing
        .locator(".insightsRateMetrics")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await settleSheets(page);
  await pricing.getByRole("heading", { name: "Electricity pricing" }).click();
  await page.mouse.move(0, 0);
  await reviewScreenshot(page, {
    path: info.outputPath("pricing-customer-forecast.png"),
    animations: "disabled",
  });
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
  // Floating desktop windows can stay open together.
  if (!(await page.locator(".gameWorkspace").getAttribute("data-map-windows")))
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
  await expect(page.locator("#mapPane")).toBeVisible();
});

test("desktop map windows restore after narrowing around the active tool", async ({
  page,
}, testInfo) => {
  test.skip(
    !!testInfo.project.use.hasTouch,
    "Desktop windows use a fine pointer",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startGame(page, "light");
  const map = page.locator(".gameMapStage");
  await map.evaluate((element) =>
    element.setAttribute("data-test-mounted", "kept"),
  );
  await openFleet(page);
  await page.locator("#programsNav").click();
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  const rate = programs.locator("#rateSlider input");
  await rate.focus();
  const value = await rate.inputValue();
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(2);
  await expectWindowsToClearDock(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
  await expect(rate).toBeFocused();
  await expect(rate).toHaveValue(value);
  await expect(map).toHaveAttribute("data-test-mounted", "kept");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(2);
  await expect(rate).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(programs).toHaveCount(0);
  await expect(page.locator("#facilitiesPane")).toBeVisible();
  await expect(map).toHaveAttribute("data-test-mounted", "kept");
});

for (const theme of ["light", "dark"] as const) {
  test(`header and desktop speed changes preserve focus in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");
    await page.setViewportSize({ width: 1119, height: 800 });
    await startGame(page, theme, 111);
    await page.locator("#programsNav").click();
    const rate = page.locator("#rateSlider input");
    await rate.focus();
    await rate.press("ArrowRight");
    const value = await rate.inputValue();
    const appbar = page.locator("#appbar");
    const ultra = page.getByRole("button", {
      name: "ultra speed",
      exact: true,
    });
    for (const width of [1119, 1120, 1299, 1300, 1440, 1119]) {
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
      if (width >= 1120) {
        await expect(appbar).toHaveClass(/appbarSingleRow/);
      } else {
        await expect(appbar).not.toHaveClass(/appbarSingleRow/);
      }
      if (desktop) {
        await expect(ultra).toBeInViewport();
        await expectWindowsToClearDock(page);
      } else {
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
      await expect(profit).toBeVisible();
      expect(
        await appbar.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`enlarged phone status and edge-padded diagnosis remain readable in ${theme} @minimum-phone`, async ({
    page,
  }, info) => {
    test.skip(!info.project.use.hasTouch, "Phone status reflow");
    await startGame(page, theme, 111);
    for (const scale of ["1.25", "1.5", "2"]) {
      await page.getByRole("button", { name: "menu", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Settings", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Interface scale", exact: true })
        .selectOption(scale);
      const advanced = page.getByRole("button", {
        name: "Advanced display",
        exact: true,
      });
      if ((await advanced.getAttribute("aria-expanded")) !== "true")
        await advanced.click();
      await page.getByRole("button", { name: "4%", exact: true }).click();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      const appbar = page.locator("#appbar");
      await expect(appbar).toBeVisible();
      const geometry = await appbar
        .locator(".gameStatus")
        .evaluate((status) => {
          const box = status.getBoundingClientRect();
          return {
            overflow: status.scrollWidth - status.clientWidth,
            clipped: Array.from(
              status.querySelectorAll(".gameStatusValue, .gameMonthlyProfit"),
            ).map((value) => {
              const rect = value.getBoundingClientRect();
              return Math.max(
                box.left - rect.left,
                rect.right - box.right,
                box.top - rect.top,
                rect.bottom - box.bottom,
              );
            }),
          };
        });
      expect(geometry.overflow, `status width at ${scale}`).toBeLessThanOrEqual(
        1,
      );
      expect(
        Math.max(...geometry.clipped),
        `cash, profit and date at ${scale}`,
      ).toBeLessThanOrEqual(1);
      expect(
        await appbar.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await expect(page.locator("#navfooter")).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "menu", exact: true }),
      ).toBeInViewport();
      const status = appbar.getByRole("button", {
        name: /^Current grid status:/,
      });
      await status.tap();
      const diagnosis = page.getByRole("dialog", {
        name: "Grid status",
        exact: true,
      });
      await expect(diagnosis).toBeVisible();
      const edge = await diagnosis.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          minimum: Math.ceil(Math.min(innerWidth, innerHeight) * 0.04),
          left: rect.left,
          right: innerWidth - rect.right,
          top: rect.top,
          bottom: innerHeight - rect.bottom,
          viewportHeight: innerHeight,
          maximumHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
        };
      });
      expect(edge.left).toBeGreaterThanOrEqual(edge.minimum - 1);
      expect(edge.right).toBeGreaterThanOrEqual(edge.minimum - 1);
      expect(edge.top).toBeGreaterThanOrEqual(edge.minimum - 1);
      expect(edge.bottom).toBeGreaterThanOrEqual(edge.minimum - 1);
      expect(edge.maximumHeight).toBeLessThanOrEqual(
        edge.viewportHeight - 2 * edge.minimum,
      );
      await diagnosis
        .getByRole("button", { name: "Close grid status" })
        .click();
      await expect(diagnosis).toHaveCount(0);
      await expect(status).toBeFocused();
    }
  });

  test(`phone profit stacks beneath cash and opens finances in ${theme} @minimum-phone`, async ({
    page,
  }, info) => {
    test.skip(!info.project.use.hasTouch || page.viewportSize()!.width >= 700);
    await startGame(page, theme, 111);
    const appbar = page.locator("#appbar");
    const cash = appbar.locator(".gameStatusValue").first();
    const profit = appbar.getByLabel(/^Monthly profit forecast/);
    await expect(profit).toBeVisible();
    await expect(profit).toHaveText(/^[+−-]?\$[\d.,]+[KMBT]?\/mo$/);
    const [cashBox, profitBox, dateBox, speedsBox] = await Promise.all([
      cash.boundingBox(),
      profit.boundingBox(),
      appbar.locator(".gameStatusValue.weak").boundingBox(),
      appbar.locator("#speedChangeButtons").boundingBox(),
    ]);
    expect(profitBox!.y).toBeGreaterThanOrEqual(cashBox!.y + cashBox!.height);
    expect(Math.abs(profitBox!.x - cashBox!.x)).toBeLessThanOrEqual(1);
    expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(speedsBox!.x);
    expect(profitBox!.x + profitBox!.width).toBeLessThanOrEqual(speedsBox!.x);
    expect(
      await appbar.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: info.outputPath(`phone-profit-${theme}.png`),
      animations: "disabled",
    });
    await profit.click();
    await expect(
      page.getByRole("region", { name: "Insights", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.insights [data-layer="financeDetails"]'),
    ).toBeInViewport();
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

test("short desktop windows keep their heading, scroll body, and floating dock reachable", async ({
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
  await expectWindowsToClearDock(page);
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
  test(`compact ${width}px tools and final actions stay above the dock`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 640 });
    await startGame(page, "dark");
    await expect(page.locator(".gameWorkspace")).not.toHaveAttribute(
      "data-map-windows",
      "true",
    );
    await expectWorkspaceDock(page);
    const fleet = await openFleet(page);
    await fleet
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
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
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(
      stage!.y + stage!.height + 1,
    );
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
