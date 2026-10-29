import { expect, test } from "./fixtures";
import { sortBuildCatalog } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"]) {
  test(`tutorial explanation uses the available width in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.locator('[data-fuel="Coal"] .facilityRowHeader').click();
    await expect(page.locator(".tutorialHud")).toContainText(
      "Tap the supply and demand chart",
    );
    const content = page.locator(".tutorialHudContent");
    const prompt = content.locator(".tutorialPrompt");
    await expect(prompt).toBeVisible();
    const availableWidth = (await content.boundingBox())!.width;
    expect((await prompt.boundingBox())!.width).toBeGreaterThanOrEqual(
      availableWidth - 1,
    );
    await page.screenshot({
      path: testInfo.outputPath(`tutorial-wide-${theme}.png`),
      animations: "disabled",
    });
  });
}

for (const theme of ["light", "dark"]) {
  test(`tutorial build choices and consistent details in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [{ scenarioId: 0, timesPlayed: 1, date: "2026-09-10" }],
        }),
      );
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: "Start Generators", exact: true })
      .click();
    await page.locator(".button-buildFacility").click();
    await expect(page.locator(".tutorialHud")).toContainText("Sort generators");
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`sort-${theme}.png`),
      animations: "disabled",
    });
    await sortBuildCatalog(page);
    await expect(page.locator(".tutorialHud")).toContainText(
      "Choose a plant size",
    );
    await expect(page.locator(".constructionCapacitySlider")).toBeInViewport();
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`size-${theme}.png`),
      animations: "disabled",
    });
    await page
      .locator(".tutorialHud")
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await expect(page.locator(".tutorialHud")).toContainText("Compare cost");
    await expect(
      page.getByRole("tablist", { name: "Build categories" }),
    ).toHaveCount(0);
    await expect(page.locator(".buildOption")).toHaveCount(4);
    for (const name of [
      "Natural Gas Peaker",
      "Natural Gas CC",
      "Solar",
      "Wind",
    ]) {
      await expect(
        page.getByRole("button", { name: `Show ${name} details` }),
      ).toBeVisible();
    }
    // Both gas plants run on demand
    await expect(
      page.getByText("On demand", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`choices-${theme}.png`),
    });
    await page
      .getByRole("button", { name: "Show Natural Gas Peaker details" })
      .click();
    const details = page.locator(".buildDetails");
    await expect(details).toBeVisible();
    const rows = details.getByRole("row");
    for (const row of await rows.all()) {
      await expect(row.getByRole("button", { name: /^What is/ })).toHaveCount(
        1,
      );
      expect(
        await row.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    if (page.viewportSize()!.width >= 768) {
      const heights = await rows.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().height),
      );
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(
        1,
      );
    }
    await details.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`details-${theme}.png`),
    });
  });
}
