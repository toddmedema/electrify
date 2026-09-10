import { expect, test } from "@playwright/test";

test("California players can build and understand an intertie", async ({
  page,
}, testInfo) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-320px"]).has(testInfo.project.name),
  );
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game" }).click();

  await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
  const facilities = page.locator(".facilities:visible");
  if (!(await facilities.isVisible())) {
    await page.getByRole("button", { name: "Facilities", exact: true }).click();
  }
  await facilities.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "Intertie", exact: true }).click();
  const projects = page.getByRole("dialog");
  await expect(
    projects.getByRole("heading", { name: "Share power with nearby grids" }),
  ).toBeVisible();
  await expect(
    projects.getByRole("heading", { name: "Pacific Northwest", exact: true }),
  ).toBeVisible();
  await expect(projects.getByLabel("Trading rule")).toHaveCount(0);
  await expect(projects.getByText("Total cost").first()).toBeVisible();
  await expect(
    projects.getByText("Pay $36M now · finance $144M").first(),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-320px") {
    const firstBuild = projects
      .getByRole("button", { name: "Approve Pacific Northwest intertie" })
      .first();
    const box = await firstBuild.boundingBox();
    expect(box).not.toBeNull();
    await firstBuild.scrollIntoViewIfNeeded();
    await expect(firstBuild).toBeInViewport();
  }

  await projects
    .getByRole("button", { name: "Approve Pacific Northwest intertie" })
    .first()
    .click();
  await expect(
    page.getByText("Intertie approved — power can flow in 1 year."),
  ).toBeVisible();
  await expect(
    facilities.getByText("Interties · Automatic trading"),
  ).toBeVisible();
  await expect(facilities.getByText("Building")).toBeVisible();
  await facilities.locator(".tradingSummary > summary").click();
  await expect(facilities.getByLabel("Trading rule")).toContainText(
    "Buy for shortages, sell extra",
  );
  await expect(facilities.getByText("Northern intertie upgrade")).toHaveCount(
    1,
  );
  expect(
    await facilities.evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    ),
  ).toBeLessThanOrEqual(1);
});

test("island grids do not offer interties or power exchange", async ({
  page,
}, testInfo) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-320px"]).has(testInfo.project.name),
  );
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=105");
  await page.getByRole("button", { name: "Start game" }).click();

  await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
  const facilities = page.locator(".facilities:visible");
  if (!(await facilities.isVisible())) {
    await page.getByRole("button", { name: "Facilities", exact: true }).click();
  }
  await expect(facilities.getByRole("tab", { name: "Interties" })).toHaveCount(
    0,
  );

  const insights = page.locator(".insights:visible");
  if (!(await insights.isVisible())) {
    await page.getByRole("button", { name: "Insights", exact: true }).click();
  }
  await insights.getByRole("button", { name: /Layers \(/ }).click();
  await expect(
    insights.getByRole("checkbox", { name: "Power exchange" }),
  ).toHaveCount(0);
  await expect(
    insights.getByRole("heading", { name: "Power exchange" }),
  ).toHaveCount(0);
});

test("unified facility rows support keyboard inspection and dispatch reordering", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const facilities = page.locator(".facilities:visible");
  const rows = facilities.locator(".facilityRow");
  await expect(rows).toHaveCount(2);
  const originalFirstId = await rows
    .first()
    .getAttribute("data-rfd-draggable-id");
  await expect(rows.first()).toHaveAttribute("role", "button");
  await expect(rows.first()).toHaveAttribute("tabindex", "0");
  await facilities.getByRole("button", { name: "Build", exact: true }).focus();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    if (await rows.first().evaluate((row) => row === document.activeElement))
      break;
  }
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows.first()).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter");
  await expect(rows.first()).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(rows.last()).toHaveAttribute(
    "data-rfd-draggable-id",
    originalFirstId!,
  );
  await expect(rows.last()).toBeFocused();
  await expect(facilities.locator(".transmissionFleet")).toBeVisible();
});
