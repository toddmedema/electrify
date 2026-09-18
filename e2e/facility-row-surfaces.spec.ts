import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

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
    const construction = page
      .locator(".facilityRow")
      .filter({ hasText: "Building 0%" });
    const disclosure = construction.locator(".facilityDisclosure");
    if ((await disclosure.getAttribute("aria-expanded")) !== "true") {
      await disclosure.click();
    }
    await expect(construction.locator(".facilityDetails")).toBeVisible();
    await expect(construction).toHaveCSS("box-shadow", "none");
    await expect(page.locator(".tutorialTargetRing")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Storage", exact: true }),
    ).toHaveCount(0);
    // Keep the pointer off the toast so its auto-dismiss timer is not paused by hover.
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath("storage-tutorial-expanded.png"),
      animations: "disabled",
    });
  });

  test(`facility row surfaces span the grip in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const row = pane.locator(".facilityRow").first();
    const header = row.locator(".facilityRowHeader");
    const grip = header.locator(".facilityDragHandle");
    await header.scrollIntoViewIfNeeded();
    await grip.hover();

    const surfaces = await header.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const fill = element.querySelector(".outputProgressBar")!;
      const fillBounds = fill.getBoundingClientRect();
      const gripBounds = element
        .querySelector(".facilityDragHandle")!
        .getBoundingClientRect();
      return {
        left: bounds.left,
        gripLeft: gripBounds.left,
        fillBottom: fillBounds.bottom,
        bottom: bounds.bottom,
        separator: style.borderTopWidth,
        hover: style.backgroundColor,
        children: Array.from(
          element.querySelectorAll(
            ".facilityDragHandle, .facilityDisclosure, .facility",
          ),
        ).map((child) => ({
          background: getComputedStyle(child).backgroundColor,
          separator: getComputedStyle(child).borderTopWidth,
        })),
      };
    });
    expect(surfaces.gripLeft).toBe(surfaces.left);
    expect(surfaces.fillBottom).toBe(surfaces.bottom);
    expect(surfaces.separator).toBe("1px");
    expect(surfaces.hover).not.toBe("rgba(0, 0, 0, 0)");
    expect(surfaces.children).toEqual([
      { background: "rgba(0, 0, 0, 0)", separator: "0px" },
      { background: "rgba(0, 0, 0, 0)", separator: "0px" },
      { background: "rgba(0, 0, 0, 0)", separator: "0px" },
    ]);
    await page.screenshot({ path: testInfo.outputPath("row-hover.png") });

    await header.locator(".facilityDisclosure").click();
    await expect(row.locator(".facilityDetails")).toBeVisible();
    await row.locator(".facilityDetails").hover();
    await expect(row).toHaveCSS("box-shadow", "none");
    await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.screenshot({ path: testInfo.outputPath("row-expanded.png") });
  });
}
