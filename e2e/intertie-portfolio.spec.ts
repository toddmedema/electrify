import path from "path";
import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`scenario-sized intertie purchase explains portfolio limits in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("button", { name: "Build", exact: true })
      .click();
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    const review = page.getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    });
    const card = page.locator(".transmissionProject").filter({ has: review });
    await expect(card).toContainText("$1.8M");
    await review.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "next-year demand, current operating fleet",
    );
    await expect(dialog).toContainText(
      "Assumes this connection is already open",
    );
    for (const label of [
      "Shortfall energy covered",
      "Worst remaining gap",
      "Annual electricity purchases",
      "Regional-stress example",
    ]) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(dialog).toContainText("This is not a predicted event");
    await expect(dialog).toContainText("financing extra");
    await expect(dialog).not.toContainText(/NaN|Infinity/);
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    for (const button of await dialog
      .locator(".MuiDialogActions-root button")
      .all()) {
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
    }
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
        (theme === "dark" && testInfo.project.name === "mobile-390px"))
    ) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `intertie-portfolio-${testInfo.project.name}.png`,
        ),
        animations: "disabled",
      });
    }
    await dialog.getByRole("button", { name: "close", exact: true }).click();
    // A three-year southern project cannot rescue this scenario's year-two fire emergency.
    await page
      .getByRole("button", {
        name: "Review purchase of Desert Southwest intertie",
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "will not open before this mission ends",
    );
  });
}
