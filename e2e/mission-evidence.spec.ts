import { editSavedGame, readSavedGame } from "./save-fixture";
import path from "path";
import { expect, test, type Page } from "./fixtures";
import { openPane, openBuild } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

const reviewProjects = new Set([
  "desktop-chromium",
  "mobile-390px",
  "mobile-360px",
]);
async function settle(page: Page) {
  await page.waitForTimeout(400);
}
async function openInsights(page: Page) {
  if (await openPane(page.locator(".insights"), page.locator("#insightsNav"))) {
    await settle(page);
  }
}
async function openBuildGenerators(page: Page) {
  await openBuild(page);
  await page.locator(".button-buildGenerator").click();
  await expect(page.locator(".buildOption").first()).toBeVisible();
}
// Autosave writes a new game's first save once the game goes live, which a loaded machine can
// reach after the first frame of the game screen. Poll the same pagehide flush the fixtures use
// until that save exists, rather than editing a save that may not have been written yet.
async function waitForSave(page: Page) {
  await expect.poll(async () => Boolean(await readSavedGame(page))).toBe(true);
}

async function expectWideHeaderRow(page: Page, alert: string, risk?: string) {
  const toolbar = page.locator("#topbar");
  const term = toolbar.getByRole("button", { name: /months? left$/ });
  const row = [
    toolbar.locator(".gameStatusValue").first(),
    toolbar.getByLabel(/^Monthly profit forecast/),
    toolbar.locator("[data-game-minute]"),
    toolbar.getByText(/^NOW /),
    toolbar.getByText(/^FUTURE /),
    ...(risk ? [toolbar.getByText(risk, { exact: true })] : []),
    term,
    toolbar.getByRole("button", { name: alert, exact: true }),
    toolbar.getByRole("group", { name: "game speed" }),
  ];
  // Check the single-row boundary and the points where extra content comes back.
  for (const width of [1120, 1280, 1300, 1321, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = [];
    for (const item of row) {
      await expect(item).toBeInViewport({ ratio: 1 });
      boxes.push((await item.boundingBox())!);
    }
    await expectGoalBelowTime(term, "Acquire utilities (0/3)");
    const middle = boxes[0].y + boxes[0].height / 2;
    for (const [index, box] of boxes.entries()) {
      expect(box.y).toBeLessThan(middle);
      expect(box.y + box.height).toBeGreaterThan(middle);
      if (index > 0) {
        const previous = boxes[index - 1];
        expect(box.x).toBeGreaterThanOrEqual(previous.x + previous.width);
      }
    }
  }
}

async function expectGoalBelowTime(
  term: ReturnType<Page["locator"]>,
  goal: string | RegExp,
) {
  const time = (await term.locator(":scope > span").first().boundingBox())!;
  const goalLine = term.getByText(goal);
  await expect(goalLine).toBeInViewport({ ratio: 1 });
  expect((await goalLine.boundingBox())!.y).toBeGreaterThanOrEqual(
    time.y + time.height,
  );
}

async function expectCompactStatusRow(page: Page) {
  const grid = (await page
    .getByRole("button", { name: /^Current grid status:/ })
    .boundingBox())!;
  const term = (await page
    .getByRole("button", { name: /months left$/ })
    .boundingBox())!;
  expect(grid.height).toBeGreaterThanOrEqual(44);
  expect(term.height).toBeGreaterThanOrEqual(44);
  expect(grid.x + grid.width).toBeLessThan(term.x);
  expect(grid.y + grid.height).toBeGreaterThan(term.y + term.height / 2);
  expect(term.y + term.height).toBeGreaterThan(grid.y + grid.height / 2);
}

async function range(page: Page) {
  return page
    .locator(".insights:visible .accessibleChart [role=img]")
    .first()
    .evaluate((el) => [
      el.getAttribute("data-viewport-min"),
      el.getAttribute("data-viewport-max"),
    ]);
}
for (const theme of ["light", "dark"]) {
  test(`grid warnings separate current reserve from future supply risk in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!reviewProjects.has(info.project.name));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await waitForSave(page);
    await editSavedGame(page, (save) => {
      // Keep finances solvent and today's sample supplied so the long-term supply risk
      // appears beside low reserve, through the real forecast and saved-game entry point.
      save.game.dollarsPerkWh = 0.08;
      for (const tick of save.game.timeline) {
        tick.cash = 1e12;
        tick.supplyW = tick.demandW;
        tick.reserveW = tick.demandW * 0.05;
      }
      save.game.eventLog = [
        {
          id: 1,
          kind: "WORLD_EVENT",
          label: "Jan 2026",
          message: "Regional power market update",
        },
      ];
      save.game.eventLogReadThroughId = 0;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const grid = page.locator(".gridHealth:visible");
    const risk = grid.getByRole("button", {
      name: /^Current grid status: NOW.*FUTURE Supply risk:/,
    });
    await expect(risk).toBeVisible({ timeout: 30_000 });
    await expect(grid).toHaveClass(/gridHealth-low-reserve/);
    await expect(risk).toContainText(/NOW.*reserve.*Low.*FUTURE Supply risk:/);
    await expect(
      page
        .locator(".missionRiskButton:visible")
        .filter({ hasText: "Supply risk:" }),
    ).toHaveCount(0);
    expect(await risk.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    if (info.project.name === "desktop-chromium") {
      const events = page.getByRole("button", {
        name: "Unread events",
        exact: true,
      });
      await expect(events).toHaveText("");
      await expect(events.locator(".MuiBadge-dot")).toBeVisible();
      await expectWideHeaderRow(page, "Unread events");
      await page.setViewportSize({ width: 1120, height: 900 });
    } else {
      const term = page.getByRole("button", { name: /months left$/ });
      await expectGoalBelowTime(term, "Acquire utilities (0/3)");
      await expectCompactStatusRow(page);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const screenshotDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      screenshotDir &&
      (info.project.name === "desktop-chromium" ||
        (theme === "dark" && info.project.name === "mobile-390px"))
    ) {
      await page.locator("#appbar:visible").screenshot({
        path: path.join(
          screenshotDir,
          `warnings-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await risk.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog", { name: "Grid status", exact: true })
      .getByRole("button", { name: "View supply forecast" })
      .click();
    await expect(
      page.getByRole("region", { name: "Insights", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.insights:visible [data-layer="supplyDemand"]'),
    ).toBeVisible();

    await editSavedGame(page, (save) => {
      const game = save.game;
      const minute = game.date.minute;
      const later = game.timeline.find((tick) => tick.minute > minute);
      if (!later) throw new Error("Expected a future tick in the grid sample");
      later.supplyW = later.demandW * 0.9;
      game.worldEvents.active.push({
        key: "header-storm-damage",
        definitionId: "header-storm-damage",
        title: "Storm damage",
        message: "Storm damage disrupts the regional grid.",
        importance: "CRITICAL",
        startsMinute: minute,
        endsMinute: minute + 1440,
        attributes: {},
        effects: {},
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(grid.getByText(/^FUTURE Short at/)).toBeVisible();
    if (info.project.name === "desktop-chromium") {
      await expectWideHeaderRow(
        page,
        "Ongoing emergency, unread events",
        "Active: Storm damage",
      );
      await reviewScreenshot(page.locator("#appbar:visible"), {
        path: info.outputPath(`emergency-header-${theme}.png`),
        animations: "disabled",
      });
    } else {
      const currentGrid = grid.getByRole("button", {
        name: /^Current grid status:/,
      });
      const storm = page.getByRole("button", { name: /^Active: Storm damage/ });
      const term = page.getByRole("button", { name: /months left$/ });
      await expect(storm.getByText("Active: Storm damage")).toBeInViewport({
        ratio: 1,
      });
      await expectGoalBelowTime(term, "Acquire utilities (0/3)");
      const gridBounds = (await currentGrid.boundingBox())!;
      const stormBounds = (await storm.boundingBox())!;
      const termBounds = (await term.boundingBox())!;
      expect(gridBounds.y + gridBounds.height).toBeLessThanOrEqual(
        stormBounds.y,
      );
      expect(stormBounds.x + stormBounds.width).toBeLessThanOrEqual(
        termBounds.x,
      );
      await currentGrid.focus();
      await page.keyboard.press("Tab");
      await expect(storm).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(term).toBeFocused();
    }
  });

  test(`compact mission tracker opens scenario info and stays usable during blackouts in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!reviewProjects.has(info.project.name));
    await page.addInitScript((mode) => {
      if (!sessionStorage.getItem("mission-evidence")) {
        localStorage.clear();
        sessionStorage.setItem("mission-evidence", "true");
      }
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await waitForSave(page);
    // Keep this layout/focus fixture solvent so a valid long-term cash warning does not
    // replace the upcoming-event label under test.
    await editSavedGame(page, (save) => {
      for (const tick of save.game.timeline) tick.cash = 1e12;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator(".missionSummary:visible")).toContainText(
      "144 months left",
    );
    // The announced fee remains actionable alongside the term and authored goal.
    await expect(page.locator(".missionSummaryCopy:visible")).toContainText(
      info.project.name.startsWith("mobile") ? "Next:" : "Upcoming:",
    );
    const months = page.getByRole("button", { name: "144 months left" });
    await expectGoalBelowTime(months, /Keep ≥80% of customer baseline/);
    await expect(page.locator(".facilityActions:visible")).toHaveCount(0);
    if (info.project.name === "desktop-chromium") {
      const grid = await page.locator(".gridHealth:visible").boundingBox();
      const mission = await page
        .locator(".missionSummary:visible")
        .boundingBox();
      // The grid and mission controls stay centered in the same desktop row.
      expect(
        Math.abs(
          grid!.y + grid!.height / 2 - (mission!.y + mission!.height / 2),
        ),
      ).toBeLessThanOrEqual(1);
    }
    await settle(page);
    await months.click();
    const dialog = page.getByRole("region", { name: "Scenario", exact: true });
    await expect(dialog).toContainText(
      "Serving less than 90% of demand for 3 months in a row ends the run.",
    );
    await expect(dialog).toContainText("month-end");
    await expect(months).toHaveAttribute("aria-expanded", "true");
    await months.click();
    await expect(dialog).toHaveCount(0);
    await expect(months).toHaveAttribute("aria-expanded", "false");
    await expect(months).toBeFocused();
    await months.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Scenario", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause Coal", exact: true }).click();
    await page.getByRole("button", { name: "fast speed", exact: true }).click();
    await expect(page.locator(".gridHealth-blackout:visible")).toBeVisible();
    await page.getByRole("button", { name: "pause", exact: true }).click();
    await expect(page.locator(".missionRiskButton:visible")).toHaveCount(0);
    if (info.project.name.startsWith("mobile")) {
      await expectCompactStatusRow(page);
      await expectGoalBelowTime(months, /Keep ≥80% of customer baseline/);
    }
    await expect(page.locator("#chartSupplyDemand")).toBeVisible();
    for (const speed of ["normal speed", "fast speed", "pause"]) {
      await page.getByRole("button", { name: speed, exact: true }).click();
      await expect(page.locator("#chartSupplyDemand")).toBeVisible();
    }
    if (info.project.name.startsWith("mobile")) {
      // Facilities is the base layer: closing the open tool returns to it.
      for (const nav of ["Insights", "Events", "Facilities"]) {
        if (nav === "Facilities")
          await openPane(
            page.locator(".facilities"),
            page.locator("#faciltiesNav"),
          );
        else await page.getByRole("button", { name: nav, exact: true }).click();
        await settle(page);
        await expect(page.locator(".missionSummary:visible")).toContainText(
          "months left",
        );
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const screenshotDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      screenshotDir &&
      ((theme === "light" && info.project.name === "desktop-chromium") ||
        (theme === "dark" && info.project.name === "mobile-390px"))
    ) {
      await settle(page);
      await page.screenshot({
        path: path.join(
          screenshotDir,
          `mission-${info.project.name}-${theme}.png`,
        ),
      });
    }
  });
}

test("Insights keeps its date range while the build screen is open", async ({
  page,
}, info) => {
  test.skip(!reviewProjects.has(info.project.name));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".missionSummary:visible")).toBeVisible();
  await openInsights(page);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Pan later", exact: true }).click();
  const origin = await range(page);
  await openBuildGenerators(page);
  await page.getByRole("button", { name: "Close Build", exact: true }).click();
  await openInsights(page);
  expect(await range(page)).toEqual(origin);
});

test("cash evidence is temporary, explicit layer edits are configured, and reload remains paused", async ({
  page,
}, info) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-390px"]).has(info.project.name),
  );
  await page.addInitScript(() => {
    if (!localStorage.getItem("insightsLayers"))
      localStorage.setItem("insightsLayers", JSON.stringify(["supplyDemand"]));
  });
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".missionSummary:visible")).toBeVisible();
  await waitForSave(page);
  // A saved-game fixture isolates the presentation warning from economic outcomes.
  await editSavedGame(page, (save) => {
    // The cash warning dialog is covered separately; this fixture exercises its HUD link.
    save.game.lowCashWarningMonth = save.game.date.monthsElapsed;
    for (const tick of save.game.timeline) {
      tick.cash = -100;
      tick.supplyW = Math.max(tick.supplyW, tick.demandW);
    }
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".missionRiskButton:visible")).toContainText(
    "Check finances",
  );
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".missionRiskButton:visible").click();
  const finance = page.locator('[data-layer="financeDetails"]');
  await expect(finance).toBeFocused();
  await expect(finance).toContainText("Temporary evidence");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("insightsLayers")!),
    ),
  ).toEqual(["supplyDemand"]);
  await page.locator("#insightsLayersButton").click();
  const financeLayer = page.locator("#insightsLayerFinanceDetails");
  await expect(financeLayer).not.toBeChecked();
  await financeLayer.check();
  await expect(financeLayer).toBeChecked();
  await expect(finance).not.toContainText("Temporary evidence");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("insightsLayers")!),
    ),
  ).toEqual(["supplyDemand", "financeDetails"]);
});

test("large text and landscape keep mission controls and navigation reachable", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile-390px");
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".missionSummary:visible")).toBeVisible();
  for (const viewport of [
    { width: 390, height: 600 },
    { width: 740, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await page.addStyleTag({ content: "html { font-size: 150% !important; }" });
    const details = page.getByRole("button", {
      name: "Scenario",
      exact: true,
    });
    await details.scrollIntoViewIfNeeded();
    await details.click();
    await expect(
      page.getByRole("region", { name: "Scenario", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#eventsNav:visible").scrollIntoViewIfNeeded();
    await page.locator("#eventsNav:visible").click();
    await settle(page);
    await page
      .getByRole("button", { name: "Close Events", exact: true })
      .click();
    await settle(page);
    await page.locator(".button-buildFacility").scrollIntoViewIfNeeded();
    await page.locator(".button-buildFacility").click();
    await page.locator(".button-buildGenerator").click();
    await expect(page.locator(".buildOption").first()).toBeVisible();
    await page
      .getByRole("button", { name: "Close Build", exact: true })
      .click();
    await settle(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
});

test("projected sample evidence and a deliberate purchase retain the bounded investigation", async ({
  page,
}, info) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-390px"]).has(info.project.name),
  );
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".missionSummary:visible")).toBeVisible();
  await waitForSave(page);
  await editSavedGame(page, (save) => {
    // Derate the real starting fleet to 390 MW; the real reducer computes the sample.
    save.game.facilities.forEach((facility: { peakW: number }) => {
      facility.peakW *= 0.78;
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".missionSummary:visible")).toBeVisible();
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await page.getByRole("button", { name: "Pause Coal", exact: true }).click();
  // The pause confirmation can cover Resume on phones, and MUI keeps it open on hover.
  // Release the pointer and wait for it to clear before acting on the row beneath it.
  await page.mouse.move(0, 0);
  await expect(page.locator(".snackbarContent")).toBeHidden();
  await page.getByRole("button", { name: "Resume Coal", exact: true }).click();
  // A future shortfall stays explicit without replacing the current reserve.
  const grid = page.locator(".gridHealth:visible");
  await expect(grid).not.toHaveClass(/gridHealth-blackout/);
  await expect(grid).toHaveClass(/statusWarning/);
  const warning = grid.getByRole("button", {
    name: /^Current grid status: NOW .*reserve.*FUTURE Short at/,
  });
  await expect(warning).toBeVisible();
  await warning.click();
  const diagnosis = page.getByRole("dialog", {
    name: "Grid status",
    exact: true,
  });
  await expect(
    diagnosis.getByText(
      /^About [\d.,]+[kMGT]?W short at .+ in this month’s sample$/,
    ),
  ).toBeVisible();
  await diagnosis.getByRole("button", { name: "Close grid status" }).click();
  await reviewScreenshot(
    info.project.name === "mobile-390px"
      ? page
      : page.locator("#appbar:visible"),
    {
      path: info.outputPath("blackout-copy.png"),
      animations: "disabled",
    },
  );
  await expect(
    page
      .locator(".missionRiskButton:visible")
      .filter({ hasText: /shortfall/i }),
  ).toHaveCount(0);
  await openInsights(page);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const origin = await range(page);
  const countBefore = (await readSavedGame(page))!.facilities.length;
  await openBuildGenerators(page);
  await page
    .getByRole("button", { name: /Review purchase of/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Take loan", exact: true }).click();
  await expect(page.locator(".MuiSnackbar-root")).toContainText("online in");
  await openInsights(page);
  expect(await range(page)).toEqual(origin);
  expect((await readSavedGame(page))!.facilities.length).toBe(countBefore + 1);
  // Build repeats the speed controls over the game's app bar; both reflect one clock.
  await expect(
    page.getByRole("button", { name: "pause", exact: true }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});
