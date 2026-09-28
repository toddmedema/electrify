import { expect, test } from "@playwright/test";
import { expectDialogToFit } from "./dialog-layout";

for (const theme of ["light", "dark"]) {
  test(`investor requirements explain customer retention in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page
      .getByRole("button", { name: "What counts as a win", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "retain at least 80% of starting customers",
    );
    await expect(dialog).not.toContainText("build or upgrade the grid");
    await expectDialogToFit(dialog);
    await page.screenshot({
      path: info.outputPath("investor-requirements.png"),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await page
      .getByRole("button", { name: "All requirements", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toContainText(
      "Invest in the grid",
    );
    await expect(page.getByRole("dialog")).toContainText(
      "80% of where you started",
    );
  });
}
