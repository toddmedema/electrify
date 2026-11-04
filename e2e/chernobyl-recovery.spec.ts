import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { expectDialogToFit } from "./dialog-layout";
import { readSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`Chernobyl opens one month before the disaster with recovery rules in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      Math.random = () => 0.25;
    }, theme);
    await page.goto("/?scenario=126");
    await expect(
      page.getByRole("heading", { name: "Chernobyl: Recovery" }),
    ).toBeVisible();
    await expect(page.locator(".scenarioDossier")).toContainText("Mar 1986");
    await expect(page.locator(".scenarioDossier")).toContainText("Feb 1991");
    await page
      .getByRole("button", { name: "Goals and scoring", exact: true })
      .click();
    const goals = page.getByRole("dialog");
    await expect(goals).toContainText("No minimum reliability requirement.");
    await expect(goals).toContainText("but do not end the run.");
    await expect(goals).toContainText("Finish the term without bankruptcy.");
    await expect(goals).not.toContainText("3 months in a row");
    await expectDialogToFit(goals);
    await page.clock.runFor(500);
    const screenshots = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      screenshots &&
      theme === "light" &&
      testInfo.project.name === "mobile-390px"
    ) {
      await page.screenshot({
        path: path.join(screenshots, "chernobyl-goals-mobile.png"),
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
    await page.clock.runFor(500);
    if (
      screenshots &&
      theme === "light" &&
      testInfo.project.name === "desktop-chromium"
    ) {
      const dossier = page.locator(".scenarioDossier");
      await dossier.screenshot({
        path: path.join(screenshots, "chernobyl-details-desktop.png"),
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const appbar = page.locator("#appbar:visible").first();
    await expect(appbar).toContainText("Mar 1986");
    const fleet = page.locator(".facilities");
    await openPane(
      fleet,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const unitFour = page.locator(
      '.facilityRow[data-facility="Chernobyl Unit 4"]',
    );
    await unitFour.locator(".facilityDisclosure").click();
    await page.clock.runFor(500);
    await expect(
      unitFour.getByRole("button", {
        name: "Sell Chernobyl Unit 4",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      unitFour.getByRole("button", {
        name: "Pause Chernobyl Unit 4",
        exact: true,
      }),
    ).toBeVisible();
    await expect(unitFour).toContainText("Cleanup and recovery");
    await expect(unitFour).toContainText("$250M/mo · $3B/yr");
    await expect(unitFour).toContainText("from Apr 1986");
    const events = page.locator(".eventLog");
    await openPane(
      events,
      page.getByRole("button", { name: "Events", exact: true }),
    );
    await appbar
      .getByRole("button", { name: "fast speed", exact: true })
      .click();
    const disaster = page
      .locator(".ongoingEvents:visible")
      .getByText("The Chernobyl disaster", { exact: true });
    for (
      let second = 0;
      second < 15 && !(await disaster.isVisible());
      second++
    ) {
      await page.clock.fastForward(1000);
    }
    await expect(disaster).toBeVisible();
    await expect(appbar).toContainText("Apr 1986");
    await expect(page.locator(".ongoingEvents:visible")).toContainText(
      "Unit 4 is permanently lost",
    );
    await expect(page.locator(".ongoingEvents:visible")).toContainText(
      "Cleanup costs",
    );
    await expect(
      page.getByText("Save failed", { exact: false }),
    ).not.toBeVisible();
    await expect
      .poll(async () => (await readSavedGame(page))?.date.monthNumber)
      .toBe(4);
    await expect
      .poll(
        async () =>
          (await readSavedGame(page))?.facilities.find(
            (facility) => facility.startingAssetId === "chernobyl-unit-4",
          )?.paused,
      )
      .toBe(true);
    expect(
      await events.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await openPane(
      fleet,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await expect(unitFour.locator(".facilityDisclosure")).toBeVisible();
    await expect(unitFour.locator(".facilityDisclosure")).toContainText(
      "0/1GW · 0% · paused",
    );
    await expect(
      unitFour.getByRole("button", {
        name: "Sell Chernobyl Unit 4",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      unitFour.getByRole("button", {
        name: /^(Pause|Resume) Chernobyl Unit 4$/,
      }),
    ).toHaveCount(0);
    await expect(unitFour).toContainText("Cleanup and recovery");
    await expect(unitFour).toContainText("$250M/mo · $3B/yr");
    await expect(unitFour).not.toContainText("from Apr 1986");
    if (
      screenshots &&
      theme === "light" &&
      testInfo.project.name === "mobile-390px"
    ) {
      await page.mouse.move(0, 0);
      await page.clock.fastForward(10000);
      await page.clock.runFor(500);
      await page.locator(".snackbarContent").waitFor({ state: "hidden" });
      await unitFour.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(screenshots, "chernobyl-maintenance-mobile.png"),
        animations: "disabled",
      });
    }
    await openPane(
      events,
      page.getByRole("button", { name: "Events", exact: true }),
    );
    if (
      screenshots &&
      theme === "dark" &&
      testInfo.project.name === "desktop-chromium"
    ) {
      await page.mouse.move(0, 0);
      await page.clock.fastForward(10000);
      await page.clock.runFor(500);
      await page.locator(".snackbarContent").waitFor({ state: "hidden" });
      await page.screenshot({
        path: path.join(screenshots, "chernobyl-disaster-desktop-dark.png"),
        animations: "disabled",
      });
    }
  });
}
