import { expect, test } from "@playwright/test";

for (const mission of [
  "Generators",
  "Storage",
  "Pricing",
  "Finances",
  "Forecasting",
]) {
  test(`${mission} advances from game controls`, async ({ page }, testInfo) => {
    await page.addInitScript(
      ({ lesson, theme }) => {
        localStorage.clear();
        localStorage.setItem("theme", theme);
        localStorage.setItem(
          "plays",
          JSON.stringify({
            plays: [0, 1, 2, 4, 3, 5]
              .slice(
                0,
                [
                  "Electricity",
                  "Generators",
                  "Storage",
                  "Finances",
                  "Pricing",
                  "Forecasting",
                ].indexOf(lesson),
              )
              .map((scenarioId) => ({
                scenarioId,
                date: "2026-09-10",
              })),
          }),
        );
      },
      {
        lesson: mission,
        theme: testInfo.project.name.startsWith("mobile-") ? "dark" : "light",
      },
    );
    await page.goto("/");
    await page
      .getByRole("button", { name: "Start playing", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Start ${mission}`, exact: true })
      .click();
    const hud = page.locator(".tutorialHud");
    if (mission === "Generators" || mission === "Storage") {
      await page
        .locator(
          mission === "Generators"
            ? ".button-buildGenerator"
            : ".button-buildStorage",
        )
        .click();
      await expect(hud).toContainText(
        mission === "Generators" ? "Compare cost" : "Choose storage",
      );
      await page
        .getByRole("button", { name: /Review purchase of/ })
        .first()
        .click();
      // Opening a purchase review does not mean a purchase succeeded.
      await expect(hud).toContainText(
        mission === "Generators" ? "Compare cost" : "Choose storage",
      );
      await page
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect(hud).toContainText(
        mission === "Generators"
          ? "Construction has started"
          : "bar shows usable stored energy",
      );
    } else if (mission === "Forecasting") {
      await page.locator(".facilityRow").first().click();
      await page
        .getByRole("button", { name: "Pause Coal", exact: true })
        .click();
      await expect(page.getByLabel("Objective 2 of 9")).toBeVisible();
    } else {
      const nav = page.locator("#insightsNav");
      if (await nav.isVisible()) {
        await nav.click();
      } else {
        // The desktop pane is already visible, so its explanation must remain dismissible.
        await hud.getByRole("button", { name: "Next" }).click();
      }
      if (mission === "Pricing") {
        await expect(hud).toContainText("Lower the rate");
        const rate = page.locator("#rateSlider input");
        await rate.focus();
        await rate.press("ArrowLeft");
        await expect(hud).toContainText("Watch how customer growth");
      } else {
        await expect(hud).toContainText("Choose a financial measure");
        await page
          .getByRole("button", { name: "Zoom in", exact: true })
          .click();
        await expect(hud).toContainText("Choose a preset question");
        await page.locator("#insightsLayersButton").click();
        await expect(hud).toContainText("Tap 1× to run a month");
      }
    }
    await expect(page.locator(".buildOption")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`${mission}-advanced.png`),
    });
  });
}
