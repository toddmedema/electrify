import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"]) {
  test(`coal repowering previews both technologies and can be canceled in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Beginner", exact: true }).click();
    await page.getByRole("button", { name: "Start game", exact: true }).click();

    const fleet = page.locator(".facilities:visible");
    await openPane(
      fleet,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const coal = fleet.getByRole("button", {
      name: "Inspect Coal",
      exact: true,
    });
    await coal.click();
    const repowering = fleet.getByRole("region", { name: "Coal repowering" });
    const cc = repowering.getByRole("button", {
      name: /^Convert to Natural Gas CC/,
    });
    const peaker = repowering.getByRole("button", {
      name: /^Convert to Natural Gas Peaker/,
    });
    await expect(cc).toBeEnabled();
    await expect(peaker).toBeEnabled();
    await reviewScreenshot(repowering, {
      path: info.outputPath(`coal-actions-${theme}.png`),
      animations: "disabled",
    });

    const dialog = page.getByRole("dialog");
    if (info.project.name === "desktop-chromium") {
      await coal.click({ button: "right" });
      const actions = page.getByRole("menu", { name: "Facility actions" });
      await expect(
        actions.getByRole("menuitem", {
          name: /^Convert to Natural Gas Peaker/,
        }),
      ).toBeEnabled();
      await actions
        .getByRole("menuitem", { name: /^Convert to Natural Gas CC/ })
        .click();
    } else {
      await cc.click();
    }
    await expect(dialog).toHaveAccessibleName("Convert to Natural Gas CC?");
    await expect(dialog).toContainText("90 min");
    await expect(dialog).toContainText("300 MW");
    await expect(dialog).toContainText("Coal can keep running");
    await reviewScreenshot(dialog, {
      path: info.outputPath(`combined-cycle-preview-${theme}.png`),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();

    await peaker.click();
    await expect(dialog).toHaveAccessibleName("Convert to Natural Gas Peaker?");
    await expect(dialog).toContainText("10 min");
    await expect(dialog).toContainText("full refund");
    await dialog.getByRole("button", { name: /^Pay \$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(repowering).toContainText("Natural Gas Peaker");
    await expect(repowering).toContainText("complete");
    await expect(coal).toHaveAccessibleDescription(
      /Natural Gas Peaker, \d+% complete/,
    );
    await expect(
      repowering.getByRole("button", { name: /^Convert to/ }),
    ).toHaveCount(0);
    await expect(
      fleet.getByRole("button", { name: "Pause Coal", exact: true }),
    ).toBeEnabled();
    const sell = fleet.getByRole("button", { name: "Sell Coal", exact: true });
    await expect(sell).toHaveCount(0);
    await reviewScreenshot(
      fleet.locator('.facilityRow[data-facility="Coal"] .facilityActions'),
      {
        path: info.outputPath(`conversion-controls-${theme}.png`),
        animations: "disabled",
      },
    );
    await fleet
      .getByRole("button", { name: "Cancel conversion of Coal", exact: true })
      .click();
    await expect(peaker).toBeEnabled();
    await expect(cc).toBeEnabled();
    await expect(sell).toBeEnabled();
    await expect(coal).toBeFocused();
  });
}
