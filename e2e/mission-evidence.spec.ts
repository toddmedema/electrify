import path from "path";
import { expect, test, type Page } from "@playwright/test";

const reviewProjects = new Set([
  "desktop-chromium",
  "mobile-390px",
  "mobile-320px",
]);
async function settle(page: Page) {
  await page.waitForTimeout(400);
}
async function openInsights(page: Page) {
  if (!(await page.locator(".insights:visible").isVisible())) {
    await page.locator("#insightsNav:visible").click();
    await settle(page);
  }
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
  test(`mission evidence reaches operating Plants and preserves details focus in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!reviewProjects.has(info.project.name));
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator(".missionSummary:visible")).toContainText(
      "144 months left",
    );
    await settle(page);
    const details = page.getByRole("button", {
      name: "All requirements",
      exact: true,
    });
    await details.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("90%");
    await expect(dialog).toContainText("month-end");
    await page.keyboard.press("Escape");
    await expect(details).toBeFocused();
    await page.locator(".facilityRow").filter({ hasText: "Coal" }).click();
    await page.getByRole("button", { name: "Pause Coal", exact: true }).click();
    await page.getByRole("button", { name: "fast speed", exact: true }).click();
    await expect(page.locator(".missionRiskButton:visible")).toContainText(
      "Supply & demand",
    );
    await page.getByRole("button", { name: "pause", exact: true }).click();
    await page.locator("#intertiesTab").click();
    await page.locator(".missionRiskButton:visible").click();
    await expect(page.locator("#plantsTab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#chartSupplyDemand")).toBeVisible();
    await expect(page.locator(".operatingEvidence")).toBeFocused();
    await expect(
      page.getByText(/Supply — solid.*Demand.*dashed/),
    ).toBeVisible();
    // A repeated request to the already-mounted pane is still a deliberate focus request.
    await page.locator(".missionRiskButton:visible").click();
    await expect(page.locator(".operatingEvidence")).toBeFocused();
    for (const speed of ["normal speed", "fast speed", "pause"]) {
      await page.getByRole("button", { name: speed, exact: true }).click();
      await expect(
        page.getByText(/Supply — solid.*Demand.*dashed/),
      ).toBeVisible();
    }
    if (info.project.name.startsWith("mobile")) {
      for (const nav of ["Insights", "Events", "Facilities"]) {
        await page.getByRole("button", { name: nav, exact: true }).click();
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

test("one Generator edge restores evidence range through Return and browser traversal", async ({
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
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const origin = await range(page);
  const selected = await page.evaluate(() =>
    localStorage.getItem("insightsLayers"),
  );
  const history = await page.evaluate(() => window.history.length);
  await page.locator("#insightsGeneratorJourney").click();
  await expect(page.locator(".buildOption").first()).toBeVisible();
  expect(await page.evaluate(() => window.history.length)).toBe(history + 1);
  await page
    .getByRole("button", { name: "Return to evidence", exact: true })
    .click();
  await expect(page.locator(".insights:visible")).toBeVisible();
  await settle(page);
  expect(await range(page)).toEqual(origin);
  expect(
    await page.evaluate(() => localStorage.getItem("insightsLayers")),
  ).toBe(selected);
  await page.goForward();
  await expect(page.locator(".buildOption").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return to evidence", exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".insights:visible")).toBeVisible();
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
  // A saved-game fixture isolates the presentation warning from economic outcomes.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    const save = JSON.parse(localStorage.getItem("savedGame")!);
    for (const tick of save.game.timeline) {
      tick.cash = -100;
      tick.supplyW = Math.max(tick.supplyW, tick.demandW);
    }
    localStorage.setItem("savedGame", JSON.stringify(save));
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
  await page.locator("#insightsGeneratorJourney").click();
  await page
    .getByRole("button", { name: "Return to evidence", exact: true })
    .click();
  await expect(
    page.locator('.insights:visible [data-layer="financeDetails"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await page.locator("#insightsGeneratorJourney").click();
  await page
    .getByRole("button", { name: "Return to evidence", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
      name: "All requirements",
      exact: true,
    });
    await details.scrollIntoViewIfNeeded();
    await details.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#eventsNav:visible").scrollIntoViewIfNeeded();
    await page.locator("#eventsNav:visible").click();
    await settle(page);
    await page.locator("#faciltiesNav:visible").scrollIntoViewIfNeeded();
    await page.locator("#faciltiesNav:visible").click();
    await settle(page);
    await page.locator(".button-buildGenerator").scrollIntoViewIfNeeded();
    await page.locator(".button-buildGenerator").click();
    await expect(page.locator(".buildOption").first()).toBeVisible();
    await page.getByRole("button", { name: "close", exact: true }).click();
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
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    const save = JSON.parse(localStorage.getItem("savedGame")!);
    // Derate the real starting fleet to 390 MW; the real reducer computes the sample.
    save.game.facilities.forEach((facility: { peakW: number }) => {
      facility.peakW *= 0.78;
    });
    localStorage.setItem("savedGame", JSON.stringify(save));
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".missionSummary:visible")).toBeVisible();
  await page.locator(".facilityRow").filter({ hasText: "Coal" }).click();
  await page.getByRole("button", { name: "Pause Coal", exact: true }).click();
  await page.getByRole("button", { name: "Resume Coal", exact: true }).click();
  await expect(page.locator(".missionRiskButton:visible")).toContainText(
    "Projected shortfall",
  );
  await expect(page.locator(".missionRiskButton:visible")).toHaveAccessibleName(
    /Projected in this month's representative day/,
  );
  await page.locator(".missionRiskButton:visible").click();
  await expect(page.locator(".operatingEvidence")).toBeFocused();
  await expect(page.locator(".operatingEvidence")).toContainText(
    "This month's representative day",
  );
  await openInsights(page);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const origin = await range(page);
  const history = await page.evaluate(() => window.history.length);
  const countBefore = await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    return JSON.parse(localStorage.getItem("savedGame")!).game.facilities
      .length;
  });
  await page.locator("#insightsGeneratorJourney").click();
  await page
    .getByRole("button", { name: /Review purchase of/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Take loan", exact: true }).click();
  await expect(page.locator(".insights:visible")).toBeVisible();
  await settle(page);
  expect(await range(page)).toEqual(origin);
  expect(await page.evaluate(() => window.history.length)).toBe(history + 1);
  expect(
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      return JSON.parse(localStorage.getItem("savedGame")!).game.facilities
        .length;
    }),
  ).toBe(countBefore + 1);
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".MuiSnackbar-root")).toContainText("online in");
});
