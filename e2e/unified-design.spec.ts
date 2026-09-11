import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`unified facilities stay compact and disclose controls in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      !["desktop-chromium", "mobile-390px", "mobile-320px"].includes(
        testInfo.project.name,
      ),
    );
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    if (!(await pane.isVisible()))
      await page
        .getByRole("button", { name: "Facilities", exact: true })
        .click();
    const rows = pane.locator(".facilityRow");
    const chart = pane.locator(".facilitySupplyDisclosure");
    const phone = testInfo.project.name.startsWith("mobile-");
    if (phone) {
      await expect(chart).not.toHaveAttribute("open");
      await expect(rows.nth(1)).toBeInViewport();
      await expect(pane.locator(".transmissionFleet")).toBeInViewport();
      await chart.locator(":scope > summary").click();
      await expect(chart).toHaveAttribute("open");
      await expect(pane.locator("#chartSupplyDemand")).toBeVisible();
      await chart.locator(":scope > summary").click();
      await expect(chart).not.toHaveAttribute("open");
    } else await expect(chart).toHaveAttribute("open");
    const first = rows.first();
    const disclosure = first.locator(".facilityDisclosure");
    await expect(first.locator(".facilityActions")).toHaveCount(0);
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(first.getByRole("button", { name: /^Pause / })).toBeVisible();
    expect(await disclosure.locator("button").count()).toBe(0);
    const bounds = await first
      .getByRole("button", { name: /^Pause / })
      .boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(phone ? 44 : 40);
    await disclosure.click();
    await expect(first.locator(".facilityActions")).toHaveCount(0);
    expect(
      await pane.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
}
