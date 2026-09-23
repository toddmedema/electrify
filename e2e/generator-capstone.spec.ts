import { expect, test } from "@playwright/test";

test("generator capstone completes immediately after a different second purchase", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    (theme) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [{ scenarioId: 0, timesPlayed: 1, date: "2026-09-17" }],
        }),
      );
    },
    testInfo.project.name.startsWith("mobile") ? "dark" : "light",
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start Generators", exact: true })
    .click();
  const hud = page.locator(".tutorialHud");
  await page.locator(".button-buildFacility").click();
  await page
    .getByRole("button", {
      name: "Review purchase of Natural Gas",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Take loan", exact: true }).click();
  await expect(hud).toContainText("Construction started");
  await hud.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect(hud).toContainText("Watch the year bar advance");
  await hud.getByRole("button", { name: "Next", exact: true }).click();
  await expect(hud).toContainText(
    "Order a second generator of a different type",
  );
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await page
    .locator(".facilityRow")
    .last()
    .getByRole("button", { name: "Inspect Coal", exact: true })
    .click();
  await expect(page.locator(".facilityDetails")).toBeVisible();
  await expect(
    page.getByText("Rated maximum output", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".facilityDetails")
      .getByText("Lifetime cost per MWh", { exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.locator(".facilityRow").last().scrollIntoViewIfNeeded();
  }
  await page.screenshot({
    path: testInfo.outputPath("capstone-details.png"),
    fullPage: true,
  });
  await page.locator(".button-buildFacility").click();
  await page
    .getByRole("button", { name: "Review purchase of Solar", exact: true })
    .click();
  await page.getByRole("button", { name: "Take loan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Mission complete!/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/you ordered two different generator types/),
  ).toBeVisible();
});
