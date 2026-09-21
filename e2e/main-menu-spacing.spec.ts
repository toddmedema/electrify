import { expect, test, Locator } from "@playwright/test";

async function expectGap(above: Locator, below: Locator, gap: number) {
  const first = await above.boundingBox();
  const second = await below.boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y - first!.y - first!.height).toBeCloseTo(gap, 0);
}

for (const theme of ["light", "dark"]) {
  test(`home action spacing follows the same rhythm in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    const primary = page.getByRole("region", { name: "Primary actions" });
    const resources = page.getByRole("navigation", { name: "Game resources" });
    const discovery = page.locator(".discoveryActions");
    await expect(primary).toBeVisible();
    await expectGap(page.locator(".gameSubtitle"), primary, 16);
    await expectGap(primary, resources, 8);
    await expectGap(resources, discovery, 0);
    const button = await primary.getByRole("button").boundingBox();
    expect(button!.width).toBeLessThanOrEqual(260);
    expect(button!.x).toBeGreaterThanOrEqual(24);

    // The sound prompt is the last thing in the discovery row here, so taking it removes the
    // row, and with nothing else left in the utility block that block goes too.
    await page.getByRole("button", { name: "Turn on sound" }).click();
    await expect(discovery).toBeHidden();
    await expect(page.locator(".utilityActions")).toBeHidden();
    const overflow = await page
      .locator("#menuCard")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("a saved game remains separated from the logo and footer on short screens", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320px");
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(localStorage.getItem("savedGame"))))
    .toBe(true);
  await page.setViewportSize({ width: 360, height: 320 });
  await page.goto("/");
  const primary = page.getByRole("region", { name: "Primary actions" });
  await expect(
    primary.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await expectGap(
    primary.getByRole("button").nth(0),
    primary.getByRole("button").nth(1),
    12,
  );
  const logo = await page.locator("#logo").boundingBox();
  const menu = await page.locator("#centeredMenu").boundingBox();
  const footer = await page.locator(".mainMenuFooter").boundingBox();
  expect(menu!.y).toBeGreaterThanOrEqual(logo!.y + logo!.height);
  expect(footer!.y).toBeGreaterThanOrEqual(menu!.y + menu!.height);
  await page.getByRole("link", { name: "Privacy" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("link", { name: "Privacy" })).toBeInViewport();
});
