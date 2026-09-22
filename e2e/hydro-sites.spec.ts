import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`Hydro site maxima and purchase details reflow in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await page.locator(".button-buildFacility").click();
    await page.locator(".button-buildGenerator").click();
    const hydro = page.locator(".buildOption").filter({
      has: page.getByRole("button", {
        name: "Review purchase of Hydro",
        exact: true,
      }),
    });
    await expect(hydro).toContainText("sites fit this size");
    await expect(hydro).toContainText("largest remaining:");
    const slider = page.getByRole("slider");
    const before = await slider.getAttribute("aria-valuenow");
    await hydro.getByRole("button", { name: "Use site maximum" }).click();
    await expect(slider).toHaveAttribute("aria-valuenow", before!);
    await expect(hydro).toContainText("Selected site:");
    await expect(hydro).toContainText(
      "Smaller builds still consume a whole site",
    );
    expect(
      await hydro.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await hydro.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: testInfo.outputPath(`hydro-${theme}.png`),
      animations: "disabled",
    });
    const review = hydro.getByRole("button", {
      name: "Review purchase of Hydro",
    });
    const count = Number(
      (await hydro.innerText()).match(/(\d+) sites remaining/)![1],
    );
    await expect(review).toBeEnabled();
    {
      await review.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(
        "Cancelling unfinished construction releases it",
      );
      await expect(dialog).toContainText(
        "selling or retiring the plant never releases it",
      );
      expect(
        await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`hydro-purchase-${theme}.png`),
        animations: "disabled",
      });
      await dialog
        .getByRole("button", { name: "Pay cash", exact: true })
        .click();
    }
    await page.locator(".button-buildFacility").click();
    await page.locator(".button-buildGenerator").click();
    await expect(hydro).toContainText(`${count - 1} sites remaining`);
    await page.getByRole("button", { name: "close", exact: true }).click();
    const plant = page
      .locator(".facilityRow")
      .filter({ has: page.locator(".facilityName", { hasText: /^Hydro$/ }) });
    await plant.locator(".facilityDisclosure").click();
    await expect(plant).toContainText("Hydro site:");
    await plant
      .getByRole("button", { name: "Cancel construction of Hydro" })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Cancelling releases this unfinished project's Hydro site",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel construction", exact: true })
      .click();
    await page.locator(".button-buildFacility").click();
    await page.locator(".button-buildGenerator").click();
    await expect(hydro).toContainText(`${count} sites remaining`);
  });
}
