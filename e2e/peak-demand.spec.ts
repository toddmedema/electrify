import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`peak offers can be compared, scheduled and cancelled in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const entry = page.getByRole("button", {
      name: "Programs",
      exact: true,
    });
    const dialog = page.getByRole("region", { name: "Programs", exact: true });
    await openPane(dialog, entry);
    for (const offer of ["Time-of-use tariff", "Peak curtailment contracts"]) {
      await dialog
        .getByRole("button", { name: `${offer} · Off`, exact: true })
        .click();
      await expect(dialog.getByRole("radio")).toHaveCount(0);
      await expect(dialog).not.toContainText("Base rate:");
      await expect(dialog).not.toContainText("installed upgrades");

      const window = dialog.getByLabel("Daily window", { exact: true });
      await expect(window).toBeVisible();
      await window.selectOption(offer === "Time-of-use tariff" ? "22" : "9");
      await expect(dialog).toContainText(
        offer === "Time-of-use tariff"
          ? "Use shifts to 02:00-05:00"
          : "Half of demand from factories, mines and data centers drops 20%",
      );
      // The workspace header has no contextual help. Its foreground game menu
      // must consume Escape without losing the program's unsaved daily window.
      await page.locator(".gameMenuButton").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(window).toBeVisible();
      await expect(window).toHaveValue(
        offer === "Time-of-use tariff" ? "22" : "9",
      );
      const apply = dialog.getByRole("button", {
        name: "Turn on next month",
        exact: true,
      });
      await expect(apply).toBeEnabled({ timeout: 30000 });
      await expect(
        dialog.getByRole("img", { name: /^Estimated demand:/ }),
      ).toBeVisible();
      expect(
        await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect((await apply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await window.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await dialog
        .getByRole("heading", { name: offer, exact: true })
        .scrollIntoViewIfNeeded();
      await dialog.locator(".customerProgramsBody").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: testInfo.outputPath(
          `${offer === "Time-of-use tariff" ? "tariff" : "contract"}-${theme}.png`,
        ),
      });
      await dialog
        .getByRole("img", { name: /^Estimated demand:/ })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(
          `${offer === "Time-of-use tariff" ? "tariff" : "contract"}-preview-${theme}.png`,
        ),
      });
      await apply.click();
      await expect(dialog).toContainText("turns on Feb 2020");
      await dialog
        .getByRole("button", { name: new RegExp(`^${offer} · Off · turns on`) })
        .click();
      await expect(window).toHaveValue(
        offer === "Time-of-use tariff" ? "22" : "9",
      );
      await window.selectOption("12");
      const update = dialog.getByRole("button", {
        name: "Update next month",
        exact: true,
      });
      await expect(update).toBeEnabled({ timeout: 30000 });
      await update.click();
      await expect(dialog).toContainText("12:00–16:00");
      await dialog
        .getByRole("button", { name: new RegExp(`^${offer} · Off · turns on`) })
        .click();
      await dialog
        .getByRole("button", { name: "Cancel scheduled change" })
        .click();
      await expect(dialog).not.toContainText("turns on");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
  });
}
