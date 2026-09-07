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

  const facilities = page.locator(".facilities:visible");
  if (!(await facilities.isVisible())) {
    await page.getByRole("button", { name: "Facilities", exact: true }).click();
  }
  await facilities.getByRole("tab", { name: "Interties" }).click();
  await expect(
    facilities.getByRole("heading", { name: "Share power with nearby grids" }),
  ).toBeVisible();
  await expect(facilities.getByText("Pacific Northwest")).toBeVisible();
  await expect(facilities.getByLabel("Trading rule")).toHaveCount(0);
  await expect(facilities.getByText("Total cost").first()).toBeVisible();
  await expect(
    facilities.getByText("Pay $36M now · finance $144M").first(),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-320px") {
    const firstBuild = facilities
      .getByRole("button", { name: "Approve intertie" })
      .first();
    const box = await firstBuild.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(512);
  }

  await facilities
    .getByRole("button", { name: "Approve intertie" })
    .first()
    .click();
  await expect(facilities.getByText("Your interties")).toBeVisible();
  await expect(facilities.getByText("Building")).toBeVisible();
  await expect(facilities.getByLabel("Trading rule")).toContainText(
    "Buy for shortages, sell extra",
  );
  await expect(
    page.getByText("Intertie approved — power can flow in 1 year."),
  ).toBeVisible();
  await expect(facilities.getByText("Northern intertie upgrade")).toHaveCount(
    1,
  );
  expect(
    await facilities.evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    ),
  ).toBeLessThanOrEqual(1);
});
