import { expectContinuousDialogSurface } from "./dialog-surface";
import path from "path";
import { expect, test } from "./fixtures";
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
    const showFacilities = async () => {
      await openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      await facilities
        .getByRole("button", { name: "Dispatch", exact: true })
        .click();
    };
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
    await showFacilities();
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
      name: "Review upgrade of Northern intertie",
    });
    await expect(review).toBeVisible();
    expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await review.click();
    const dialog = page.getByRole("dialog");
    await expectContinuousDialogSurface(dialog);
    await expect(dialog).toContainText("Includes refinancing the existing");
    await expect(dialog).toContainText("Construction emits");
    await expect(dialog).toContainText("Upkeep after upgrade");
    const importAccess = dialog
      .locator(".decisionImpactFact")
      .filter({ hasText: /^Import capacity/ });
    const exportAccess = dialog
      .locator(".decisionImpactFact")
      .filter({ hasText: /^Export capacity/ });
    await expect(exportAccess).toContainText("150MW → 150MW · Unchanged");
    const rights = (await importAccess.innerText()).match(
      /([\d.]+)MW → ([\d.]+)MW/,
    );
    expect(rights).not.toBeNull();
    expect(Number(rights![2])).toBeGreaterThan(Number(rights![1]));
    await dialog.getByRole("button", { name: "close", exact: true }).click();
    await expect(line.getByText(/^Upgrading ·/)).toHaveCount(0);
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
    await expect(line).toContainText("Upgrading ·");
    await expect(line).toContainText(
      "Current capacities stay in use until completion",
    );
    await expect(line).toContainText(/Import capacity\s*150MW/);
    // Exercise the actual autosave and resume path while the upgrade is in progress.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await showFacilities();
    await line
      .getByRole("button", { name: "Inspect Northern intertie" })
      .click();
    await expect(line).toContainText("Upgrading ·");
    await speed("fast speed").click();
    await expect(line).not.toContainText("Upgrading ·", { timeout: 45000 });
    await speed("pause").click();
    // Verify the purchased directional capacities in the expanded details.
    const metrics = line.locator(".transmissionMetrics");
    await expect(metrics).not.toContainText("Line capacity");
    await expect(metrics).toContainText(/Import capacity\s*210MW/);
    await expect(metrics).toContainText(/Export capacity\s*150MW/);
    await expect(
      line.getByRole("button", {
        name: "Review upgrade of Northern intertie",
      }),
    ).toBeVisible();
    expect(
      await facilities.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
