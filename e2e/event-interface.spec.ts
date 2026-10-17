import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`event selection and history filters in ${theme}`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === "desktop-chromium") {
      await page.setViewportSize({ width: 1680, height: 1000 });
    }
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const upcoming = page.getByRole("button", { name: /^Upcoming:/ });
    await expect(upcoming).toBeVisible();
    await upcoming.click();
    await expect(page.locator(".insightEventChip.active")).toBeVisible();
    await expect(page.locator(".insightEventDetails")).toBeVisible();
    await page.keyboard.press("Escape");
    await openPane(
      page.locator(".eventLog"),
      page.getByRole("button", { name: "Events", exact: true }),
    );
    await page
      .getByRole("button", { name: "Filter event history, All events" })
      .click();
    await page.getByRole("menuitemcheckbox", { name: "Blackouts" }).click();
    await page
      .getByRole("menuitemcheckbox", { name: "Market & finance" })
      .click();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "World events" }),
    ).toBeChecked();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Projects" }),
    ).toBeChecked();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Blackouts" }),
    ).not.toBeChecked();
    await page.getByRole("menuitem", { name: "Done" }).click();
    await expect(
      page.getByRole("button", {
        name: "Filter event history, World events, Projects",
      }),
    ).toBeVisible();
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await openPane(
      page.locator(".eventLog"),
      page.getByRole("button", { name: "Events", exact: true }),
    );
    await expect(
      page.getByRole("button", {
        name: "Filter event history, World events, Projects",
      }),
    ).toBeVisible();
  });
}
