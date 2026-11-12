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
    await openPane(
      page.locator(".insights:visible"),
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const upcoming = page
      .getByRole("region", { name: "Upcoming scenario events" })
      .getByRole("button")
      .first();
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
    const filterButton = page.getByRole("button", {
      name: "Filter event history, World events, Projects",
    });
    await expect(filterButton).toBeVisible();
    await page.mouse.move(0, 0);
    await filterButton.blur();
    await expect(filterButton).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
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

test("the full-screen chart names its numbered events and each badge names itself on hover", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await openPane(
    page.locator(".insights:visible"),
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  const paneEvent = page
    .getByRole("region", { name: "Upcoming scenario events" })
    .getByRole("button")
    .first();
  await expect(paneEvent).toBeVisible();
  const title = (
    await paneEvent.locator(".insightEventTitle").innerText()
  ).trim();

  await page
    .getByRole("button", { name: "Expand Supply & Demand chart" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Supply & Demand" });
  const rail = dialog.getByRole("region", { name: "Upcoming scenario events" });
  await expect(rail).toContainText(title);
  // Opening an event inside the chart keeps its details in the chart.
  await rail.getByRole("button").first().click();
  await expect(dialog.locator(".insightEventDetails")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.locator(".insightEventDetails")).toBeHidden();
  await expect(dialog).toBeVisible();

  // The badges are canvas pixels in the row above the plot: sweep it for the first one.
  const plot = (await dialog.locator(".u-over").first().boundingBox())!;
  const tooltip = dialog.locator(".chartEventTooltip").first();
  let named = "";
  for (let x = plot.x; x < plot.x + plot.width && !named; x += 3) {
    await page.mouse.move(x, plot.y - 12);
    if (
      (await tooltip.evaluate((el) => getComputedStyle(el).display)) === "block"
    )
      named = await tooltip.innerText();
  }
  expect(named).toContain(title);
  // Moving down onto the data takes the badge's name away.
  await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
  await expect(tooltip).toBeHidden();
});
