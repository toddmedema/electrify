import path from "path";
import { expect, test } from "./fixtures";
import { expectDialogToFit } from "./dialog-layout";

for (const theme of ["light", "dark"] as const) {
  for (const scenario of [
    { id: 113, name: "Load Shedding", window: "2022" },
    { id: 110, name: "Sudden Nuclear Shutdown", window: "Jul 2026–Dec 2027" },
    { id: 100, name: "Carbon Fee" },
  ]) {
    test(`${scenario.name} victory rules use two lines in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto(`/?scenario=${scenario.id}`);
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await page
        .locator("#appbar:visible")
        .getByRole("button", { name: "All requirements" })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: scenario.name });
      await expectDialogToFit(dialog);
      const rules = dialog.locator(".missionRequirements dt");
      const progress = dialog.locator(".missionRequirements dd");
      await expect(progress).toHaveCount(await rules.count());
      if (scenario.window) {
        await expect(rules.first()).toHaveText(
          `≥99.5% of demand monthly · ${scenario.window}`,
        );
        await expect(progress.first()).toContainText("Not started");
        await expect(progress.first()).toContainText(/0\/\d+ months completed/);
      }
      // Check rendered line boxes; two DOM rows alone would miss wrapping.
      // At 320px, long date windows may reflow, but must remain fully readable.
      if (testInfo.project.use.viewport!.width >= 390) {
        const wrapped = await dialog
          .locator(".missionRequirements dt, .missionRequirements dd")
          .evaluateAll((rows) =>
            rows
              .filter(
                (row) =>
                  row.getBoundingClientRect().height >
                  parseFloat(getComputedStyle(row).lineHeight) + 1,
              )
              .map((row) => row.textContent),
          );
        expect(wrapped).toEqual([]);
      }
      const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
      if (
        reviewDir &&
        scenario.id === 113 &&
        (testInfo.project.name === "desktop-chromium" ||
          (theme === "dark" && testInfo.project.name === "mobile-390px"))
      ) {
        await page.waitForTimeout(400);
        await dialog.screenshot({
          path: path.join(
            reviewDir,
            `victory-conditions-${testInfo.project.name}-${theme}.png`,
          ),
        });
      }
    });
  }
}
