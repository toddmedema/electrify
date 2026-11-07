import { reviewScreenshot } from "./review-screenshot";
import { expect, test } from "./fixtures";
import { dragCoalAbovePumpedHydro, waitForSettled } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`storage purchase fixes coal-only peak shortages in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [0, 1].map((scenarioId) => ({
            scenarioId,
            timesPlayed: 1,
            date: "2026-10-31",
          })),
        }),
      );
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: "Start Storage", exact: true })
      .click();
    const hud = page.locator(".tutorialHud");
    await expect(hud).toContainText("Tap Build");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("beforeinstallprompt")),
    );
    await page.locator(".button-buildFacility").click();
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    await waitForSettled(page, ".constructionCapacitySlider");
    await page
      .getByRole("button", {
        name: "Review purchase of Pumped Hydro",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Take loan", exact: true }).click();
    await expect(hud).toContainText("Check the storage bar");
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`storage-units-${theme}.png`),
      animations: "disabled",
    });
    await hud.getByRole("button", { name: "Next", exact: true }).click();
    await expect(hud).toContainText("Drag Coal above Pumped Hydro");
    await dragCoalAbovePumpedHydro(page);
    await expect(hud).toContainText("Build storage to cover peak demand");
    await expect(page.locator(".facilityRow")).toHaveCount(1);
    await page.locator(".button-buildFacility").click();
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    await waitForSettled(page, ".constructionCapacitySlider");
    const size = page.locator(".constructionCapacitySlider input");
    // The capstone sizes its first storage project from the coal plant. Select
    // 200 MWh explicitly rather than assuming it kept the practice grid's size.
    for (let step = 0; step < 37; step++) {
      if (
        await page
          .getByRole("slider", { name: "Capacity 200MWh", exact: true })
          .count()
      )
        break;
      await size.press("ArrowLeft");
    }
    await expect(size).toHaveAccessibleName("Capacity 200MWh");
    await page
      .getByRole("button", {
        name: "Review purchase of Lithium Battery",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Take loan", exact: true }).click();
    await page.getByRole("button", { name: "fast speed", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Mission complete!/ });
    await expect(dialog).toBeVisible({ timeout: 25000 });
    await expect(dialog).toContainText(
      "You learned how to store spare electricity and use it to cover peak demand.",
    );
    await expect(
      dialog.getByRole("button", { name: "Install for later", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Main menu", exact: true }),
    ).toBeVisible();
    for (const button of await dialog.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(box.height).toBeGreaterThanOrEqual(
        testInfo.project.name.startsWith("mobile") ? 44 : 40,
      );
    }
    await page.screenshot({
      path: testInfo.outputPath(`storage-complete-${theme}.png`),
      animations: "disabled",
    });
  });
}
