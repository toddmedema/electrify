import { expect, test } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";
import { sortBuildCatalog } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`generator capstone completes immediately after a different second purchase in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [{ scenarioId: 0, timesPlayed: 1, date: "2026-09-17" }],
        }),
      );
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: "Start Generators", exact: true })
      .click();
    const hud = page.locator(".tutorialHud");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("beforeinstallprompt")),
    );
    await page.locator(".button-buildFacility").click();
    await expect(hud).toContainText("Sort generators");
    await sortBuildCatalog(page);
    await expect(hud).toContainText("Choose a plant size");
    await expect(
      hud.getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);
    await page.locator(".constructionCapacitySlider input").press("ArrowLeft");
    await expect(hud).toContainText("Review a generator purchase");
    await page
      .getByRole("button", {
        name: "Review purchase of Natural Gas Peaker",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Take loan", exact: true }).click();
    await expect(hud).toContainText("Construction started");
    await hud.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "fast speed", exact: true }).click();
    await expect(hud).toContainText("Read the year progress bar");
    await hud.getByRole("button", { name: "Next", exact: true }).click();
    await expect(hud).toContainText(
      "Order a second generator of a different type",
    );
    await page.getByRole("button", { name: "pause", exact: true }).click();
    // A new peaker dispatches after the starting coal plant, so Coal is the first row
    await page
      .locator('.facilityRow[data-facility="Coal"]')
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
    await expect(page.locator(".facilityDetails")).toBeVisible();
    await expect(
      page.getByText("Rated maximum output", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .locator(".facilityDetails")
        .getByText("Lifetime cost per MWh", { exact: true }),
    ).toBeVisible();
    if (testInfo.project.name === "desktop-chromium") {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page
        .locator('.facilityRow[data-facility="Coal"]')
        .scrollIntoViewIfNeeded();
    }
    await page.screenshot({
      path: testInfo.outputPath("capstone-details.png"),
      fullPage: true,
    });
    await page.locator(".button-buildFacility").click();
    await page
      .getByRole("button", { name: "Review purchase of Solar", exact: true })
      .click();
    await page.getByRole("button", { name: "Take loan", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Mission complete!/ }),
    ).toBeVisible();
    await expect(
      page.getByText(/You learned how to select and build generators/),
    ).toBeVisible();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Install for later" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Next tutorial", exact: true }),
    ).toBeFocused();
    const content = dialog.locator(".tutorialCompleteContent");
    expect(
      await content.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const recap = (await content.locator("p").boundingBox())!;
    const preview = (await dialog
      .locator(".tutorialNextPreview")
      .boundingBox())!;
    expect(preview.y - (recap.y + recap.height)).toBeCloseTo(24, 0);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`mission-complete-${theme}.png`),
      animations: "disabled",
    });
  });
}
