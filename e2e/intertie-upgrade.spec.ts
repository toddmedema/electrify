import path from "path";
import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`intertie upgrades can be reviewed, purchased and resumed in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      if (!sessionStorage.getItem("upgrade-test")) {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
        sessionStorage.setItem("upgrade-test", "true");
      }
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    const showFacilities = () =>
      openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
    await showFacilities();
    await facilities
      .getByRole("button", { name: "Build", exact: true })
      .click();
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Take loan" })
      .click();
    const line = facilities.locator(".transmissionLine").first();
    await expect(line).toContainText("Building");
    const speed = (name: string) =>
      page
        .locator("#appbar:visible")
        .getByRole("button", { name, exact: true })
        .first();
    await speed("fast speed").click();
    await expect(line).not.toContainText("Building", { timeout: 45000 });
    await speed("pause").click();
    await line
      .getByRole("button", { name: "Inspect Northern intertie" })
      .click();
    const review = line.getByRole("button", {
      name: /^Upgrade Northern intertie/,
    });
    await expect(review).toBeVisible();
    expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await review.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Includes refinancing the existing");
    await expect(dialog).toContainText("Construction emits");
    await expect(dialog).toContainText("Upkeep after upgrade");
    await dialog.getByRole("button", { name: "close", exact: true }).click();
    await expect(line.getByText(/Upgrading to/)).toHaveCount(0);
    await review.click();
    for (const button of await dialog
      .locator(".MuiDialogActions-root button")
      .all()) {
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
    }
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      theme ===
        (testInfo.project.name === "desktop-chromium" ? "light" : "dark")
    ) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `upgrade-${testInfo.project.name}.png`,
        ),
        animations: "disabled",
      });
    }
    await dialog
      .getByRole("button", {
        name: theme === "light" ? "Take loan" : "Pay cash",
        exact: true,
      })
      .click();
    await expect(line).toContainText("Upgrading to 0.75GW");
    await expect(line).toContainText("keeps carrying 0.5GW");
    // Exercise the actual autosave and resume path while the upgrade is in progress.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await showFacilities();
    await line
      .getByRole("button", { name: "Inspect Northern intertie" })
      .click();
    await expect(line).toContainText("Upgrading to 0.75GW");
    await speed("fast speed").click();
    await expect(line).not.toContainText("Upgrading to", { timeout: 45000 });
    await speed("pause").click();
    // The collapsed reading uses the weather-dependent operating rating, not nameplate
    // capacity. Verify the purchased nameplate in the expanded details instead.
    await expect(line.locator(".transmissionLineDetails")).toContainText(
      "0.75GW rated capacity",
    );
    await expect(
      line.getByRole("button", {
        name: "Upgrade Northern intertie to 1.13GW",
      }),
    ).toBeVisible();
    expect(
      await facilities.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
