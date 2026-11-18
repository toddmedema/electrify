import { expect, test } from "./fixtures";

test("early games hide unavailable customer programs", async ({ page }) => {
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Programs", exact: true }).click();
  const peakPrograms = page.getByRole("region", { name: "Offset peak demand" });
  await expect(peakPrograms.getByRole("button")).toHaveCount(2);
  await expect(peakPrograms).toContainText("Time-of-use tariff");
  await expect(peakPrograms).toContainText("Peak curtailment contracts");
});

for (const theme of ["light", "dark"]) {
  test(`flexible customer equipment can be reviewed and scheduled in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [
            { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
          ],
        }),
      );
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: "View Custom Game details" })
      .click();
    await page.getByRole("combobox", { name: "Starting year" }).click();
    await page.getByRole("option", { name: "2060", exact: true }).click();
    await page
      .locator(".customSetupActions")
      .getByRole("button", { name: "Start game", exact: true })
      .click();
    await page.getByRole("button", { name: "Programs", exact: true }).click();
    const dialog = page.getByRole("region", { name: "Programs", exact: true });
    const peakPrograms = dialog.getByRole("region", {
      name: "Offset peak demand",
    });
    await expect(peakPrograms.getByRole("button")).toHaveCount(4);
    await dialog
      .getByRole("heading", { name: "Reduce overall demand", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`flexibility-catalog-${theme}.png`),
    });
    for (const name of [
      "Managed EV charging",
      "Home battery virtual power plant",
    ]) {
      await dialog
        .getByRole("button", { name: new RegExp(`^${name} ·`) })
        .click();
      await expect(dialog.getByText(/at full rollout while on/)).toBeVisible();
      await expect(
        dialog.getByText("Local equipment", { exact: true }),
      ).toBeHidden();
      await dialog.getByText("Equipment & rollout", { exact: true }).click();
      await expect(
        dialog.getByText("Local equipment", { exact: true }),
      ).toBeVisible();
      await dialog.getByText("Equipment & rollout", { exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "Turn on next month", exact: true }),
      ).toBeEnabled({ timeout: 30000 });
      expect(
        await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await dialog.locator(".customerProgramsBody").evaluate((element) => {
        element.scrollTop = 0;
      });
      if (name === "Managed EV charging") {
        await dialog.getByText("Equipment & rollout", { exact: true }).click();
        await expect(
          dialog.getByText("Electric-car fleet", { exact: true }),
        ).toBeVisible();
        await dialog.getByText("Equipment & rollout", { exact: true }).click();
        await page.screenshot({
          path: testInfo.outputPath(`managed-charging-${theme}.png`),
          animations: "disabled",
        });
      }
      if (name === "Home battery virtual power plant") {
        await page.screenshot({
          path: testInfo.outputPath(`home-battery-${theme}.png`),
          animations: "disabled",
        });
      }
      await dialog
        .getByRole("button", { name: "Turn on next month", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: new RegExp(`^${name} ·`) })
        .click();
      await dialog
        .getByRole("button", { name: "Cancel scheduled change", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: new RegExp(`^${name} · Off`) }),
      ).toBeVisible();
    }
  });
}
