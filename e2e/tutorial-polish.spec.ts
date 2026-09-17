import { expect, test } from "@playwright/test";

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
    await page
      .getByRole("button", { name: "Start playing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start Generators", exact: true })
      .click();
    await page.locator(".button-buildFacility").click();
    await expect(page.locator(".tutorialHud")).toContainText("Compare cost");
    await expect(
      page.getByRole("tablist", { name: "Build categories" }),
    ).toHaveCount(0);
    await expect(page.locator(".buildOption")).toHaveCount(3);
    for (const name of ["Natural Gas", "Solar", "Wind"]) {
      await expect(
        page.getByRole("button", { name: `Show ${name} details` }),
      ).toBeVisible();
    }
    await expect(page.getByText("On demand", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`choices-${theme}.png`),
    });
    await page
      .getByRole("button", { name: "Show Natural Gas details" })
      .click();
    const details = page.locator(".generatorDetails");
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
