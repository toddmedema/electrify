import { expect, test } from "./fixtures";

for (const theme of ["light", "dark"]) {
  test(`storage tutorial ring stays separate from expanded details in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [0, 1].map((scenarioId) => ({
            scenarioId,
            timesPlayed: 1,
            date: "2026-09-10",
          })),
        }),
      );
    }, theme);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Start playing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start Storage", exact: true })
      .click();
    // Tutorial initialization replaces the entering game card. Its first objective must
    // be active before Build can open a catalog that survives that navigation.
    await expect(page.locator(".tutorialHud")).toContainText("Tap Build");
    await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
    await page.locator(".button-buildFacility").click();
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    await page
      .getByRole("button", { name: /Review purchase of/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Take loan", exact: true }).click();
    await expect(page.locator(".tutorialHud")).toContainText(
      "Check the storage bar",
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
