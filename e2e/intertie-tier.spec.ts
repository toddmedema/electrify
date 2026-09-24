import { expect, test } from "@playwright/test";
import path from "path";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`build a larger intertie tier in ${theme}`, async ({
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
    const card = page.getByTestId("transmission-project-california-north");
    const slider = card.getByRole("slider");
    await slider.focus();
    await slider.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "4");
    await expect(card).toContainText("16.9MW");
    await card
      .getByRole("button", { name: "Show Pacific Northwest details" })
      .click();
    await expect(card).toContainText("Neighbor’s max spare capacity");
    await expect(card.locator(".buildOptionDescription")).toHaveCount(1);
    expect(
      await card.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (process.env.REVIEW_SCREENSHOT_DIR && theme === "light") {
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `intertie-tier-${testInfo.project.name}.png`,
        ),
        animations: "disabled",
      });
    }
    await card
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Tier 4");
    await expect(dialog).toContainText("16.9MW access");
    await dialog.getByRole("button", { name: "Pay cash", exact: true }).click();
    await expect(
      page
        .locator(".facilities:visible")
        .getByRole("button", { name: /Inspect Northern intertie/ }),
    ).toBeVisible();
  });
}
