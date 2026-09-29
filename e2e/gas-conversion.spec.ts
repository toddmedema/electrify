import { expect, test } from "@playwright/test";
import { openPane } from "./layout";
import { expectDialogToFit } from "./dialog-layout";

for (const theme of ["light", "dark"]) {
  test(`peaker conversion can be reviewed, purchased and cancelled in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=104");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const fleet = page.locator(".facilities:visible");
    await openPane(
      fleet,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const row = fleet.locator(".facilityRow").filter({
      has: page.locator(".facilityName", { hasText: /^Natural Gas Peaker$/ }),
    });
    await row.locator(".facilityDisclosure").click();
    await row.getByRole("button", { name: /^Convert ·/ }).click();
    const dialog = page.getByRole("dialog");
    await expectDialogToFit(dialog);
    await expect(dialog).toContainText("6 months");
    await expect(
      dialog.locator(".decisionImpactFact").filter({ hasText: "Fuel use" }),
    ).toContainText("9,142 → 6,266 Btu/kWh");
    await expect(
      dialog.locator(".decisionImpactFact").filter({ hasText: "Start time" }),
    ).toContainText("10 → 90 minutes");
    await expect(
      dialog
        .locator(".decisionImpactFact")
        .filter({ hasText: "Minimum output" }),
    ).toContainText("50% → 45%");
    await page.screenshot({
      path: info.outputPath("conversion.png"),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: /^Pay/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText("combined-cycle generation");
    await row.getByRole("button", { name: /^Cancel upgrade of/ }).click();
    await expect(row.getByRole("button", { name: /^Convert ·/ })).toBeVisible();
  });
}
