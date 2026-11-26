import { buildTutorialProject, startTutorialMission } from "./tutorial-fixture";
import { expect, test } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`storage tutorial ring stays separate from expanded details in ${theme}`, async ({
    page,
  }, testInfo) => {
    await startTutorialMission(page, 2, theme);
    await buildTutorialProject(page, "Lithium Battery", true);
    await page.getByRole("button", { name: "Fleet", exact: true }).click();
    await expect(page.locator(".tutorialHud")).toContainText(
      "Find Pumped Hydro’s charge level",
    );
    // Keep the pointer off the toast so its auto-dismiss timer is not paused by hover; it
    // covers the new row until it leaves.
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    const construction = page
      .locator(".facilityRow")
      .filter({ hasText: "Building 0%" });
    // A purchase highlights its row without expanding it
    const disclosure = construction.locator(".facilityDisclosure");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.click();
    await expect(construction.locator(".facilityDetails")).toBeVisible();
    await expect(construction).toHaveCSS("box-shadow", "none");
    await expect(page.locator(".tutorialTargetRing")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Storage", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("storage-tutorial-expanded.png"),
      animations: "disabled",
    });
  });
}
