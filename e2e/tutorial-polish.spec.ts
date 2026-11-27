import { expect, test } from "./fixtures";
import { openTutorialFleet, startTutorialMission } from "./tutorial-fixture";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"] as const) {
  test(`tutorial explanation uses the available width in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await startTutorialMission(page, 0, theme);
    await openTutorialFleet(page);
    const content = page.locator(".tutorialHudContent");
    const prompt = content.locator(".tutorialPrompt");
    await expect(prompt).toBeVisible();
    const availableWidth = (await content.boundingBox())!.width;
    expect((await prompt.boundingBox())!.width).toBeGreaterThanOrEqual(
      availableWidth - 1,
    );
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`tutorial-wide-${theme}.png`),
      animations: "disabled",
    });
  });
}
