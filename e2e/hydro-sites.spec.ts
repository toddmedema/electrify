import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";

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
    await expect(hydro).toContainText("sites left");
    await expect(hydro).toContainText("largest:");
    const slider = page.getByRole("slider");
    const before = await slider.getAttribute("aria-valuenow");
    const reviewBounds = (await hydro
      .getByRole("button", { name: "Review purchase of Hydro" })
      .boundingBox())!;
    const maximumBounds = (await hydro
      .getByRole("button", { name: "Use site maximum" })
      .boundingBox())!;
    expect(
      maximumBounds.y - reviewBounds.y - reviewBounds.height,
    ).toBeGreaterThanOrEqual(4);
    expect(
      Math.abs(
        maximumBounds.x +
          maximumBounds.width -
          reviewBounds.x -
          reviewBounds.width,
      ),
    ).toBeLessThanOrEqual(1);
    expect(maximumBounds.height).toBeGreaterThanOrEqual(
      testInfo.project.name.startsWith("mobile") ? 44 : 40,
    );

    await hydro.getByRole("button", { name: "Use site maximum" }).click();
    // The shortcut sizes the catalog to the largest open site, then hides at that size.
    await expect(slider).not.toHaveAttribute("aria-valuenow", before!);
    await expect(
      hydro.getByRole("button", { name: "Use site maximum" }),
    ).toHaveCount(0);
    await expect(hydro).toContainText("Site:");
    await expect(
      hydro.getByRole("region", { name: "About Hydro" }),
    ).toContainText("Each plant uses a whole site");
    expect(
      await hydro.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await hydro.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: testInfo.outputPath(`hydro-${theme}.png`),
      animations: "disabled",
    });
    const dismiss = hydro.getByRole("button", { name: "Dismiss About Hydro" });
    const dismissBounds = (await dismiss.boundingBox())!;
    const minimumTarget = testInfo.project.use.hasTouch ? 44 : 40;
    expect(dismissBounds.width).toBeGreaterThanOrEqual(minimumTarget);
    expect(dismissBounds.height).toBeGreaterThanOrEqual(minimumTarget);
    await dismiss.focus();
    await page.keyboard.press("Enter");
    await expect(hydro.locator("[tabindex='-1']")).toBeFocused();
    await expect(page.getByRole("region", { name: "About Hydro" })).toHaveCount(
      0,
    );
    const review = hydro.getByRole("button", {
      name: "Review purchase of Hydro",
    });
    const count = Number(
      (await hydro.innerText()).match(/(\d+) sites left/)![1],
    );
    await expect(review).toBeEnabled();
    {
      await review.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Uses the whole site");
      await expect(dialog).toContainText(
        "Only canceling before completion frees it",
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
      await expect(dialog).toBeHidden();
    }
    await openBuild(page);
    await page.locator(".button-buildGenerator").click();
    await expect(hydro).toContainText(`${count - 1} sites left`);
    await expect(page.getByRole("region", { name: "About Hydro" })).toHaveCount(
      0,
    );
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const plant = page
      .locator(".facilityRow")
      .filter({ has: page.locator(".facilityName", { hasText: /^Hydro$/ }) });
    await plant.locator(".facilityDisclosure").click();
    await expect(plant).toContainText("Site:");
    await plant
      .getByRole("button", { name: "Cancel construction of Hydro" })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Canceling frees this site",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel construction", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await openBuild(page);
    await page.locator(".button-buildGenerator").click();
    await expect(hydro).toContainText(`${count} sites left`);
  });
}
